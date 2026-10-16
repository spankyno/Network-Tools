import express, { Request, Response } from 'express';
import compression from 'compression';
import cors from 'cors';
import tls from 'node:tls';
import net from 'node:net';
import dns from 'node:dns';
import crypto from 'node:crypto';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  TtlCache,
  ResponseTooLargeError,
  analyzeSecurityHeaders,
  cleanHost,
  expiryStatusFor,
  isBlockedHostname,
  isIP,
  isPublicIp,
  normalizeRecordType,
  parseHost,
  parsePort,
  readJsonLimited,
} from './shared/net-utils.ts';
import { SECURITY_HEADERS } from './shared/headers.ts';
import { lookupGeo } from './shared/geo.ts';
import { fetchCtPayload } from './shared/ct.ts';
import { MemoryRateStore, type RateStore } from './shared/rate-limit.ts';
import { turnstileEnabled } from './shared/turnstile.ts';
import { createRateStore } from './server/rate-store.ts';
import {
  BlockedTargetError,
  asyncHandler,
  bandwidthBudget,
  concurrencyLimit,
  humanGate,
  parseAllowedOrigins,
  rateLimit,
  requirePublicHost,
  resolvePublicAddress,
  safeHeadRequest,
  safeLookup,
  securityHeaders,
  sendError,
  turnstileConfigFromEnv,
  turnstileVerifyHandler,
} from './server/security.ts';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const isProd = process.env.NODE_ENV === 'production';
const app = express();
const port = process.env.PORT ? parseInt(process.env.PORT, 10) : 3000;

app.disable('x-powered-by');

// Detrás de un proxy/CDN hay que declararlo: si no, req.ip es la IP del proxy (el rate limit
// sería global) y X-Forwarded-For sería falsificable. Use el nº de saltos de confianza (p. ej. 1).
const trustProxyEnv = process.env.TRUST_PROXY?.trim();
if (trustProxyEnv) {
  app.set('trust proxy', /^\d+$/.test(trustProxyEnv) ? Number(trustProxyEnv) : trustProxyEnv === 'true' ? 1 : trustProxyEnv);
}

app.use(securityHeaders({ production: isProd, headers: SECURITY_HEADERS }));
app.use(compression());

// CORS: por defecto SOLO mismo origen (el front lo sirve este mismo servidor).
// Para permitir otros orígenes, defina ALLOWED_ORIGINS="https://a.com,https://b.com". Nunca con credenciales.
const allowedOrigins = parseAllowedOrigins(process.env.ALLOWED_ORIGINS);
if (allowedOrigins.length > 0) {
  app.use('/api', cors({ origin: allowedOrigins, methods: ['GET', 'POST', 'OPTIONS'], maxAge: 600 }));
}

// Almacén de contadores. Arranca en memoria y startServer() lo sustituye por Redis si hay REDIS_URL;
// con varias instancias, Redis hace que el límite sea GLOBAL (no N veces mayor). Si Redis falla, cae a memoria.
const rateStoreRef: { current: RateStore } = { current: new MemoryRateStore() };
const rateStore: RateStore = { hit: (...args) => rateStoreRef.current.hit(...args) };

// Límites de ritmo. El speed test queda fuera del límite general (hace muchas peticiones por diseño)
// y se protege con límite de concurrencia (por instancia) y presupuesto de ancho de banda (global).
const generalLimiter = rateLimit({ name: 'general', store: rateStore, windowMs: 60_000, max: 120 });
const heavyLimiter = rateLimit({ name: 'heavy', store: rateStore, windowMs: 60_000, max: 20, message: 'Demasiadas comprobaciones activas. Espere un minuto.' });
const portScanLimiter = rateLimit({ name: 'ports', store: rateStore, windowMs: 60_000, max: 8, message: 'Límite de comprobaciones de puertos alcanzado. Espere un minuto.' });
const tracerouteLimiter = rateLimit({ name: 'trace', store: rateStore, windowMs: 60_000, max: 6, message: 'Límite de trazados alcanzado. Espere un minuto.' });
const verifyLimiter = rateLimit({ name: 'verify', store: rateStore, windowMs: 60_000, max: 10, message: 'Demasiados intentos de verificación. Espere un minuto.' });

// Turnstile: desactivado si faltan TURNSTILE_SITE_KEY / TURNSTILE_SECRET_KEY
const turnstile = turnstileConfigFromEnv();
const humanOnly = humanGate(turnstile);

app.use('/api', (req, res, next) => (req.path.startsWith('/speedtest') ? next() : generalLimiter(req, res, next)));

// Configuración pública para el frontend (así un mismo build sirve con o sin Turnstile)
app.get('/api/config', (_req, res) => {
  res.json({ turnstileSiteKey: turnstileEnabled(turnstile) ? turnstile.siteKey : null });
});
app.post('/api/turnstile/verify', verifyLimiter, express.json({ limit: '4kb' }), turnstileVerifyHandler(turnstile));

