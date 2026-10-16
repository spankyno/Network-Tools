// Geolocalización IP con fallback en cascada. Usa solo fetch, así que funciona igual en Node y en Cloudflare Workers.
import { TtlCache, readJsonLimited } from './net-utils.ts';

export interface GeoResult {
  ip: string;
  version: string;
  country: string;
  countryCode: string;
  region: string;
  regionCode: string;
  city: string;
  zip: string;
  lat: number;
  lon: number;
  timezone: string;
  isp: string;
  org: string;
  as: string;
  isMobile: boolean;
  isProxy: boolean;
  isHosting: boolean;
}

const num = (v: unknown) => (typeof v === 'number' ? v : 0);

export const GEO_PROVIDERS: Array<{
  name: string;
  url: (target: string) => string;
  ok: (d: any) => boolean;
  map: (d: any) => GeoResult;
}> = [
  {
    name: 'ipwho.is',
    url: (t) => (t ? `https://ipwho.is/${encodeURIComponent(t)}` : 'https://ipwho.is/'),
    ok: (d) => d.success !== false,
    map: (d) => ({
      ip: d.ip,
      version: d.type === 'IPv6' ? 'IPv6' : 'IPv4',
      country: d.country || 'Desconocido',
      countryCode: d.country_code || '',
      region: d.region || '',
      regionCode: d.region_code || '',
      city: d.city || 'Desconocida',
      zip: d.postal || '',
      lat: num(d.latitude),
      lon: num(d.longitude),
      timezone: d.timezone?.id || 'UTC',
      isp: d.connection?.isp || d.connection?.org || 'Desconocido',
      org: d.connection?.org || '',
      as: d.connection?.asn ? `AS${d.connection.asn} ${d.connection.org || ''}` : '',
      isMobile: false,
      isProxy: Boolean(d.security?.is_proxy || d.security?.is_vpn),
      isHosting: Boolean(d.security?.is_datacenter),
    }),
  },
  {
    name: 'ipapi.co',
    url: (t) => (t ? `https://ipapi.co/${encodeURIComponent(t)}/json/` : 'https://ipapi.co/json/'),
    ok: (d) => !d.error,
    map: (d) => ({
      ip: d.ip,
      version: d.version || 'IPv4',
      country: d.country_name || 'Desconocido',
      countryCode: d.country_code || '',
      region: d.region || '',
      regionCode: d.region_code || '',
      city: d.city || 'Desconocida',
      zip: d.postal || '',
      lat: num(d.latitude),
      lon: num(d.longitude),
      timezone: d.timezone || 'UTC',
      isp: d.org || 'Desconocido',
      org: d.org || '',
      as: d.asn ? `${d.asn} ${d.org || ''}` : '',
      isMobile: false,
      isProxy: false,
      isHosting: false,
    }),
  },
  {
    name: 'ip-api.com',
    url: (t) =>
      `http://ip-api.com/json/${t ? encodeURIComponent(t) : ''}?fields=status,message,country,countryCode,region,regionName,city,zip,lat,lon,timezone,isp,org,as,query,mobile,proxy,hosting`,
    ok: (d) => d.status === 'success',
    map: (d) => ({
      ip: d.query,
      version: d.query?.includes(':') ? 'IPv6' : 'IPv4',
      country: d.country || 'Desconocido',
      countryCode: d.countryCode || '',
      region: d.regionName || d.region || '',
      regionCode: d.region || '',
      city: d.city || 'Desconocida',
      zip: d.zip || '',
      lat: num(d.lat),
      lon: num(d.lon),
      timezone: d.timezone || 'UTC',
      isp: d.isp || 'Desconocido',
      org: d.org || d.isp || '',
      as: d.as || '',
      isMobile: Boolean(d.mobile),
      isProxy: Boolean(d.proxy),
      isHosting: Boolean(d.hosting),
    }),
  },
];


export type GeoLookup = GeoResult & { providerUsed: string; fallbacksAttempted: string[] };

const geoCache = new TtlCache<GeoLookup>(10 * 60_000, 2000);

/** target vacío = IP de salida de quien hace la petición al proveedor. Lanza Error con .fallbacksAttempted si todos fallan. */
export function lookupGeo(target: string): Promise<GeoLookup> {
  return geoCache.wrap(target || 'egress', async () => {
    const fallbacksAttempted: string[] = [];
    for (const provider of GEO_PROVIDERS) {
      fallbacksAttempted.push(provider.name);
      try {
        const r = await fetch(provider.url(target), { signal: AbortSignal.timeout(4000) });
        if (!r.ok) continue;
        const data = await readJsonLimited<any>(r, 256 * 1024);
        if (provider.ok(data)) return { ...provider.map(data), providerUsed: provider.name, fallbacksAttempted };
      } catch {
        // probar el siguiente proveedor
      }
    }
    throw Object.assign(new Error('GEO_UNAVAILABLE'), { fallbacksAttempted });
  });
}
