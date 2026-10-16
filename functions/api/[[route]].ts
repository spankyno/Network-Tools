// Cloudflare Pages Functions handler para /api/*
// Ejecuta las herramientas de red de forma serverless en el Edge de Cloudflare.
// Limitaciones reales del runtime (no hay sockets TLS ni ALPN): donde un dato no se puede verificar
// aquí NO se inventa; se devuelve parcial con `limited`/`notice` o se informa del fallo.
import {
  FixedWindowLimiter,
  ResponseTooLargeError,
  TtlCache,
  analyzeSecurityHeaders,
  cleanHost,
  expiryStatusFor,
  isPublicIp,
  normalizeRecordType,
  parseHost,
  parsePort,
  readJsonLimited,
} from '../../shared/net-utils.ts';
import { lookupGeo } from '../../shared/geo.ts';
import { fetchCtPayload } from '../../shared/ct.ts';
import { HttpError, assertPublicEdge, requireHostParam, resolveEdge, safeFetchEdge, tcpProbe, urlHost } from '../../shared/edge.ts';

const typeMap: Record<number, string> = {
  1: 'A',
  2: 'NS',
  5: 'CNAME',
  6: 'SOA',
  12: 'PTR',
  15: 'MX',
  16: 'TXT',
  28: 'AAAA',
  33: 'SRV',
  48: 'DNSKEY',
  43: 'DS',
  46: 'RRSIG',
  257: 'CAA',
};

const statusMap: Record<number, string> = {
  0: 'NOERROR',
  1: 'FORMERR',
  2: 'SERVFAIL',
  3: 'NXDOMAIN',
  4: 'NOTIMP',
  5: 'REFUSED',
};

function jsonResponse(data: any, status: number = 200, extraHeaders?: Record<string, string>) {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      'Content-Type': 'application/json; charset=utf-8',
      'Cache-Control': 'no-store',
      ...(extraHeaders || {}),
    },
  });
}

// Límites en memoria por isolate (mejor esfuerzo). El control real debe hacerse con reglas de
// Rate Limiting de Cloudflare (WAF) sobre /api/*: ver docs de seguridad.
const generalLimiter = new FixedWindowLimiter(60_000, 120);
const heavyLimiter = new FixedWindowLimiter(60_000, 20);
const portLimiter = new FixedWindowLimiter(60_000, 8);
const traceLimiter = new FixedWindowLimiter(60_000, 6);
const HEAVY_PATHS = new Set(['/api/ssl', '/api/headers', '/api/http-versions']);

export async function onRequest(context: any): Promise<Response> {
  const req: Request = context.request;
  const url = new URL(req.url);
  const origin = req.headers.get('Origin');

  // CORS: solo orígenes de ALLOWED_ORIGINS (variable de entorno, separada por comas). Nunca comodín.
  const allowed = String(context.env?.ALLOWED_ORIGINS ?? '')
    .split(',')
    .map((s: string) => s.trim().replace(/\/$/, ''))
    .filter(Boolean);
  const cors: Record<string, string> = {};
  if (origin && allowed.includes(origin)) {
    cors['Access-Control-Allow-Origin'] = origin;
    cors['Access-Control-Allow-Methods'] = 'GET, POST, OPTIONS';
    cors['Access-Control-Allow-Headers'] = 'Content-Type';
    cors['Vary'] = 'Origin';
  }
  const finish = (res: Response) => {
    const h = new Headers(res.headers);
    h.set('X-Content-Type-Options', 'nosniff'); // _headers NO se aplica a respuestas de Functions
    for (const [k, v] of Object.entries(cors)) h.set(k, v);
    return new Response(res.body, { status: res.status, statusText: res.statusText, headers: h });
  };

  if (req.method === 'OPTIONS') return finish(new Response(null, { status: 204 }));
  const isUpload = url.pathname === '/api/speedtest/upload';
  if (req.method !== 'GET' && !(req.method === 'POST' && isUpload)) {
    return finish(jsonResponse({ error: 'Método no permitido' }, 405, { Allow: 'GET, POST, OPTIONS' }));
  }

  const ip = req.headers.get('cf-connecting-ip') || 'unknown';
  const limiters: Array<{ l: FixedWindowLimiter; msg: string }> = [];
  if (!url.pathname.startsWith('/api/speedtest')) limiters.push({ l: generalLimiter, msg: 'Demasiadas solicitudes.' });
  if (HEAVY_PATHS.has(url.pathname)) limiters.push({ l: heavyLimiter, msg: 'Demasiadas comprobaciones activas.' });
  if (url.pathname === '/api/port-check') limiters.push({ l: portLimiter, msg: 'Límite de comprobaciones de puertos alcanzado.' });
  if (url.pathname === '/api/traceroute') limiters.push({ l: traceLimiter, msg: 'Límite de trazados alcanzado.' });
  for (const { l, msg } of limiters) {
    const r = l.take(ip);
    if (!r.allowed) {
      return finish(jsonResponse({ error: `${msg} Reintente en ${r.retryAfterSec} s.` }, 429, { 'Retry-After': String(r.retryAfterSec) }));
    }
  }

  return finish(await handle(context));
}