// -------------------------------------------------------------
// 1. DNS Lookup API (Con Fallback en Cascada entre Proveedores)
// Proveedores: Google DoH -> Cloudflare DoH -> Quad9 -> Node Native
// -------------------------------------------------------------
app.get('/api/dns', asyncHandler(async (req: Request, res: Response) => {
  const name = cleanHost(req.query.name as string);
  const type = normalizeRecordType(req.query.type);

  if (!name) {
    return res.status(400).json({ error: 'El nombre de dominio o host es obligatorio o no es válido' });
  }
  if (!type) {
    return res.status(400).json({ error: 'Tipo de registro DNS no admitido' });
  }

  const startTime = Date.now();
  const providers = [
    {
      name: 'Google DoH',
      url: `https://dns.google/resolve?name=${encodeURIComponent(name)}&type=${encodeURIComponent(type)}`,
      headers: { Accept: 'application/json' },
    },
    {
      name: 'Cloudflare DoH',
      url: `https://cloudflare-dns.com/dns-query?name=${encodeURIComponent(name)}&type=${encodeURIComponent(type)}`,
      headers: { Accept: 'application/dns-json' },
    },
    {
      name: 'DNS.SB DoH',
      url: `https://doh.dns.sb/dns-query?name=${encodeURIComponent(name)}&type=${encodeURIComponent(type)}`,
      headers: { Accept: 'application/dns-json' },
    },
  ];

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

  const fallbacksAttempted: string[] = [];

  for (const provider of providers) {
    try {
      fallbacksAttempted.push(provider.name);
      const resp = await fetch(provider.url, {
        headers: provider.headers,
        signal: AbortSignal.timeout(4000),
      });

      if (resp.ok) {
        const data = await resp.json();
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

        return res.json({
          query: { name, type },
          status: statusMap[data.Status] || `CODE_${data.Status}`,
          statusCode: data.Status,
          durationMs: duration,
          truncated: Boolean(data.TC),
          recursionDesired: Boolean(data.RD),
          recursionAvailable: Boolean(data.RA),
          records,
          authority,
          providerUsed: provider.name,
          fallbacksAttempted,
          raw: data,
        });
      }
    } catch {
      // continuar con el siguiente proveedor
    }
  }

  // Fallback nativo de Node.js si todos los DoH fallan
  try {
    fallbacksAttempted.push('Node.js Native DNS');
    const nativeRecords: any[] = [];
    if (type === 'A') {
      const ips = await dns.promises.resolve4(name);
      ips.forEach((ip) => nativeRecords.push({ name, type: 'A', TTL: 300, data: ip }));
    } else if (type === 'AAAA') {
      const ips = await dns.promises.resolve6(name);
      ips.forEach((ip) => nativeRecords.push({ name, type: 'AAAA', TTL: 300, data: ip }));
    } else if (type === 'MX') {
      const mx = await dns.promises.resolveMx(name);
      mx.forEach((m) => nativeRecords.push({ name, type: 'MX', TTL: 300, data: `${m.priority} ${m.exchange}` }));
    } else if (type === 'TXT') {
      const txt = await dns.promises.resolveTxt(name);
      txt.forEach((t) => nativeRecords.push({ name, type: 'TXT', TTL: 300, data: t.join(' ') }));
    } else if (type === 'NS') {
      const ns = await dns.promises.resolveNs(name);
      ns.forEach((n) => nativeRecords.push({ name, type: 'NS', TTL: 300, data: n }));
    } else if (type === 'CNAME') {
      const cname = await dns.promises.resolveCname(name);
      cname.forEach((c) => nativeRecords.push({ name, type: 'CNAME', TTL: 300, data: c }));
    } else {
      const anyRec = await dns.promises.resolve(name, type as any);
      nativeRecords.push({ name, type, TTL: 300, data: JSON.stringify(anyRec) });
    }

    return res.json({
      query: { name, type },
      status: 'NOERROR',
      statusCode: 0,
      durationMs: Date.now() - startTime,
      records: nativeRecords,
      authority: [],
      providerUsed: 'Node.js Resolver Local',
      fallbacksAttempted,
      fallback: true,
    });
  } catch (err: any) {
    return res.status(500).json({
      error: `No se pudieron resolver registros DNS para '${name}' (${type}). Compruebe la sintaxis o existencia del dominio.`,
      status: err.code || 'ERROR',
      query: { name, type },
      fallbacksAttempted,
    });
  }
}));

// -------------------------------------------------------------
// 2. DNS Propagation API (8 Resolutores Globales)
// -------------------------------------------------------------
app.get('/api/dns-propagation', asyncHandler(async (req: Request, res: Response) => {
  const name = cleanHost(req.query.name as string);
  const type = normalizeRecordType(req.query.type);

  if (!name) {
    return res.status(400).json({ error: 'El dominio o host es obligatorio o no es válido' });
  }
  if (!type) {
    return res.status(400).json({ error: 'Tipo de registro DNS no admitido' });
  }

  const resolvers = [
    {
      id: 'cloudflare',
      name: 'Cloudflare Anycast',
      location: 'Norteamérica / Global',
      country: 'US',
      ip: '1.1.1.1',
      endpoint: (h: string, t: string) => `https://cloudflare-dns.com/dns-query?name=${encodeURIComponent(h)}&type=${encodeURIComponent(t)}`,
      headers: { Accept: 'application/dns-json' },
    },
    {
      id: 'google_global',
      name: 'Google Public DNS',
      location: 'Anycast Mundial',
      country: 'US',
      ip: '8.8.8.8',
      endpoint: (h: string, t: string) => `https://dns.google/resolve?name=${encodeURIComponent(h)}&type=${encodeURIComponent(t)}`,
      headers: { Accept: 'application/json' },
    },
    {
      id: 'google_europe',
      name: 'Google DNS (Europa)',
      location: 'Fráncfort, Alemania',
      country: 'DE',
      ip: '8.8.4.4',
      endpoint: (h: string, t: string) => `https://dns.google/resolve?name=${encodeURIComponent(h)}&type=${encodeURIComponent(t)}&edns_client_subnet=194.25.0.0/24`,
      headers: { Accept: 'application/json' },
    },
    {
      id: 'google_asia',
      name: 'Google DNS (Asia-Pacífico)',
      location: 'Tokio, Japón',
      country: 'JP',
      ip: '8.8.8.8',
      endpoint: (h: string, t: string) => `https://dns.google/resolve?name=${encodeURIComponent(h)}&type=${encodeURIComponent(t)}&edns_client_subnet=210.140.0.0/24`,
      headers: { Accept: 'application/json' },
    },
    {
      id: 'google_sa',
      name: 'Google DNS (Sudamérica)',
      location: 'São Paulo, Brasil',
      country: 'BR',
      ip: '8.8.4.4',
      endpoint: (h: string, t: string) => `https://dns.google/resolve?name=${encodeURIComponent(h)}&type=${encodeURIComponent(t)}&edns_client_subnet=200.160.0.0/24`,
      headers: { Accept: 'application/json' },
    },
    {
      id: 'google_oceania',
      name: 'Google DNS (Oceanía)',
      location: 'Sídney, Australia',
      country: 'AU',
      ip: '8.8.8.8',
      endpoint: (h: string, t: string) => `https://dns.google/resolve?name=${encodeURIComponent(h)}&type=${encodeURIComponent(t)}&edns_client_subnet=139.130.0.0/24`,
      headers: { Accept: 'application/json' },
    },
    {
      id: 'dns_sb',
      name: 'DNS.SB',
      location: 'Fráncfort / Singapur',
      country: 'SG',
      ip: '185.222.222.222',
      endpoint: (h: string, t: string) => `https://doh.dns.sb/dns-query?name=${encodeURIComponent(h)}&type=${encodeURIComponent(t)}`,
      headers: { Accept: 'application/dns-json' },
    },
    {
      id: 'alidns',
      name: 'Alibaba Cloud DNS',
      location: 'Hangzhou, China',
      country: 'CN',
      ip: '223.5.5.5',
      endpoint: (h: string, t: string) => `https://dns.alidns.com/resolve?name=${encodeURIComponent(h)}&type=${encodeURIComponent(t)}`,
      headers: { Accept: 'application/json' },
    },
  ];

  const results = await Promise.allSettled(
    resolvers.map(async (resItem) => {
      const start = Date.now();
      try {
        const resp = await fetch(resItem.endpoint(name, type), {
          headers: resItem.headers,
          signal: AbortSignal.timeout(4500),
        });
        const duration = Date.now() - start;
        if (!resp.ok) {
          return {
            resolver: resItem.name,
            ip: resItem.ip,
            location: resItem.location,
            country: resItem.country,
            status: `HTTP_${resp.status}`,
            durationMs: duration,
            records: [],
            success: false,
          };
        }
        const json = await resp.json();
        const answers = (json.Answer || []).map((a: any) => a.data);
        return {
          resolver: resItem.name,
          ip: resItem.ip,
          location: resItem.location,
          country: resItem.country,
          status: json.Status === 0 ? 'RESOLVED' : json.Status === 3 ? 'NXDOMAIN' : `CODE_${json.Status}`,
          durationMs: duration,
          records: answers,
          success: json.Status === 0 && answers.length > 0,
        };
      } catch (err: any) {
        return {
          resolver: resItem.name,
          ip: resItem.ip,
          location: resItem.location,
          country: resItem.country,
          status: 'TIMEOUT',
          durationMs: Date.now() - start,
          records: [],
          success: false,
          error: err.message || 'Tiempo de espera agotado',
        };
      }
    })
  );

  const formatted = results.map((r, i) =>
    r.status === 'fulfilled'
      ? r.value
      : {
          resolver: resolvers[i].name,
          ip: resolvers[i].ip,
          location: resolvers[i].location,
          country: resolvers[i].country,
          status: 'ERROR',
          durationMs: 4500,
          records: [],
          success: false,
        }
  );

  const allResolvedRecords = formatted
    .filter((f) => f.success && f.records.length > 0)
    .map((f) => f.records.sort().join(','));

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

  res.json({
    query: { name, type },
    propagationPercent,
    majorityRecords: majoritySignature ? majoritySignature.split(',') : [],
    resolvers: formatted.map((item) => ({
      ...item,
      matchesMajority: item.records.sort().join(',') === majoritySignature,
    })),
  });
}));

