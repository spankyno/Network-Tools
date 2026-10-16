// Consulta a crt.sh (Certificate Transparency). Compartido por server.ts y Cloudflare Functions.
// Caché de 5 min + deduplicación (crt.sh es lento y limita peticiones) y tope de tamaño de respuesta
// (dominios grandes devuelven decenas de MB).
import { TtlCache, readJsonLimited } from './net-utils.ts';

export const CT_MAX_BYTES = 12 * 1024 * 1024;
const ctCache = new TtlCache<CtPayload>(5 * 60_000, 200);

export interface CtPayload {
  domain: string;
  totalFound: number;
  uniqueCertificates: number;
  discoveredSubdomains: number;
  subdomains: string[];
  certificates: any[];
  /** Entradas crudas más recientes: las usa /api/ssl en el despliegue Edge. */
  rawEntries: any[];
}

export function fetchCtPayload(domain: string): Promise<CtPayload> {
  return ctCache.wrap(domain, async () => {
    const resp = await fetch(`https://crt.sh/?q=${encodeURIComponent(domain)}&output=json`, {
      headers: { 'User-Agent': 'NetCheck/1.0 (Network Tools Hub; CT Logs Query)', Accept: 'application/json' },
      signal: AbortSignal.timeout(9000),
    });
    if (!resp.ok) throw new Error(`crt.sh respondió con código de estado HTTP ${resp.status}`);

    const data = (await readJsonLimited<any[]>(resp, CT_MAX_BYTES)) || [];
    const subdomainsSet = new Set<string>();
    const certsMap = new Map<string, any>();
    const belongsToDomain = (n: string) => n === domain || n.endsWith(`.${domain}`);

    for (const item of data) {
      const names = String(item.name_value || '')
        .split('\n')
        .map((n) => n.trim().toLowerCase())
        .filter(Boolean);
      // Antes: includes(domain) → "evil-example.com" contaba como subdominio de "example.com"
      for (const n of names) if (belongsToDomain(n)) subdomainsSet.add(n);

      const key = `${item.serial_number}-${item.issuer_name}`;
      if (!certsMap.has(key)) {
        certsMap.set(key, {
          id: item.id,
          loggedAt: item.entry_timestamp,
          notBefore: item.not_before,
          notAfter: item.not_after,
          commonName: item.common_name,
          issuerName: item.issuer_name,
          serialNumber: item.serial_number,
          subdomains: Array.from(new Set(names)),
        });
      }
    }

    const subdomains = Array.from(subdomainsSet).sort();
    return {
      domain,
      totalFound: data.length,
      uniqueCertificates: certsMap.size,
      discoveredSubdomains: subdomains.length,
      subdomains,
      certificates: Array.from(certsMap.values()).slice(0, 50),
      rawEntries: data.slice(0, 200),
    };
  });
}