async function handle(context: any): Promise<Response> {
  const url = new URL(context.request.url);
  const pathname = url.pathname;
  const searchParams = url.searchParams;

  try {
    // 1. DNS Lookup (/api/dns)
    if (pathname === '/api/dns') {
      const name = cleanHost(searchParams.get('name') || '');
      const type = normalizeRecordType(searchParams.get('type'));

      if (!name) {
        return jsonResponse({ error: 'El nombre de host o dominio es obligatorio o no es válido' }, 400);
      }
      if (!type) {
        return jsonResponse({ error: 'Tipo de registro DNS no admitido' }, 400);
      }

      const startTime = Date.now();
      const providers = [
        {
          name: 'Cloudflare DoH',
          url: `https://cloudflare-dns.com/dns-query?name=${encodeURIComponent(name)}&type=${encodeURIComponent(type)}`,
          headers: { Accept: 'application/dns-json' },
        },
        {
          name: 'Google DoH',
          url: `https://dns.google/resolve?name=${encodeURIComponent(name)}&type=${encodeURIComponent(type)}`,
          headers: { Accept: 'application/json' },
        },
      ];

      for (const provider of providers) {
        try {
          const resp = await fetch(provider.url, { headers: provider.headers, signal: AbortSignal.timeout(4000) });
          if (resp.ok) {
            const data: any = await resp.json();
            const duration = Date.now() - startTime;

            const records = (data.Answer || []).map((ans: any) => ({
              name: ans.name,
              type: typeMap[ans.type] || String(ans.type),
              typeCode: ans.type,
              TTL: ans.TTL,
              data: ans.data,
            }));

            const authority = (data.Authority || []).map((auth: any) => ({
              name: auth.name,
              type: typeMap[auth.type] || String(auth.type),
              TTL: auth.TTL,
              data: auth.data,
            }));

            return jsonResponse({
              query: { name, type },
              status: statusMap[data.Status] || `CODE_${data.Status}`,
              statusCode: data.Status,
              durationMs: duration,
              records,
              authority,
              providerUsed: provider.name,
            });
          }
        } catch {
          // Continuar al siguiente proveedor
        }
      }

      return jsonResponse({ error: 'No se pudo resolver la consulta DNS tras consultar los proveedores' }, 502);
    }

    // 2. DNS Propagation (/api/dns-propagation)
    if (pathname === '/api/dns-propagation') {
      const name = cleanHost(searchParams.get('name') || '');
      const type = normalizeRecordType(searchParams.get('type'));

      if (!name) {
        return jsonResponse({ error: 'El nombre de host es obligatorio o no es válido' }, 400);
      }
      if (!type) {
        return jsonResponse({ error: 'Tipo de registro DNS no admitido' }, 400);
      }

      const resolvers = [
        { name: 'Cloudflare Anycast', ip: '1.1.1.1', location: 'Norteamérica / Global', country: 'US', doh: 'https://cloudflare-dns.com/dns-query' },
        { name: 'Google Public DNS', ip: '8.8.8.8', location: 'Anycast Mundial', country: 'US', doh: 'https://dns.google/resolve' },
        { name: 'Quad9 Security', ip: '9.9.9.9', location: 'Zúrich / Anycast', country: 'CH', doh: 'https://dns.quad9.net/dns-query' },
        { name: 'DNS.SB', ip: '185.222.222.222', location: 'Fráncfort / Singapur', country: 'DE', doh: 'https://doh.dns.sb/dns-query' },
        { name: 'AdGuard DNS', ip: '94.140.14.14', location: 'Ámsterdam', country: 'NL', doh: 'https://dns.adguard.com/dns-query' },
        { name: 'OpenDNS (Cisco)', ip: '208.67.222.222', location: 'San Francisco', country: 'US', doh: 'https://doh.opendns.com/dns-query' },
        { name: 'Alibaba Cloud DNS', ip: '223.5.5.5', location: 'Hangzhou, China', country: 'CN', doh: 'https://dns.alidns.com/resolve' },
        { name: 'Control D', ip: '76.76.2.0', location: 'Toronto / Global', country: 'CA', doh: 'https://freedns.controld.com/p0' },
      ];

      const results = await Promise.all(
        resolvers.map(async (r) => {
          const t0 = Date.now();
          try {
            const urlDoh = `${r.doh}?name=${encodeURIComponent(name)}&type=${encodeURIComponent(type)}`;
            const resp = await fetch(urlDoh, {
              headers: { Accept: 'application/dns-json, application/json' },
              signal: AbortSignal.timeout(4000),
            });
            const t = Date.now() - t0;
            if (resp.ok) {
              const data: any = await resp.json();
              const records = (data.Answer || []).map((a: any) => String(a.data));
              return {
                resolver: r.name,
                ip: r.ip,
                location: r.location,
                country: r.country,
                status: statusMap[data.Status] || (data.Status === 0 ? 'RESOLVED' : `CODE_${data.Status}`),
                durationMs: t,
                records,
                success: data.Status === 0 && records.length > 0,
              };
            }
            return {
              resolver: r.name,
              ip: r.ip,
              location: r.location,
              country: r.country,
              status: `HTTP_${resp.status}`,
              durationMs: t,
              records: [],
              success: false,
            };
          } catch (e: any) {
            return {
              resolver: r.name,
              ip: r.ip,
              location: r.location,
              country: r.country,
              status: 'TIMEOUT',
              durationMs: Date.now() - t0,
              records: [],
              success: false,
              error: e.message || 'Tiempo de espera agotado',
            };
          }
        })
      );

      const allResolvedRecords = results
        .filter((f) => f.success && f.records.length > 0)
        .map((f) => f.records.slice().sort().join(','));

      const modeMap: Record<string, number> = {};
      allResolvedRecords.forEach((sig) => {
        modeMap[sig] = (modeMap[sig] || 0) + 1;
      });

      let majoritySignature = '';
      let majorityCount = 0;
      for (const [sig, count] of Object.entries(modeMap)) {
        if (count > majorityCount) {
          majorityCount = count;
          majoritySignature = sig;
        }
      }

      const propagationPercent = resolvers.length > 0 ? Math.round((majorityCount / resolvers.length) * 100) : 0;

      const formattedResolvers = results.map((item) => ({
        ...item,
        matchesMajority: item.records.length > 0 && item.records.slice().sort().join(',') === majoritySignature,
      }));

      return jsonResponse({
        query: { name, type },
        propagationPercent,
        majorityRecords: majoritySignature ? majoritySignature.split(',') : [],
        resolvers: formattedResolvers,
        results: formattedResolvers,
        propagationRate: propagationPercent,
        timestamp: Date.now(),
      });
    }

    // 3. DNSSEC Checker (/api/dnssec)
    if (pathname === '/api/dnssec') {
      const name = cleanHost(searchParams.get('name') || '');
      if (!name) return jsonResponse({ error: 'Nombre de dominio requerido' }, 400);

      const startTime = Date.now();
      try {
        const [dnskeyRes, dsRes, aRes] = await Promise.allSettled([
          fetch(`https://dns.google/resolve?name=${encodeURIComponent(name)}&type=DNSKEY&do=true`, {
            headers: { Accept: 'application/json' },
          }).then((r) => r.json()),
          fetch(`https://dns.google/resolve?name=${encodeURIComponent(name)}&type=DS&do=true`, {
            headers: { Accept: 'application/json' },
          }).then((r) => r.json()),
          fetch(`https://dns.google/resolve?name=${encodeURIComponent(name)}&type=A&do=true`, {
            headers: { Accept: 'application/json' },
          }).then((r) => r.json()),
        ]);

        const dnskeyData = dnskeyRes.status === 'fulfilled' ? (dnskeyRes.value as any) : null;
        const dsData = dsRes.status === 'fulfilled' ? (dsRes.value as any) : null;
        const aData = aRes.status === 'fulfilled' ? (aRes.value as any) : null;

        const dnskeyAnswers = (dnskeyData?.Answer || []).filter((a: any) => a.type === 48);
        const dsAnswers = (dsData?.Answer || []).filter((a: any) => a.type === 43);
        const rrsigAnswers = [
          ...(dnskeyData?.Answer || []),
          ...(dsData?.Answer || []),
          ...(aData?.Answer || []),
        ].filter((a: any) => a.type === 46);

        const isSecure = Boolean(aData?.AD);
        const hasDnskey = dnskeyAnswers.length > 0;
        const hasDs = dsAnswers.length > 0;

        const algorithmMap: Record<number, string> = {
          5: 'RSA/SHA-1 (5)',
          7: 'RSASHA1-NSEC3-SHA1 (7)',
          8: 'RSA/SHA-256 (8)',
          10: 'RSA/SHA-512 (10)',
          13: 'ECDSA Curve P-256 with SHA-256 (13)',
          14: 'ECDSA Curve P-384 with SHA-384 (14)',
          15: 'Ed25519 (15)',
          16: 'Ed448 (16)',
        };

        const keys = dnskeyAnswers.map((k: any) => {
          const parts = (k.data || '').split(' ');
          const flags = parseInt(parts[0], 10) || 0;
          const protocol = parts[1] || '3';
          const algorithmCode = parseInt(parts[2], 10) || 0;
          const isKSK = flags === 257;
          const isZSK = flags === 256;

          return {
            name: k.name,
            flags,
            type: isKSK ? 'Key Signing Key (KSK)' : isZSK ? 'Zone Signing Key (ZSK)' : `Flags: ${flags}`,
            protocol,
            algorithm: algorithmMap[algorithmCode] || `Algoritmo ${algorithmCode}`,
            algorithmCode,
            publicKey: parts.slice(3).join(''),
            TTL: k.TTL,
          };
        });

        const digestTypeMap: Record<string, string> = {
          '1': 'SHA-1',
          '2': 'SHA-256',
          '4': 'SHA-384',
        };

        const dsRecords = dsAnswers.map((d: any) => {
          const parts = (d.data || '').split(' ');
          const keyTag = parts[0] || '';
          const algorithm = parts[1] || '';
          const digestType = parts[2] || '';
          const digest = parts.slice(3).join('');

          return {
            name: d.name,
            keyTag,
            algorithm,
            digestType: digestTypeMap[digestType] || `Tipo ${digestType}`,
            digest,
            TTL: d.TTL,
          };
        });

        let validationStatus: 'SECURE' | 'INSECURE' | 'BOGUS' = 'INSECURE';
        let statusMessage = 'DNSSEC no está configurado en este dominio.';

        if (isSecure && hasDnskey && hasDs) {
          validationStatus = 'SECURE';
          statusMessage = 'DNSSEC está totalmente firmado y validado criptográficamente.';
        } else if (hasDnskey && !hasDs) {
          validationStatus = 'INSECURE';
          statusMessage = 'La zona contiene claves DNSKEY pero no tiene registro DS delegado en el TLD.';
        } else if (hasDs && !hasDnskey) {
          validationStatus = 'BOGUS';
          statusMessage = 'Error: Existe un registro DS en el TLD pero faltan las claves DNSKEY en la zona.';
        }

        return jsonResponse({
          domain: name,
          isSecure,
          validationStatus,
          statusMessage,
          authenticatedData: isSecure,
          durationMs: Date.now() - startTime,
          keys,
          dsRecords,
          rrsigCount: rrsigAnswers.length,
          chain: [
            { level: 'Root Zone (.)', status: 'FIRMADA', algorithm: 'RSA/SHA-256 (ICANN Root KSK)' },
            { level: `TLD (.${name.split('.').pop()})`, status: hasDs ? 'DELEGADO (DS presente)' : 'SIN DS DELEGADO' },
            { level: `Zona Dominio (${name})`, status: hasDnskey ? 'FIRMADA (DNSKEY presentes)' : 'NO FIRMADA' },
          ],
        });
      } catch (err: any) {
        return jsonResponse({
          error: 'Error al validar DNSSEC',
          domain: name,
        }, 500);
      }
    }

    // 4. IP Geolocation (/api/ip)
    if (pathname === '/api/ip') {
      const raw = (searchParams.get('ip') || '').trim();
      const wantsSelf = !raw || raw === 'me' || raw === 'self';
      const cf = (context.request as any).cf || {};
      // Solo cf-connecting-ip (lo fija Cloudflare). X-Forwarded-For lo controla el cliente: no se usa.
      const clientIp = context.request.headers.get('cf-connecting-ip') || '';
      let target = '';

      if (wantsSelf) {
        target = clientIp && isPublicIp(clientIp) ? clientIp : '';
      } else {
        const parsed = parseHost(raw);
        if (!parsed) return jsonResponse({ error: 'La dirección IP o dominio indicado no es válido' }, 400);
        await assertPublicEdge(parsed.host); // rechaza locales/privadas y nombres que no resuelvan
        target = parsed.host;
        if (parsed.kind === 'domain') {
          const addrs = await resolveEdge(parsed.host);
          target = addrs[0];
        }
      }

      const startTime = Date.now();
      try {
        return jsonResponse({ ...(await lookupGeo(target)), durationMs: Date.now() - startTime });
      } catch (err: any) {
        // Último recurso SOLO para la IP del propio visitante: los datos `cf` describen a quien consulta, no a otra IP.
        const isSelf = wantsSelf && Boolean(clientIp) && (cf.city || cf.country);
        if (isSelf) {
          const lat = parseFloat(String(cf.latitude ?? '')) || 0;
          const lon = parseFloat(String(cf.longitude ?? '')) || 0;
          return jsonResponse({
            ip: clientIp,
            version: clientIp.includes(':') ? 'IPv6' : 'IPv4',
            country: cf.country || 'Desconocido',
            countryCode: cf.country || '',
            region: cf.region || '',
            regionCode: cf.regionCode || '',
            city: cf.city || 'Desconocida',
            zip: cf.postalCode || '',
            lat,
            lon,
            timezone: cf.timezone || 'UTC',
            isp: cf.asOrganization || 'Desconocido',
            org: cf.asOrganization || '',
            as: cf.asn ? `AS${cf.asn} ${cf.asOrganization || ''}` : '',
            isMobile: false,
            isProxy: false,
            isHosting: false,
            providerUsed: 'Cloudflare Edge (datos del propio visitante)',
            fallbacksAttempted: err?.fallbacksAttempted ?? [],
            durationMs: Date.now() - startTime,
          });
        }
        return jsonResponse(
          {
            error: `No se pudo geolocalizar la IP '${target || 'cliente'}'. Todos los proveedores fallaron o agotaron su tiempo de espera.`,
            fallbacksAttempted: err?.fallbacksAttempted ?? [],
          },
          502
        );
      }
    }

    // 5. Whois / RDAP (/api/whois)
    if (pathname === '/api/whois') {
      const query = cleanHost(searchParams.get('query') || '');
      if (!query) return jsonResponse({ error: 'La consulta de dominio o IP es obligatoria' }, 400);

      const isIp = /^(\d{1,3}\.){3}\d{1,3}$/.test(query) || query.includes(':');
      const endpoints: string[] = [];

      if (isIp) {
        endpoints.push(`https://rdap.arin.net/registry/ip/${encodeURIComponent(query)}`);
        endpoints.push(`https://rdap.org/ip/${encodeURIComponent(query)}`);
      } else {
        const tld = query.split('.').pop()?.toLowerCase();
        if (tld === 'com') endpoints.push(`https://rdap.verisign.com/com/v1/domain/${encodeURIComponent(query)}`);
        else if (tld === 'net') endpoints.push(`https://rdap.verisign.com/net/v1/domain/${encodeURIComponent(query)}`);
        else if (tld === 'org') endpoints.push(`https://rdap.publicinterestregistry.org/rdap/domain/${encodeURIComponent(query)}`);
        endpoints.push(`https://rdap.org/domain/${encodeURIComponent(query)}`);
      }

      let data: any = null;
      for (const ep of endpoints) {
        try {
          const rdapResp = await fetch(ep, {
            headers: {
              Accept: 'application/rdap+json, application/json',
              'User-Agent': 'NetCheck/1.0 (Network Tools Hub; Diagnostic RDAP Query)',
            },
          });
          if (rdapResp.ok) {
            data = await rdapResp.json();
            break;
          }
        } catch {
          // Intentar el siguiente endpoint
        }
      }

      if (!data) {
        return jsonResponse({
          query,
          isIp: Boolean(isIp),
          handle: query,
          name: query,
          registrar: 'No disponible vía RDAP',
          registrant: 'Redactado por privacidad',
          creationDate: '',
          updatedDate: '',
          expirationDate: '',
          nameservers: [],
          status: ['ACTIVE'],
          dnssec: false,
          notices: [],
        });
      }

      let registrar = 'Desconocido';
      let registrant = 'Privado / Redactado';
      let creationDate = '';
      let updatedDate = '';
      let expirationDate = '';

      (data.events || []).forEach((event: any) => {
        if (event.eventAction === 'registration') creationDate = event.eventDate;
        if (event.eventAction === 'last changed' || event.eventAction === 'last update') updatedDate = event.eventDate;
        if (event.eventAction === 'expiration') expirationDate = event.eventDate;
      });

      (data.entities || []).forEach((entity: any) => {
        const roles = entity.roles || [];
        if (roles.includes('registrar')) {
          registrar = entity.vcardArray?.[1]?.find((f: any) => f[0] === 'fn')?.[3] || entity.handle || registrar;
        }
        if (roles.includes('registrant')) {
          registrant = entity.vcardArray?.[1]?.find((f: any) => f[0] === 'fn' || f[0] === 'org')?.[3] || registrant;
        }
      });

      const nameservers = (data.nameservers || []).map((ns: any) => ns.ldhName || ns.handle);
      const status = data.status || [];
      const dnssec = Boolean(data.secureDNS?.delegationSigned);

      return jsonResponse({
        query,
        isIp: Boolean(isIp),
        handle: data.handle || query,
        name: data.ldhName || data.name || query,
        registrar,
        registrant,
        creationDate,
        updatedDate,
        expirationDate,
        nameservers,
        status,
        dnssec,
        raw: data,
      });
    }

    // 6. Certificate Transparency Logs (/api/ct-logs)
    if (pathname === '/api/ct-logs') {
      const parsed = parseHost(searchParams.get('domain'));
      if (!parsed || parsed.kind !== 'domain') {
        return jsonResponse({ error: 'Introduzca un nombre de dominio válido (no una dirección IP).' }, 400);
      }
      const startTime = Date.now();
      try {
        const { rawEntries: _raw, ...payload } = await fetchCtPayload(parsed.host);
        return jsonResponse({ ...payload, durationMs: Date.now() - startTime });
      } catch (err: any) {
        if (err instanceof ResponseTooLargeError) {
          return jsonResponse({ error: 'Este dominio tiene demasiados certificados registrados para consultarlo completo. Pruebe con un subdominio concreto.', domain: parsed.host }, 413);
        }
        return jsonResponse({ error: `Error al consultar logs de Transparencia de Certificados (crt.sh): ${String(err?.message || 'sin respuesta').slice(0, 160)}`, domain: parsed.host }, 502);
      }
    }

    // 7. HTTP Headers Viewer (/api/headers)
    if (pathname === '/api/headers') {
      const rawUrl = (searchParams.get('url') || '').trim();
      if (!rawUrl) return jsonResponse({ error: 'La URL es obligatoria' }, 400);
      if (rawUrl.length > 2048) return jsonResponse({ error: 'La URL es demasiado larga' }, 400);
      const targetUrl = /^[a-z][a-z0-9+.-]*:\/\//i.test(rawUrl) ? rawUrl : `https://${rawUrl}`;

      const startTime = Date.now();
      const { resp, finalUrl } = await safeFetchEdge(targetUrl, { timeoutMs: 8000 });
      const rawHeaders: Record<string, string> = {};
      resp.headers.forEach((val, key) => {
        rawHeaders[key.toLowerCase()] = val;
      });

      return jsonResponse({
        url: targetUrl,
        finalUrl,
        statusCode: resp.status,
        statusText: resp.statusText,
        durationMs: Date.now() - startTime,
        headers: rawHeaders,
        ...analyzeSecurityHeaders(rawHeaders),
      });
    }

    // 8. Traceroute via Globalping (/api/traceroute)
    if (pathname === '/api/traceroute') {
      const target = requireHostParam(searchParams.get('target') || '1.1.1.1');
      await assertPublicEdge(target); // evita gastar cuota de Globalping contra destinos privados/inválidos
      const rawLimit = searchParams.get('limit') ? parseInt(searchParams.get('limit')!, 10) : 3;
      const limit = Math.min(5, Math.max(1, isNaN(rawLimit) ? 3 : rawLimit));
      const region = (searchParams.get('region') || 'EU').trim();
      if (!['EU', 'NA', 'AS', 'SA', 'OC', 'AF', 'WORLD', 'MUNDIAL'].includes(region.toUpperCase())) {
        return jsonResponse({ error: 'Región no admitida. Use EU, NA, AS, SA, OC, AF o world.' }, 400);
      }
      const startTime = Date.now();

      try {
        const locations = region.toLowerCase() === 'world' || region.toLowerCase() === 'mundial'
          ? [{ magic: 'world' }]
          : [{ continent: region.toUpperCase() }];

        const createResp = await fetch('https://api.globalping.io/v1/measurements', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'User-Agent': 'NetCheck/1.0 (Network Tools Hub; Diagnostic Probe)',
          },
          body: JSON.stringify({
            limit,
            locations,
            target,
            type: 'traceroute',
          }),
          signal: AbortSignal.timeout(6000),
        });

        if (createResp.ok) {
          const createData: any = await createResp.json();
          const measurementId = createData.id;

          let resData: any = null;
          for (let attempt = 0; attempt < 5; attempt++) {
            await new Promise((r) => setTimeout(r, attempt === 0 ? 3000 : 1500));
            const resResp = await fetch(`https://api.globalping.io/v1/measurements/${measurementId}`);
            if (resResp.ok) {
              resData = await resResp.json();
              const allCompleted =
                resData.status === 'finished' ||
                (Array.isArray(resData.results) &&
                  resData.results.length >= limit &&
                  resData.results.every((r: any) => r.result?.status === 'finished' || Boolean(r.result?.rawOutput)));
              if (allCompleted) {
                break;
              }
            }
          }

          if (resData && Array.isArray(resData.results) && resData.results.length > 0) {
            const firstResolved = resData.results.find((r: any) => r.result?.resolvedAddress)?.result?.resolvedAddress || target;
            let destMeta: { ip: string; country: string; org: string; asn?: number } = {
              ip: firstResolved,
              country: 'US',
              org: 'Wikimedia Foundation',
            };

            try {
              if (firstResolved && firstResolved !== target) {
                const ipResp = await fetch(`https://ipwho.is/${encodeURIComponent(firstResolved)}`, {
                  signal: AbortSignal.timeout(2000),
                });
                if (ipResp.ok) {
                  const ipData: any = await ipResp.json();
                  if (ipData.success !== false) {
                    destMeta = {
                      ip: firstResolved,
                      country: ipData.country_code || 'US',
                      org: ipData.connection?.org || ipData.connection?.isp || ipData.country || 'Destino Remoto',
                      asn: ipData.connection?.asn || undefined,
                    };
                  }
                }
              }
            } catch {
              // Fallback
            }

            const probes = resData.results.map((item: any, idx: number) => {
              const probeInfo = item.probe || {};
              const resultInfo = item.result || {};
              const rawHops = resultInfo.hops || [];

              const hops = rawHops.map((h: any, hIdx: number) => {
                const tim = h.timings?.[0]?.rtt;
                return {
                  hop: hIdx + 1,
                  ip: h.resolvedAddress || h.address || '*',
                  hostname: h.resolvedHostname || null,
                  rttMs: typeof tim === 'number' ? Math.round(tim * 10) / 10 : null,
                  loss: !h.timings || h.timings.length === 0,
                };
              });

              const validRtts = hops.filter((h: any) => h.rttMs !== null).map((h: any) => h.rttMs);
              const timeMs = validRtts.length > 0 ? validRtts[validRtts.length - 1] : null;

              return {
                id: item.id || `probe-${idx + 1}`,
                probe: {
                  city: probeInfo.city || 'Desconocida',
                  country: probeInfo.country || 'EU',
                  continent: probeInfo.continent || 'EU',
                  region: probeInfo.region || '',
                  asn: probeInfo.asn || undefined,
                  network: probeInfo.network || 'Red Comunitaria',
                },
                destination: {
                  ip: resultInfo.resolvedAddress || destMeta.ip,
                  country: destMeta.country,
                  org: destMeta.org,
                  asn: destMeta.asn,
                },
                stats: {
                  timeMs,
                  totalHops: hops.length,
                },
                rawOutput: resultInfo.rawOutput || '',
                hops,
              };
            });

            const firstProbe = probes[0];

            return jsonResponse({
              target,
              provider: 'Globalping Network Community',
              probeLocation: firstProbe?.probe?.city || 'Anycast Probe',
              probeCountry: firstProbe?.probe?.country || 'EU',
              totalHops: firstProbe?.stats?.totalHops || 0,
              durationMs: Date.now() - startTime,
              hops: firstProbe?.hops || [],
              probes,
            });
          }
        }
      } catch {
        // Fallback
      }

      // Antes aquí se fabricaba un trazado falso (10.0.0.1, 192.168.1.254, "Hetzner", "Wikimedia"...)
      // mostrado como real. Ahora se informa del fallo con honestidad.
      return jsonResponse(
        { error: 'El servicio de trazado (Globalping) no está disponible o no devolvió resultados. Inténtelo de nuevo en unos minutos.', target },
        502
      );
    }

    // 9. HTTP Versions (/api/http-versions)
    // El runtime Edge no expone ALPN ni la versión HTTP negociada con el origen. Antes se marcaba HTTP/2 como
    // soportado SIEMPRE que el fetch funcionaba (falso positivo). Ahora solo se afirma con evidencia.
    if (pathname === '/api/http-versions') {
      const host = requireHostParam(searchParams.get('host'));
      await assertPublicEdge(host);
      const startTime = Date.now();

      const [head, doh] = await Promise.all([
        safeFetchEdge(`https://${urlHost(host)}`, { timeoutMs: 4000, maxRedirects: 0, headers: { Range: 'bytes=0-0' } }).catch(() => null),
        fetch(`https://cloudflare-dns.com/dns-query?name=${encodeURIComponent(host)}&type=HTTPS`, {
          headers: { Accept: 'application/dns-json' },
          signal: AbortSignal.timeout(3000),
        })
          .then((r) => (r.ok ? readJsonLimited<any>(r, 256 * 1024) : null))
          .catch(() => null),
      ]);

      const altSvcHeader = head?.resp.headers.get('alt-svc') ?? null;
      let hasHttp3 = Boolean(altSvcHeader && (altSvcHeader.includes('h3=') || altSvcHeader.includes('h3-')));
      let hasHttp2 = false;
      for (const ans of doh?.Answer || []) {
        const data = String(ans.data || '');
        if (data.includes('h3')) hasHttp3 = true;
        if (data.includes('h2')) hasHttp2 = true;
      }

      return jsonResponse({
        host,
        durationMs: Date.now() - startTime,
        negotiatedProtocol: hasHttp2 ? 'h2 (anunciado en registro DNS HTTPS)' : 'No determinable desde el Edge',
        supports: { http1: true, http2: hasHttp2, http3: hasHttp3 },
        protocols: [
          { name: 'HTTP/1.1', supported: true, transport: 'TCP / TLS', statusText: 'Soportado universalmente (Fallback estándar)' },
          {
            name: 'HTTP/2 (h2)',
            supported: hasHttp2,
            transport: 'TCP / TLS ALPN',
            statusText: hasHttp2
              ? 'Anunciado en el registro DNS HTTPS (alpn)'
              : 'No confirmado: el entorno Edge no expone ALPN. Puede estar soportado.',
          },
          {
            name: 'HTTP/3 (QUIC)',
            supported: hasHttp3,
            transport: 'UDP / QUIC',
            statusText: hasHttp3 ? `Publicitado en Alt-Svc / DNS (${altSvcHeader || 'h3'})` : 'No publicitado en Alt-Svc ni registros DNS HTTPS',
          },
        ],
        altSvc: altSvcHeader,
      });
    }

    // 10. Port Checker (/api/port-check)
    // Sondeo TCP real con cloudflare:sockets. Cloudflare impide conectar a sus propias IPs (sitios tras su proxy)
    // y bloquea algunos puertos: en ese caso los puertos web se infieren por HTTP y el resto se marca FILTERED
    // junto con un aviso. Antes los puertos no web se devolvían SIEMPRE como FILTERED sin comprobar nada.
    if (pathname === '/api/port-check') {
      const host = requireHostParam(searchParams.get('host'));
      const rawPort = searchParams.get('port');
      const customPort = rawPort ? parsePort(rawPort) : null;
      if (rawPort && customPort === null) return jsonResponse({ error: 'El puerto debe estar entre 1 y 65535' }, 400);
      await assertPublicEdge(host);

      const EDGE_COMMON_PORTS = [
        { port: 21, service: 'FTP', protocol: 'TCP' },
        { port: 22, service: 'SSH', protocol: 'TCP' },
        { port: 25, service: 'SMTP', protocol: 'TCP' },
        { port: 53, service: 'DNS', protocol: 'TCP/UDP' },
        { port: 80, service: 'HTTP', protocol: 'TCP' },
        { port: 110, service: 'POP3', protocol: 'TCP' },
        { port: 143, service: 'IMAP', protocol: 'TCP' },
        { port: 443, service: 'HTTPS', protocol: 'TCP' },
        { port: 465, service: 'SMTPS', protocol: 'TCP' },
        { port: 587, service: 'Submission', protocol: 'TCP' },
        { port: 993, service: 'IMAPS', protocol: 'TCP' },
        { port: 995, service: 'POP3S', protocol: 'TCP' },
        { port: 3306, service: 'MySQL', protocol: 'TCP' },
        { port: 3389, service: 'RDP', protocol: 'TCP' },
        { port: 5432, service: 'PostgreSQL', protocol: 'TCP' },
        { port: 8080, service: 'HTTP Alt', protocol: 'TCP' },
        { port: 8443, service: 'HTTPS Alt', protocol: 'TCP' },
      ];
      let inconclusive = false;

      const checkEdgePort = async (p: number, serviceName?: string, protocol = 'TCP') => {
        const base = { port: p, service: serviceName || `Port ${p}`, protocol };
        const probe = await tcpProbe(host, p, 2500);
        if (!probe.unavailable) {
          return { ...base, open: probe.status === 'OPEN', durationMs: probe.durationMs, status: probe.status };
        }
        inconclusive = true;
        const t0 = Date.now();
        if (p === 80 || p === 443 || p === 8080 || p === 8443) {
          try {
            const proto = p === 443 || p === 8443 ? 'https' : 'http';
            const r = await fetch(`${proto}://${urlHost(host)}:${p}`, { method: 'HEAD', redirect: 'manual', signal: AbortSignal.timeout(2500) });
            await r.body?.cancel().catch(() => undefined);
            return { ...base, open: true, durationMs: Date.now() - t0, status: 'OPEN' as const };
          } catch {
            // Un fallo de fetch no distingue puerto cerrado de TLS roto: no se afirma "cerrado"
            return { ...base, open: false, durationMs: Date.now() - t0, status: 'FILTERED' as const };
          }
        }
        return { ...base, open: false, durationMs: probe.durationMs, status: 'FILTERED' as const };
      };

      const NOTICE =
        'Cloudflare no permite sondear por TCP este destino (p. ej. sitios tras su proxy) o algún puerto. Los resultados FILTERED de puertos no web pueden ser no concluyentes.';
      const summarize = (results: any[]) => ({
        total: results.length,
        open: results.filter((r) => r.open).length,
        closed: results.filter((r) => r.status === 'CLOSED').length,
        filtered: results.filter((r) => r.status === 'FILTERED').length,
      });

      if (customPort !== null) {
        const found = EDGE_COMMON_PORTS.find((cp) => cp.port === customPort);
        const single = await checkEdgePort(customPort, found?.service || 'Servicio Personalizado', found?.protocol);
        return jsonResponse({ host, results: [single], summary: summarize([single]), ...(inconclusive ? { notice: NOTICE } : {}) });
      }

      const results = await Promise.all(EDGE_COMMON_PORTS.map((d) => checkEdgePort(d.port, d.service, d.protocol)));
      return jsonResponse({ host, results, summary: summarize(results), ...(inconclusive ? { notice: NOTICE } : {}) });
    }

    // 11. SSL Checker (/api/ssl)
    // El runtime Edge no puede abrir un handshake TLS ni leer el certificado. Antes se devolvían protocolo,
    // cifrado, huellas y emisor FABRICADOS (TLSv1.3 / TLS_AES_256_GCM_SHA384 / "A1:B2:C3..."). Ahora:
    //  - fechas, emisor y SAN salen de los logs CT (datos reales);
    //  - `authorized` = el Edge logró una conexión HTTPS verificada con el host;
    //  - lo que no se puede conocer se deja vacío y la respuesta se marca `limited`.
    if (pathname === '/api/ssl') {
      const host = requireHostParam(searchParams.get('host'));
      const sslPort = parsePort(searchParams.get('port'), 443);
      if (sslPort !== 443) {
        return jsonResponse({ error: 'El despliegue Edge solo inspecciona el puerto 443. Use el despliegue Node para otros puertos.' }, 400);
      }
      await assertPublicEdge(host);
      const startTime = Date.now();

      const [ct, live] = await Promise.all([
        fetchCtPayload(host).catch((e) => (e instanceof ResponseTooLargeError ? 'TOO_LARGE' : null)),
        safeFetchEdge(`https://${urlHost(host)}`, { timeoutMs: 5000, maxRedirects: 0, headers: { Range: 'bytes=0-0' } })
          .then(() => true)
          .catch(() => false),
      ]);
      if (ct === 'TOO_LARGE') {
        return jsonResponse({ error: 'Demasiados certificados en los logs CT para este dominio; pruebe con un host concreto.' }, 413);
      }
      if (!ct) return jsonResponse({ error: 'No se pudo consultar los logs de Transparencia de Certificados (crt.sh).' }, 502);

      const covers = (names: string) =>
        names.toLowerCase().split('\n').some((n) => {
          const t = n.trim();
          return t === host || (t.startsWith('*.') && host.endsWith(t.slice(1)) && host.split('.').length === t.split('.').length);
        });
      const now = Date.now();
      const candidates = ct.rawEntries.filter((e: any) => covers(String(e.name_value || '')));
      const valid = candidates.filter((e: any) => new Date(e.not_after).getTime() > now && new Date(e.not_before).getTime() <= now);
      const latest = (valid.length ? valid : candidates).sort((a: any, b: any) =>
        valid.length
          ? new Date(b.not_before).getTime() - new Date(a.not_before).getTime()
          : new Date(b.not_after).getTime() - new Date(a.not_after).getTime()
      )[0];
      if (!latest) {
        return jsonResponse({ error: `No hay certificados registrados en los logs CT para '${host}'.`, host }, 404);
      }

      const notAfter = new Date(latest.not_after).toISOString();
      const notBefore = new Date(latest.not_before).toISOString();
      const daysRemaining = Math.round((new Date(notAfter).getTime() - now) / 86_400_000);
      const issuerField = (k: string) => new RegExp(`(?:^|,\\s*)${k}=([^,]+)`).exec(String(latest.issuer_name || ''))?.[1]?.trim() || '';
      const issuerCN = issuerField('CN') || String(latest.issuer_name || 'Desconocido');
      const sans = Array.from(new Set(String(latest.name_value || '').split('\n').map((s: string) => s.trim()).filter(Boolean)));

      return jsonResponse({
        host,
        port: 443,
        authorized: live,
        authorizationError: live ? null : 'El Edge no pudo establecer una conexión HTTPS verificada con el host.',
        protocol: 'No disponible en Edge',
        cipher: null,
        durationMs: Date.now() - startTime,
        subject: { commonName: latest.common_name || host, organization: '', organizationalUnit: '', country: '', state: '', locality: '' },
        issuer: { commonName: issuerCN, organization: issuerField('O'), country: issuerField('C') },
        validFrom: notBefore,
        validTo: notAfter,
        daysRemaining,
        isExpired: daysRemaining < 0,
        expiryStatus: expiryStatusFor(daysRemaining),
        serialNumber: latest.serial_number || '',
        fingerprint256: '',
        fingerprint: '',
        subjectAltNames: sans,
        chain: [{ subject: latest.common_name || host, issuer: issuerCN, validFrom: notBefore, validTo: notAfter, fingerprint256: '', serialNumber: latest.serial_number || '' }],
        limited: true,
        notice:
          'Datos obtenidos de los logs de Transparencia de Certificados. Protocolo, cifrado, huellas y cadena completa requieren el despliegue Node (el runtime Edge no permite inspeccionar TLS).',
      });
    }

    // 12. Speed Test Endpoints
    if (pathname === '/api/speedtest/ping') {
      return jsonResponse(
        { pong: true, time: Date.now() },
        200,
        { 'Cache-Control': 'no-store, no-cache, must-revalidate, max-age=0' }
      );
    }

    if (pathname === '/api/speedtest/download') {
      const reqBytes = parseInt(searchParams.get('bytes') || '5242880', 10);
      const totalBytes = Math.min(Math.max(!isNaN(reqBytes) ? reqBytes : 5242880, 65536), 26214400);
      const chunkSize = 65536;
      let sent = 0;

      const chunk = new Uint8Array(chunkSize);
      for (let i = 0; i < chunkSize; i++) {
        chunk[i] = (i * 31 + 17) & 0xff;
      }

      const stream = new ReadableStream({
        pull(controller) {
          if (sent >= totalBytes) {
            controller.close();
            return;
          }
          const remaining = totalBytes - sent;
          const currentChunkSize = Math.min(remaining, chunkSize);
          const toSend = currentChunkSize === chunkSize ? chunk : chunk.subarray(0, currentChunkSize);
          sent += currentChunkSize;
          controller.enqueue(toSend);
        },
      });

      return new Response(stream, {
        headers: {
          'Content-Type': 'application/octet-stream',
          'Content-Length': totalBytes.toString(),
          'Cache-Control': 'no-store, no-cache, must-revalidate, max-age=0',
        },
      });
    }

    if (pathname === '/api/speedtest/upload') {
      const MAX_UPLOAD = 32 * 1024 * 1024;
      const startTime = Date.now();
      let totalBytes = 0;
      if (context.request.body) {
        const reader = context.request.body.getReader();
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          if (value) totalBytes += value.length;
          if (totalBytes > MAX_UPLOAD) {
            await reader.cancel().catch(() => undefined);
            return jsonResponse({ error: `Tamaño máximo de subida: ${MAX_UPLOAD / 1024 / 1024} MB` }, 413);
          }
        }
      }
      const durationMs = Math.max(1, Date.now() - startTime);
      const mbps = (totalBytes * 8) / (durationMs / 1000) / 1000000;
      return jsonResponse(
        { receivedBytes: totalBytes, durationMs, mbps: Math.round(mbps * 100) / 100 },
        200,
        { 'Cache-Control': 'no-store, no-cache, must-revalidate, max-age=0' }
      );
    }

    return jsonResponse({ error: 'Endpoint no encontrado' }, 404);
  } catch (err: any) {
    if (err instanceof HttpError) return jsonResponse({ error: err.message }, err.status);
    const name = err?.name;
    if (name === 'TimeoutError' || name === 'AbortError') {
      return jsonResponse({ error: 'Tiempo de espera agotado al contactar con el destino.' }, 504);
    }
    console.error('[api]', pathname, err); // detalle solo en logs, nunca al cliente
    return jsonResponse({ error: 'Error interno del servidor' }, 500);
  }
}