// -------------------------------------------------------------
// 3. DNSSEC Checker API (Nuevo)
// Consulta DNSKEY, DS y RRSIG para validar la cadena de confianza
// -------------------------------------------------------------
app.get('/api/dnssec', asyncHandler(async (req: Request, res: Response) => {
  const name = cleanHost(req.query.name as string);

  if (!name) {
    return res.status(400).json({ error: 'El dominio es obligatorio' });
  }

  const startTime = Date.now();

  try {
    // 1. Consultar registro DNSKEY del dominio con DoH pidiendo DNSSEC (do=true)
    const [dnskeyRes, dsRes, aRes] = await Promise.allSettled([
      fetch(`https://dns.google/resolve?name=${encodeURIComponent(name)}&type=DNSKEY&do=true`, {
        headers: { Accept: 'application/json' },
        signal: AbortSignal.timeout(5000),
      }).then((r) => r.json()),
      fetch(`https://dns.google/resolve?name=${encodeURIComponent(name)}&type=DS&do=true`, {
        headers: { Accept: 'application/json' },
        signal: AbortSignal.timeout(5000),
      }).then((r) => r.json()),
      fetch(`https://dns.google/resolve?name=${encodeURIComponent(name)}&type=A&do=true`, {
        headers: { Accept: 'application/json' },
        signal: AbortSignal.timeout(5000),
      }).then((r) => r.json()),
    ]);

    const dnskeyData = dnskeyRes.status === 'fulfilled' ? dnskeyRes.value : null;
    const dsData = dsRes.status === 'fulfilled' ? dsRes.value : null;
    const aData = aRes.status === 'fulfilled' ? aRes.value : null;

    const dnskeyAnswers = (dnskeyData?.Answer || []).filter((a: any) => a.type === 48);
    const dsAnswers = (dsData?.Answer || []).filter((a: any) => a.type === 43);
    const rrsigAnswers = [
      ...(dnskeyData?.Answer || []),
      ...(dsData?.Answer || []),
      ...(aData?.Answer || []),
    ].filter((a: any) => a.type === 46);

    const isSecure = Boolean(aData?.AD); // Authenticated Data flag
    const hasDnskey = dnskeyAnswers.length > 0;
    const hasDs = dsAnswers.length > 0;
    const hasRrsig = rrsigAnswers.length > 0;

    // Decodificar DNSKEY
    const keys = dnskeyAnswers.map((k: any) => {
      const parts = k.data.split(' ');
      const flags = parseInt(parts[0], 10);
      const protocol = parts[1];
      const algorithmCode = parseInt(parts[2], 10);
      const isKSK = flags === 257;
      const isZSK = flags === 256;

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

    // Decodificar DS (Delegation Signer)
    const dsRecords = dsAnswers.map((d: any) => {
      const parts = d.data.split(' ');
      const keyTag = parts[0];
      const algorithm = parts[1];
      const digestType = parts[2];
      const digest = parts.slice(3).join('');

      const digestTypeMap: Record<string, string> = {
        '1': 'SHA-1',
        '2': 'SHA-256',
        '4': 'SHA-384',
      };

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

    res.json({
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
    res.status(500).json({
      error: err.message || 'Error al validar DNSSEC',
      domain: name,
    });
  }
}));

// -------------------------------------------------------------
// 4. IP Geolocation API (Con Fallback en Cascada entre Proveedores)
// Proveedores (HTTPS primero): ipwho.is -> ipapi.co -> ip-api.com (solo HTTP en su plan gratuito: último recurso)
// -------------------------------------------------------------
app.get('/api/ip', asyncHandler(async (req: Request, res: Response) => {
  const raw = typeof req.query.ip === 'string' ? req.query.ip.trim() : '';
  const wantsSelf = !raw || raw === 'me' || raw === 'self';
  let target = '';

  if (wantsSelf) {
    // req.ip respeta TRUST_PROXY; nunca se lee X-Forwarded-For directamente (es falsificable).
    const client = (req.ip || req.socket.remoteAddress || '').replace(/^::ffff:/, '');
    // En desarrollo local (IP privada/loopback) se deja vacío y el proveedor usa la IP de salida del servidor.
    target = client && isPublicIp(client) ? client : '';
  } else {
    const parsed = parseHost(raw);
    if (!parsed) return res.status(400).json({ error: 'La dirección IP o dominio indicado no es válido' });
    if (parsed.kind === 'domain') {
      if (isBlockedHostname(parsed.host)) {
        return res.status(400).json({ error: 'Solo se pueden geolocalizar direcciones públicas de Internet.' });
      }
      try {
        target = (await dns.promises.lookup(parsed.host)).address;
      } catch {
        return res.status(404).json({ error: `No se pudo resolver '${parsed.host}' a una dirección IP.` });
      }
    } else {
      target = parsed.host;
    }
    if (!isPublicIp(target)) {
      return res.status(400).json({ error: 'Es una dirección privada o reservada: no tiene geolocalización pública.' });
    }
  }

  const startTime = Date.now();
  try {
    const result = await lookupGeo(target);
    res.json({ ...result, durationMs: Date.now() - startTime });
  } catch (err: any) {
    res.status(502).json({
      error: `No se pudo geolocalizar la IP '${target || 'cliente'}'. Todos los proveedores gratuitos fallaron o agotaron su tiempo de espera.`,
      fallbacksAttempted: err?.fallbacksAttempted ?? [],
    });
  }
}));

// -------------------------------------------------------------
// 5. SSL / TLS Certificate Inspector API
// rejectUnauthorized=false es deliberado: el objetivo es INSPECCIONAR también certificados
// caducados o autofirmados. Por eso el destino se restringe a IPs públicas (safeLookup).
// -------------------------------------------------------------
app.get('/api/ssl', heavyLimiter, humanOnly, asyncHandler(async (req: Request, res: Response) => {
  const sslPort = parsePort(req.query.port, 443); // barato: se valida antes de tocar la red
  if (sslPort === null) {
    return res.status(400).json({ error: 'El puerto debe estar entre 1 y 65535' });
  }
  let host: string;
  try {
    host = await requirePublicHost(req.query.host);
  } catch (err) {
    return sendError(res, err, 'El host indicado no es válido');
  }

  const startTime = Date.now();
  let settled = false;
  const finish = (fn: () => void) => {
    if (settled) return;
    settled = true;
    clearTimeout(deadline);
    fn();
  };

  const socket = tls.connect(
    {
      host,
      port: sslPort,
      servername: net.isIP(host) ? undefined : host, // SNI no admite IPs
      rejectUnauthorized: false,
      timeout: 6000,
      lookup: safeLookup, // la IP validada es la IP usada: sin ventana para DNS rebinding
    },
    () => {
      finish(() => {
        try {
          const cert: any = socket.getPeerCertificate(true);
          const protocol = socket.getProtocol();
          const cipher = socket.getCipher();
          const authorized = socket.authorized;
          const authError = socket.authorizationError;
          socket.destroy();

          if (!cert || Object.keys(cert).length === 0) {
            return res.status(502).json({ error: 'No se recibió ningún certificado TLS del servidor remoto' });
          }

          const validFrom = new Date(cert.valid_from).toISOString();
          const validTo = new Date(cert.valid_to).toISOString();
          const daysRemaining = Math.round((new Date(cert.valid_to).getTime() - Date.now()) / 86_400_000);
          const isExpired = daysRemaining < 0;

          const chain: any[] = [];
          let curr = cert;
          const seen = new Set();
          while (curr && !seen.has(curr.fingerprint256)) {
            seen.add(curr.fingerprint256);
            chain.push({
              subject: curr.subject?.CN || curr.subject?.O || 'Desconocido',
              issuer: curr.issuer?.CN || curr.issuer?.O || 'Desconocido',
              validFrom: curr.valid_from,
              validTo: curr.valid_to,
              fingerprint256: curr.fingerprint256,
              serialNumber: curr.serialNumber,
            });
            if (curr.issuerCertificate && curr.issuerCertificate !== curr) curr = curr.issuerCertificate;
            else break;
          }

          const sanList: string[] = cert.subjectaltname
            ? cert.subjectaltname.split(',').map((s: string) => s.trim().replace(/^DNS:/, ''))
            : [];

          res.json({
            host,
            port: sslPort,
            authorized,
            authorizationError: authError ? String(authError) : null,
            protocol,
            cipher: cipher ? { name: cipher.name, version: cipher.version } : null,
            durationMs: Date.now() - startTime,
            subject: {
              commonName: cert.subject?.CN || '',
              organization: cert.subject?.O || '',
              organizationalUnit: cert.subject?.OU || '',
              country: cert.subject?.C || '',
              state: cert.subject?.ST || '',
              locality: cert.subject?.L || '',
            },
            issuer: {
              commonName: cert.issuer?.CN || '',
              organization: cert.issuer?.O || '',
              country: cert.issuer?.C || '',
            },
            validFrom,
            validTo,
            daysRemaining,
            isExpired,
            expiryStatus: expiryStatusFor(daysRemaining),
            serialNumber: cert.serialNumber,
            fingerprint256: cert.fingerprint256,
            fingerprint: cert.fingerprint,
            subjectAltNames: sanList,
            chain,
          });
        } catch (innerErr) {
          socket.destroy();
          console.error('[ssl] error al procesar el certificado', innerErr);
          res.status(500).json({ error: 'Error al procesar los datos del certificado' });
        }
      });
    }
  );

  // Plazo duro total: el timeout del socket solo mide inactividad (un servidor lento podría retenerlo)
  const deadline = setTimeout(() => {
    finish(() => {
      socket.destroy();
      res.status(504).json({ error: `Tiempo de espera agotado al conectar a ${host}:${sslPort}` });
    });
  }, 9000);

  socket.on('error', (err: any) => {
    finish(() => {
      socket.destroy();
      if (err instanceof BlockedTargetError) return sendError(res, err, 'Destino no permitido');
      res.status(502).json({
        error: `La conexión TLS a ${host}:${sslPort} falló: ${String(err.message).slice(0, 160)}`,
        code: err.code,
      });
    });
  });

  socket.on('timeout', () => {
    finish(() => {
      socket.destroy();
      res.status(504).json({ error: `Tiempo de espera agotado al conectar a ${host}:${sslPort}` });
    });
  });
}));

// -------------------------------------------------------------
// 6. Certificate Transparency (CT Logs) API
// Consulta crt.sh. Caché de 5 min + deduplicación de peticiones concurrentes (crt.sh es lento
// y tiene límites), y tope de tamaño de respuesta (dominios grandes devuelven decenas de MB).
// -------------------------------------------------------------
app.get('/api/ct-logs', asyncHandler(async (req: Request, res: Response) => {
  const parsed = parseHost(req.query.domain);
  if (!parsed || parsed.kind !== 'domain') {
    return res.status(400).json({ error: 'Introduzca un nombre de dominio válido (no una dirección IP).' });
  }
  const domain = parsed.host;
  const startTime = Date.now();

  try {
    const { rawEntries: _raw, ...payload } = await fetchCtPayload(domain);
    res.json({ ...payload, durationMs: Date.now() - startTime });
  } catch (err: any) {
    if (err instanceof ResponseTooLargeError) {
      return res.status(413).json({
        error: 'Este dominio tiene demasiados certificados registrados para consultarlo completo. Pruebe con un subdominio concreto.',
        domain,
      });
    }
    res.status(502).json({
      error: `Error al consultar logs de Transparencia de Certificados (crt.sh): ${String(err?.message || 'sin respuesta').slice(0, 160)}`,
      domain,
    });
  }
}));

// -------------------------------------------------------------
// 7. HTTP Headers & Security Analyzer API
// Cliente HTTP propio (safeHeadRequest): solo destinos públicos, cada redirección se revalida,
// IP validada = IP conectada, y el cuerpo de la respuesta nunca se descarga.
// -------------------------------------------------------------
app.get('/api/headers', heavyLimiter, humanOnly, asyncHandler(async (req: Request, res: Response) => {
  const rawUrl = typeof req.query.url === 'string' ? req.query.url.trim() : '';
  if (!rawUrl) return res.status(400).json({ error: 'La URL es obligatoria' });
  if (rawUrl.length > 2048) return res.status(400).json({ error: 'La URL es demasiado larga' });

  const targetUrl = /^[a-z][a-z0-9+.-]*:\/\//i.test(rawUrl) ? rawUrl : `https://${rawUrl}`;
  const startTime = Date.now();

  try {
    const r = await safeHeadRequest(targetUrl, { timeoutMs: 8000 });
    res.json({
      url: targetUrl,
      finalUrl: r.finalUrl,
      statusCode: r.status,
      statusText: r.statusText,
      durationMs: Date.now() - startTime,
      headers: r.headers,
      ...analyzeSecurityHeaders(r.headers),
    });
  } catch (err) {
    sendError(res, err, 'No se pudieron obtener los encabezados HTTP del destino', { url: targetUrl });
  }
}));

// -------------------------------------------------------------
// 8. HTTP/2 & HTTP/3 Support Checker API
// Prueba ALPN TLS (h2, http/1.1) y analiza Alt-Svc / registro DNS HTTPS para HTTP/3 (QUIC)
// -------------------------------------------------------------
app.get('/api/http-versions', heavyLimiter, humanOnly, asyncHandler(async (req: Request, res: Response) => {
  let host: string;
  try {
    host = await requirePublicHost(req.query.host);
  } catch (err) {
    return sendError(res, err, 'El host indicado no es válido');
  }

  const startTime = Date.now();
  let settled = false;
  const finish = (fn: () => void) => {
    if (settled) return;
    settled = true;
    fn();
  };

  const socket = tls.connect(
    {
      host,
      port: 443,
      servername: net.isIP(host) ? undefined : host,
      ALPNProtocols: ['h2', 'http/1.1'],
      rejectUnauthorized: false,
      timeout: 5000,
      lookup: safeLookup,
    },
    () => {
      const alpnProtocol = socket.alpnProtocol;
      const durationMs = Date.now() - startTime;
      socket.destroy();

      // Alt-Svc (cabeceras) y registro DNS HTTPS se consultan en paralelo (antes: en serie)
      const urlHost = net.isIPv6(host) ? `[${host}]` : host;
      Promise.all([
        safeHeadRequest(`https://${urlHost}`, { timeoutMs: 4000, maxRedirects: 0 }).catch(() => null),
        fetch(`https://cloudflare-dns.com/dns-query?name=${encodeURIComponent(host)}&type=HTTPS`, {
          headers: { Accept: 'application/dns-json' },
          signal: AbortSignal.timeout(3000),
        })
          .then((r) => (r.ok ? readJsonLimited<any>(r, 256 * 1024) : null))
          .catch(() => null),
      ]).then(([head, doh]) => {
        const altSvcHeader: string | null = head?.headers['alt-svc'] ?? null;
        let hasHttp3 = Boolean(altSvcHeader && (altSvcHeader.includes('h3=') || altSvcHeader.includes('h3-')));
        for (const ans of doh?.Answer || []) {
          if (String(ans.data || '').includes('h3')) hasHttp3 = true;
        }
        const supportsHttp2 = alpnProtocol === 'h2';

        finish(() =>
          res.json({
            host,
            durationMs,
            negotiatedProtocol: alpnProtocol || 'http/1.1',
            supports: { http1: true, http2: supportsHttp2, http3: hasHttp3 },
            protocols: [
              { name: 'HTTP/1.1', supported: true, transport: 'TCP / TLS', statusText: 'Soportado universalmente' },
              {
                name: 'HTTP/2 (h2)',
                supported: supportsHttp2,
                transport: 'TCP / TLS ALPN',
                statusText: supportsHttp2 ? 'Activo (Multiplexación y compresión HPACK)' : 'No negociado en ALPN',
              },
              {
                name: 'HTTP/3 (QUIC)',
                supported: hasHttp3,
                transport: 'UDP / QUIC',
                statusText: hasHttp3 ? `Publicitado en Alt-Svc (${altSvcHeader ?? 'registro DNS HTTPS'})` : 'No publicitado en Alt-Svc',
              },
            ],
            altSvc: altSvcHeader,
          })
        );
      });
    }
  );

  socket.on('error', (err: any) => {
    finish(() => {
      socket.destroy();
      if (err instanceof BlockedTargetError) return sendError(res, err, 'Destino no permitido');
      res.status(502).json({
        error: `Error al probar la negociación de versiones HTTP en ${host}: ${String(err.message).slice(0, 160)}`,
        host,
      });
    });
  });

  socket.on('timeout', () => {
    finish(() => {
      socket.destroy();
      res.status(504).json({ error: `Tiempo de espera agotado probando ALPN en ${host}`, host });
    });
  });
}));

// -------------------------------------------------------------
// 9. Visual Traceroute API (Nuevo)
// Integración con API pública comunitaria Globalping (gratuita, sin keys)
// con fallback a saltos de latencia de red
// -------------------------------------------------------------
const TRACE_REGIONS = new Set(['EU', 'NA', 'AS', 'SA', 'OC', 'AF', 'WORLD', 'MUNDIAL']);

app.get('/api/traceroute', tracerouteLimiter, humanOnly, asyncHandler(async (req: Request, res: Response) => {
  let target: string;
  try {
    target = await requirePublicHost(req.query.target); // evita usar la cuota de Globalping contra destinos privados/inválidos
  } catch (err) {
    return sendError(res, err, 'El destino indicado no es válido');
  }
  const rawLimit = req.query.limit ? parseInt(req.query.limit as string, 10) : 3;
  const limit = Math.min(5, Math.max(1, isNaN(rawLimit) ? 3 : rawLimit));
  const region = (typeof req.query.region === 'string' ? req.query.region : 'EU').trim();
  if (!TRACE_REGIONS.has(region.toUpperCase())) {
    return res.status(400).json({ error: 'Región no admitida. Use EU, NA, AS, SA, OC, AF o world.' });
  }

  const startTime = Date.now();

  try {
    const locations = region.toLowerCase() === 'world' || region.toLowerCase() === 'mundial'
      ? [{ magic: 'world' }]
      : [{ continent: region.toUpperCase() }];

    // 1. Crear medición multi-sonda en Globalping API pública
    const gpResp = await fetch('https://api.globalping.io/v1/measurements', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'User-Agent': 'NetCheck/1.0 (Network Tools Hub; Diagnostic Probe)',
      },
      body: JSON.stringify({
        type: 'traceroute',
        target,
        limit,
        locations,
      }),
      signal: AbortSignal.timeout(6000),
    });

    if (gpResp.ok) {
      const createData: any = await gpResp.json();
      const measurementId = createData.id;

      // Consultar resultado esperando que todas las sondas finalicen
      let pollData: any = null;
      for (let attempt = 0; attempt < 9; attempt++) {
        await new Promise((resolve) => setTimeout(resolve, attempt === 0 ? 1500 : 1000));
        const pollResp = await fetch(`https://api.globalping.io/v1/measurements/${measurementId}`, {
          headers: { 'User-Agent': 'NetCheck/1.0' },
          signal: AbortSignal.timeout(5000),
        });
        if (pollResp.ok) {
          pollData = await pollResp.json();
          const allCompleted =
            pollData.status === 'finished' ||
            (Array.isArray(pollData.results) &&
              pollData.results.length >= limit &&
              pollData.results.every((r: any) => r.result?.status === 'finished' || Boolean(r.result?.rawOutput)));
          if (allCompleted) {
            break;
          }
        }
      }

      if (pollData && Array.isArray(pollData.results) && pollData.results.length > 0) {
        // Consultar metadatos del destino (IP, Organización, ASN, País)
        const firstResolved = pollData.results.find((r: any) => r.result?.resolvedAddress)?.result?.resolvedAddress || target;
        let destMeta: { ip: string; country: string; org: string; asn?: number } = {
          ip: firstResolved,
          country: 'US',
          org: 'Destino Remoto',
        };

        try {
          if (firstResolved && firstResolved !== target) {
            const ipResp = await fetch(`https://ipwho.is/${encodeURIComponent(firstResolved)}`, {
              signal: AbortSignal.timeout(2000),
            });
            if (ipResp.ok) {
              const ipData = await ipResp.json();
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
          // Fallback a valores por defecto
        }

        const probes = pollData.results.map((item: any, idx: number) => {
          const probeInfo = item.probe || {};
          const resultInfo = item.result || {};
          const rawHops = resultInfo.hops || [];

          const hops = rawHops.map((hop: any, hIdx: number) => {
            const tim = hop.timings?.[0]?.rtt || null;
            return {
              hop: hIdx + 1,
              ip: hop.resolvedAddress || hop.ip || '*',
              hostname: hop.resolvedHostname || hop.hostname || null,
              rttMs: typeof tim === 'number' ? Math.round(tim * 10) / 10 : null,
              loss: !hop.timings || hop.timings.length === 0,
            };
          });

          // Extraer tiempo final de la sonda
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

        return res.json({
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
    // Continuar con resolución de saltos asistida
  }

  // Antes aquí se fabricaba un trazado falso (saltos 10.0.0.1, 192.168.1.254, "Hetzner", "Wikimedia"...)
  // que se mostraba al usuario como si fuera real. Ahora se informa del fallo con honestidad.
  res.status(502).json({
    error: 'El servicio de trazado (Globalping) no está disponible o no devolvió resultados. Inténtelo de nuevo en unos minutos.',
    target,
  });
}));

// -------------------------------------------------------------
// 10. Port Checker API
// Resuelve el host UNA vez, comprueba que sea público y conecta por IP: sin rebinding y 1 DNS por escaneo.
// -------------------------------------------------------------
const COMMON_PORTS = [
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

type PortStatus = 'OPEN' | 'CLOSED' | 'FILTERED';

function checkSinglePort(
  ip: string,
  portNumber: number,
  timeoutMs = 3000
): Promise<{ port: number; open: boolean; durationMs: number; status: PortStatus }> {
  return new Promise((resolve) => {
    const startTime = Date.now();
    const socket = new net.Socket();
    let done = false;
    const finish = (status: PortStatus) => {
      if (done) return;
      done = true;
      socket.destroy();
      resolve({ port: portNumber, open: status === 'OPEN', durationMs: Date.now() - startTime, status });
    };

    socket.setTimeout(timeoutMs);
    socket.once('connect', () => finish('OPEN'));
    socket.once('timeout', () => finish('FILTERED'));
    // Solo ECONNREFUSED prueba "cerrado". Antes ENOTFOUND también contaba como CLOSED (falso: ni siquiera se llegó al host).
    socket.once('error', (err: NodeJS.ErrnoException) => finish(err.code === 'ECONNREFUSED' ? 'CLOSED' : 'FILTERED'));
    socket.connect(portNumber, ip);
  });
}

app.get('/api/port-check', portScanLimiter, humanOnly, asyncHandler(async (req: Request, res: Response) => {
  const parsedHost = parseHost(req.query.host);
  if (!parsedHost) {
    return res.status(400).json({ error: 'El host o dirección IP es obligatorio o no es válido' });
  }
  const host = parsedHost.host;

  const hasCustomPort = req.query.port !== undefined && req.query.port !== '';
  const customPort = hasCustomPort ? parsePort(req.query.port) : null;
  if (hasCustomPort && customPort === null) {
    return res.status(400).json({ error: 'El puerto debe estar entre 1 y 65535' });
  }

  let ip: string;
  try {
    ip = (await resolvePublicAddress(host)).address;
  } catch (err) {
    return sendError(res, err, 'No se pudo comprobar el host indicado', { host });
  }

  if (customPort !== null) {
    const foundService = COMMON_PORTS.find((p) => p.port === customPort);
    const result = await checkSinglePort(ip, customPort, 3500);
    return res.json({
      host,
      results: [
        {
          ...result,
          service: foundService ? foundService.service : 'Servicio Personalizado',
          protocol: foundService ? foundService.protocol : 'TCP',
        },
      ],
      summary: {
        total: 1,
        open: result.open ? 1 : 0,
        closed: result.status === 'CLOSED' ? 1 : 0,
        filtered: result.status === 'FILTERED' ? 1 : 0,
      },
    });
  }

  const results = await Promise.all(
    COMMON_PORTS.map(async (def) => ({ ...(await checkSinglePort(ip, def.port, 2200)), service: def.service, protocol: def.protocol }))
  );

  res.json({
    host,
    results,
    summary: {
      total: results.length,
      open: results.filter((r) => r.open).length,
      closed: results.filter((r) => r.status === 'CLOSED').length,
      filtered: results.filter((r) => r.status === 'FILTERED').length,
    },
  });
}));

// -------------------------------------------------------------
// 11. Whois & RDAP Lookup API (Con Fallback Multirregistro)
// -------------------------------------------------------------
app.get('/api/whois', asyncHandler(async (req: Request, res: Response) => {
  const query = cleanHost(req.query.query as string);

  if (!query) {
    return res.status(400).json({ error: 'El dominio o IP es obligatorio' });
  }

  const isIp = net.isIP(query);
  const endpoints: string[] = [];

  if (isIp) {
    endpoints.push(`https://rdap.arin.net/registry/ip/${encodeURIComponent(query)}`);
    endpoints.push(`https://rdap.org/ip/${encodeURIComponent(query)}`);
  } else {
    const tld = query.split('.').pop()?.toLowerCase();
    if (tld === 'com') {
      endpoints.push(`https://rdap.verisign.com/com/v1/domain/${encodeURIComponent(query)}`);
    } else if (tld === 'net') {
      endpoints.push(`https://rdap.verisign.com/net/v1/domain/${encodeURIComponent(query)}`);
    } else if (tld === 'org') {
      endpoints.push(`https://rdap.publicinterestregistry.org/rdap/domain/${encodeURIComponent(query)}`);
    }
    endpoints.push(`https://rdap.org/domain/${encodeURIComponent(query)}`);
  }

  try {
    let data: any = null;
    let lastErrorStatus = 500;

    for (const ep of endpoints) {
      try {
        const rdapResp = await fetch(ep, {
          headers: {
            Accept: 'application/rdap+json, application/json',
            'User-Agent': 'NetCheck/1.0 (Network Tools Hub; Diagnostic RDAP Query)',
          },
          signal: AbortSignal.timeout(5000),
        });

        if (rdapResp.ok) {
          data = await rdapResp.json();
          break;
        } else {
          lastErrorStatus = rdapResp.status;
        }
      } catch {
        // siguiente endpoint
      }
    }

    if (!data) {
      return res.status(lastErrorStatus || 404).json({
        error: `No se encontraron datos de registro RDAP para '${query}'`,
        query,
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

    res.json({
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
  } catch (err: any) {
    res.status(500).json({
      error: `Error en consulta RDAP: ${err.message}`,
      query,
    });
  }
}));

// -------------------------------------------------------------
// 12. Speed Test Endpoints (Ping, Download, Upload)
// Protegidos con: concurrencia por IP/total, presupuesto de bytes por IP y tope de subida.
// -------------------------------------------------------------
const RANDOM_SPEED_CHUNK = crypto.randomBytes(64 * 1024); // 64 KB aleatorios pre-generados: ancho de banda alto sin coste de CPU
const MAX_DOWNLOAD_BYTES = 25 * 1024 * 1024;
const MAX_UPLOAD_BYTES = 32 * 1024 * 1024;
const NO_STORE = 'no-store, no-cache, must-revalidate, max-age=0';

const downloadBytes = (req: Request) => {
  const n = parseInt(req.query.bytes as string, 10);
  return Math.min(Math.max(!isNaN(n) ? n : 5 * 1024 * 1024, 64 * 1024), MAX_DOWNLOAD_BYTES);
};
const speedConcurrency = concurrencyLimit({ perIp: 6, total: 40 });
const downloadBudget = bandwidthBudget({ store: rateStore, windowMs: 10 * 60_000, maxBytes: 2 * 1024 ** 3, bytesOf: downloadBytes });

app.get('/api/speedtest/ping', (_req, res) => {
  res.setHeader('Cache-Control', NO_STORE);
  res.setHeader('Pragma', 'no-cache');
  res.json({ pong: true, time: Date.now() });
});

app.get('/api/speedtest/download', speedConcurrency, downloadBudget, (req, res) => {
  const totalBytes = downloadBytes(req);

  res.setHeader('Content-Type', 'application/octet-stream');
  res.setHeader('Content-Length', totalBytes.toString());
  res.setHeader('Cache-Control', NO_STORE);
  res.setHeader('Pragma', 'no-cache');

  let bytesSent = 0;
  let closed = false;
  res.on('close', () => {
    closed = true; // el cliente cortó: dejar de escribir
  });

  const sendChunk = () => {
    while (!closed && bytesSent < totalBytes) {
      const chunkSize = Math.min(totalBytes - bytesSent, RANDOM_SPEED_CHUNK.length);
      const slice = chunkSize === RANDOM_SPEED_CHUNK.length ? RANDOM_SPEED_CHUNK : RANDOM_SPEED_CHUNK.subarray(0, chunkSize);
      bytesSent += chunkSize;
      if (!res.write(slice)) {
        res.once('drain', sendChunk);
        return;
      }
    }
    if (!closed) res.end();
  };

  sendChunk();
});

app.post('/api/speedtest/upload', speedConcurrency, (req, res) => {
  const startTime = Date.now();
  const declared = Number(req.headers['content-length']);
  if (Number.isFinite(declared) && declared > MAX_UPLOAD_BYTES) {
    res.setHeader('Connection', 'close');
    return res.status(413).json({ error: `Tamaño máximo de subida: ${MAX_UPLOAD_BYTES / 1024 / 1024} MB` });
  }

  let receivedBytes = 0;
  let aborted = false;

  req.on('data', (chunk: Buffer) => {
    receivedBytes += chunk.length;
    if (receivedBytes > MAX_UPLOAD_BYTES && !aborted) {
      aborted = true; // Content-Length ausente o falsificado (chunked): cortar igualmente
      res.setHeader('Connection', 'close');
      res.status(413).json({ error: `Tamaño máximo de subida: ${MAX_UPLOAD_BYTES / 1024 / 1024} MB` });
      req.destroy();
    }
  });

  req.on('end', () => {
    if (aborted) return;
    const durationMs = Math.max(1, Date.now() - startTime);
    const mbps = (receivedBytes * 8) / (durationMs / 1000) / 1_000_000;
    res.setHeader('Cache-Control', NO_STORE);
    res.json({ receivedBytes, durationMs, mbps: Math.round(mbps * 100) / 100 });
  });

  req.on('error', () => {
    if (!res.headersSent) res.status(400).json({ error: 'La subida se interrumpió' });
  });
});

// -------------------------------------------------------------
// Montaje: API 404 → estáticos (producción) o Vite (desarrollo) → manejador global de errores
// -------------------------------------------------------------
app.use('/api', (_req, res) => {
  res.status(404).json({ error: 'Endpoint no encontrado' });
});

async function startServer() {
  const rate = await createRateStore();
  rateStoreRef.current = rate.store;
  console.log(`Límites de ritmo: ${rate.kind === 'redis' ? 'Redis (compartidos entre instancias)' : 'memoria (por proceso)'}`);
  console.log(`Turnstile: ${turnstileEnabled(turnstile) ? 'activado en rutas pesadas' : 'desactivado (defina TURNSTILE_SITE_KEY y TURNSTILE_SECRET_KEY)'}`);

  if (isProd) {
    const dist = path.resolve(__dirname, 'dist');
    // Archivos de configuración de Cloudflare Pages: no son contenido público de este servidor
    app.get(['/_headers', '/_redirects'], (_req, res) => res.status(404).end());
    app.use(
      express.static(dist, {
        index: false,
        setHeaders: (res, filePath) => {
          // Los assets de Vite llevan hash en el nombre: cacheables un año. El resto (sw.js, manifest...) se revalida.
          res.setHeader(
            'Cache-Control',
            filePath.includes(`${path.sep}assets${path.sep}`) ? 'public, max-age=31536000, immutable' : 'no-cache'
          );
        },
      })
    );
    app.get('*', (_req, res) => {
      res.setHeader('Cache-Control', 'no-cache');
      res.sendFile(path.join(dist, 'index.html'));
    });
  } else {
    // Import dinámico: en producción Vite ni se carga (arranque más rápido y puede ser devDependency)
    const { createServer: createViteServer } = await import('vite');
    const vite = await createViteServer({
      server: { middlewareMode: true, hmr: process.env.DISABLE_HMR !== 'true' },
      appType: 'spa',
    });
    app.use(vite.middlewares);
  }

  // Último recurso: nunca devolver trazas ni mensajes internos al cliente
  app.use((err: any, _req: Request, res: Response, _next: express.NextFunction) => {
    console.error('[error no controlado]', err);
    if (!res.headersSent) res.status(500).json({ error: 'Error interno del servidor' });
  });

  const host = process.env.HOST || '0.0.0.0';
  const server = app.listen(port, host, () => {
    console.log(`Network Tools Hub escuchando en http://${host}:${port} (${isProd ? 'producción' : 'desarrollo'})`);
  });

  // Mitigación de clientes lentos (slowloris)
  server.headersTimeout = 20_000;
  server.requestTimeout = 60_000;
  server.keepAliveTimeout = 65_000;

  // Cierre ordenado (Cloud Run, Docker, systemd envían SIGTERM)
  const shutdown = () => {
    console.log('Cerrando servidor…');
    server.close(() => void rate.close().finally(() => process.exit(0)));
    setTimeout(() => process.exit(1), 10_000).unref();
  };
  process.on('SIGTERM', shutdown);
  process.on('SIGINT', shutdown);
}

process.on('unhandledRejection', (reason) => {
  console.error('[unhandledRejection]', reason);
});

startServer().catch((err) => {
  console.error('Error fatal al iniciar servidor:', err);
  process.exit(1);
});
