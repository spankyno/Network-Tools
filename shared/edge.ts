// Utilidades para el runtime Edge (Cloudflare Pages Functions). Sin DNS ni sockets de Node:
// el destino se valida resolviendo por DoH y las redirecciones se siguen a mano, revalidando cada salto.
import { TtlCache, isBlockedHostname, isIP, isPublicIp, parseHost, readJsonLimited } from './net-utils.ts';

/** Error con código HTTP pensado para llegar tal cual al cliente. */
export class HttpError extends Error {
  constructor(public status: number, message: string) {
    super(message);
    this.name = 'HttpError';
  }
}

const dohCache = new TtlCache<string[]>(60_000, 500);

async function dohAddresses(host: string, type: 'A' | 'AAAA'): Promise<string[]> {
  const r = await fetch(`https://cloudflare-dns.com/dns-query?name=${encodeURIComponent(host)}&type=${type}`, {
    headers: { Accept: 'application/dns-json' },
    signal: AbortSignal.timeout(3000),
  });
  if (!r.ok) throw new Error(`DoH ${r.status}`);
  const d = await readJsonLimited<any>(r, 256 * 1024);
  const wanted = type === 'A' ? 1 : 28;
  return (d.Answer || []).filter((a: any) => a.type === wanted && typeof a.data === 'string').map((a: any) => a.data as string);
}

export function resolveEdge(host: string): Promise<string[]> {
  return dohCache.wrap(host, async () => {
    const [a, aaaa] = await Promise.all([dohAddresses(host, 'A'), dohAddresses(host, 'AAAA').catch(() => [] as string[])]);
    return [...a, ...aaaa];
  });
}

export const NOT_PUBLIC_MESSAGE =
  'Solo se pueden analizar destinos públicos de Internet (no direcciones locales, privadas ni reservadas).';

/** Lanza HttpError si el host es local/privado o no resuelve. Nota: sin DNS pinning (el runtime no lo permite). */
export async function assertPublicEdge(host: string): Promise<void> {
  if (isIP(host)) {
    if (!isPublicIp(host)) throw new HttpError(400, NOT_PUBLIC_MESSAGE);
    return;
  }
  if (isBlockedHostname(host)) throw new HttpError(400, NOT_PUBLIC_MESSAGE);
  let addrs: string[];
  try {
    addrs = await resolveEdge(host);
  } catch {
    throw new HttpError(502, 'No se pudo resolver el host (resolutor DNS no disponible).');
  }
  if (!addrs.length) throw new HttpError(404, 'No se pudo resolver el nombre de host indicado.');
  if (addrs.some((a) => !isPublicIp(a))) throw new HttpError(400, NOT_PUBLIC_MESSAGE);
}

export function requireHostParam(raw: unknown): string {
  const parsed = parseHost(raw);
  if (!parsed) throw new HttpError(400, 'El host o dominio indicado no es válido');
  return parsed.host;
}

export const urlHost = (host: string) => (host.includes(':') ? `[${host}]` : host);

const ALLOWED_WEB_PORTS = new Set([80, 443, 8080, 8443]);
const REDIRECTS = new Set([301, 302, 303, 307, 308]);

/** fetch que valida cada salto (esquema, credenciales, puerto, destino público) y limita el tiempo total. */
export async function safeFetchEdge(
  rawUrl: string,
  opts: { timeoutMs?: number; maxRedirects?: number; headers?: Record<string, string> } = {}
): Promise<{ resp: Response; finalUrl: string; redirects: string[] }> {
  const { timeoutMs = 8000, maxRedirects = 5, headers = {} } = opts;
  const signal = AbortSignal.timeout(timeoutMs);
  let current: URL;
  try {
    current = new URL(/^[a-z][a-z0-9+.-]*:\/\//i.test(rawUrl) ? rawUrl : `https://${rawUrl}`);
  } catch {
    throw new HttpError(400, 'La URL indicada no es válida');
  }
  const redirects: string[] = [];
  for (let hop = 0; hop <= maxRedirects; hop++) {
    if (current.protocol !== 'http:' && current.protocol !== 'https:') throw new HttpError(400, 'Solo se admiten URLs http o https');
    if (current.username || current.password) throw new HttpError(400, 'No se admiten credenciales dentro de la URL');
    const port = Number(current.port || (current.protocol === 'https:' ? 443 : 80));
    if (!ALLOWED_WEB_PORTS.has(port)) throw new HttpError(400, 'Puerto no permitido: use 80, 443, 8080 u 8443');
    const parsed = parseHost(current.hostname);
    if (!parsed) throw new HttpError(400, 'El host de la URL no es válido');
    await assertPublicEdge(parsed.host);

    const resp = await fetch(current.toString(), {
      method: 'GET',
      redirect: 'manual',
      signal,
      headers: {
        'User-Agent': 'NetCheck/1.0 (Network Tools Hub; Diagnostic Crawler)',
        Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
        ...headers,
      },
    });
    const location = resp.headers.get('location');
    if (REDIRECTS.has(resp.status) && location) {
      await resp.body?.cancel().catch(() => undefined);
      redirects.push(current.toString());
      try {
        current = new URL(location, current);
      } catch {
        throw new HttpError(400, 'Redirección con destino no válido');
      }
      continue;
    }
    await resp.body?.cancel().catch(() => undefined); // solo importan las cabeceras
    return { resp, finalUrl: current.toString(), redirects };
  }
  throw new HttpError(400, `Demasiadas redirecciones (máximo ${maxRedirects})`);
}

export type TcpProbe =
  | { status: 'OPEN' | 'CLOSED' | 'FILTERED'; durationMs: number; unavailable?: false }
  | { unavailable: true; durationMs: number };

/**
 * Sondeo TCP real con la API de sockets de Workers. `unavailable` = la plataforma no permite
 * conectar (módulo ausente, IP de Cloudflare, puerto bloqueado): el llamador decide qué hacer.
 */
export async function tcpProbe(host: string, port: number, timeoutMs: number): Promise<TcpProbe> {
  const t0 = Date.now();
  let mod: typeof import('cloudflare:sockets');
  try {
    mod = await import('cloudflare:sockets');
  } catch {
    return { unavailable: true, durationMs: 0 };
  }
  let socket: ReturnType<typeof mod.connect>;
  try {
    socket = mod.connect({ hostname: host, port });
  } catch {
    return { unavailable: true, durationMs: Date.now() - t0 };
  }
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    await Promise.race([
      socket.opened,
      new Promise((_, reject) => {
        timer = setTimeout(() => reject(Object.assign(new Error('timeout'), { name: 'TimeoutError' })), timeoutMs);
      }),
    ]);
    return { status: 'OPEN', durationMs: Date.now() - t0 };
  } catch (err: any) {
    const msg = String(err?.message || '').toLowerCase();
    if (err?.name === 'TimeoutError') return { status: 'FILTERED', durationMs: Date.now() - t0 };
    if (/refused/.test(msg)) return { status: 'CLOSED', durationMs: Date.now() - t0 };
    if (/cloudflare|not allowed|blocked|proxy request|denied/.test(msg)) return { unavailable: true, durationMs: Date.now() - t0 };
    return { status: 'FILTERED', durationMs: Date.now() - t0 }; // ante la duda, nunca afirmar "cerrado"
  } finally {
    if (timer) clearTimeout(timer);
    socket.close().catch(() => undefined);
  }
}
