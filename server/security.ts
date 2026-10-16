import dns from 'node:dns';
import http from 'node:http';
import https from 'node:https';
import type net from 'node:net';
import type { NextFunction, Request, RequestHandler, Response } from 'express';
import { FixedWindowLimiter, isBlockedHostname, isIP, isPublicIp, parseHost } from '../shared/net-utils.ts';

// ---------------------------------------------------------------------------
// Errores tipados
// ---------------------------------------------------------------------------
export class BlockedTargetError extends Error {
  code = 'EBLOCKED';
  constructor(message = 'El destino no es una dirección pública') {
    super(message);
    this.name = 'BlockedTargetError';
  }
}

export class InvalidInputError extends Error {
  code = 'EINVALID';
  constructor(message: string) {
    super(message);
    this.name = 'InvalidInputError';
  }
}

// ---------------------------------------------------------------------------
// Resolución DNS segura (anti-SSRF y anti DNS-rebinding)
// ---------------------------------------------------------------------------
/**
 * `lookup` para net/tls/http(s). La IP que valida es EXACTAMENTE la IP a la que se conecta el socket,
 * así que no hay ventana entre "comprobar" y "usar" (TOCTOU) que permita DNS rebinding.
 * Si CUALQUIER respuesta A/AAAA es no pública se rechaza el destino completo.
 */
export const safeLookup: net.LookupFunction = (hostname, options, callback) => {
  const opts = (typeof options === 'object' && options ? options : { family: options }) as dns.LookupOptions;
  if (isBlockedHostname(hostname)) {
    return callback(new BlockedTargetError() as NodeJS.ErrnoException, '', 4);
  }
  dns.lookup(hostname, { ...opts, all: true, verbatim: true }, (err, addresses) => {
    if (err) return callback(err, '', 4);
    if (!addresses.length || addresses.some((a) => !isPublicIp(a.address))) {
      return callback(new BlockedTargetError() as NodeJS.ErrnoException, '', 4);
    }
    if (opts.all) return (callback as any)(null, addresses);
    callback(null, addresses[0].address, addresses[0].family);
  });
};

/** Pre-comprobación con mensaje amable. La barrera real sigue siendo safeLookup en el momento de conectar. */
export async function assertPublicHost(host: string): Promise<void> {
  if (isIP(host)) {
    // IP literal: se juzga directamente, sin depender de cómo el resolver trate las IPs
    if (!isPublicIp(host)) throw new BlockedTargetError();
    return;
  }
  if (isBlockedHostname(host)) throw new BlockedTargetError();
  const addresses = await dns.promises.lookup(host, { all: true, verbatim: true });
  if (!addresses.length || addresses.some((a) => !isPublicIp(a.address))) throw new BlockedTargetError();
}

/** Resuelve UNA vez y devuelve una IP pública ya validada (útil para conectar luego por IP, sin re-resolver). */
export async function resolvePublicAddress(host: string): Promise<{ address: string; family: number }> {
  const literal = isIP(host);
  if (literal) {
    if (!isPublicIp(host)) throw new BlockedTargetError();
    return { address: host, family: literal };
  }
  if (isBlockedHostname(host)) throw new BlockedTargetError();
  const addresses = await dns.promises.lookup(host, { all: true, verbatim: true });
  if (!addresses.length || addresses.some((a) => !isPublicIp(a.address))) throw new BlockedTargetError();
  return addresses[0];
}

/** Valida un parámetro "host" de usuario y que resuelva a IPs públicas. Lanza InvalidInputError / BlockedTargetError. */
export async function requirePublicHost(raw: unknown): Promise<string> {
  const parsed = parseHost(raw);
  if (!parsed) throw new InvalidInputError('El host o dominio indicado no es válido');
  await assertPublicHost(parsed.host);
  return parsed.host;
}

// ---------------------------------------------------------------------------
// Cliente HTTP seguro: solo lee cabeceras, revalida cada redirección, nunca descarga el cuerpo
// ---------------------------------------------------------------------------
export interface SafeHeadResult {
  status: number;
  statusText: string;
  headers: Record<string, string>;
  finalUrl: string;
  redirects: string[];
}

const ALLOWED_WEB_PORTS = new Set([80, 443, 8080, 8443]);
const REDIRECT_CODES = new Set([301, 302, 303, 307, 308]);

function requestOnce(url: URL, signal: AbortSignal, headers: Record<string, string>): Promise<http.IncomingMessage> {
  return new Promise((resolve, reject) => {
    const lib = url.protocol === 'https:' ? https : http;
    const req = lib.request(
      {
        protocol: url.protocol,
        hostname: url.hostname.replace(/^\[|\]$/g, ''),
        port: url.port || (url.protocol === 'https:' ? 443 : 80),
        path: `${url.pathname}${url.search}`,
        method: 'GET',
        headers,
        lookup: safeLookup,
        agent: false, // sin pool: cada salto valida y conecta por separado
        signal,
      },
      (res) => {
        res.destroy(); // solo necesitamos cabeceras; evita descargar el cuerpo
        resolve(res);
      }
    );
    req.on('error', reject);
    req.end();
  });
}

export async function safeHeadRequest(
  rawUrl: string,
  opts: { timeoutMs?: number; maxRedirects?: number; headers?: Record<string, string> } = {}
): Promise<SafeHeadResult> {
  const { timeoutMs = 8000, maxRedirects = 5, headers = {} } = opts;
  const signal = AbortSignal.timeout(timeoutMs); // plazo total para toda la cadena de redirecciones

  let current: URL;
  try {
    current = new URL(/^[a-z][a-z0-9+.-]*:\/\//i.test(rawUrl) ? rawUrl : `https://${rawUrl}`);
  } catch {
    throw new InvalidInputError('La URL indicada no es válida');
  }

  const redirects: string[] = [];
  for (let hop = 0; hop <= maxRedirects; hop++) {
    if (current.protocol !== 'http:' && current.protocol !== 'https:') {
      throw new InvalidInputError('Solo se admiten URLs http o https');
    }
    if (current.username || current.password) {
      throw new InvalidInputError('No se admiten credenciales dentro de la URL');
    }
    const port = Number(current.port || (current.protocol === 'https:' ? 443 : 80));
    if (!ALLOWED_WEB_PORTS.has(port)) {
      throw new InvalidInputError('Puerto no permitido: use 80, 443, 8080 u 8443');
    }
    const parsed = parseHost(current.hostname);
    if (!parsed) throw new InvalidInputError('El host de la URL no es válido');
    await assertPublicHost(parsed.host);

    const res = await requestOnce(current, signal, {
      'User-Agent': 'NetCheck/1.0 (Network Tools Hub; Diagnostic Crawler)',
      Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
      ...headers,
    });

    const status = res.statusCode ?? 0;
    const location = res.headers.location;
    if (REDIRECT_CODES.has(status) && location) {
      redirects.push(current.toString());
      try {
        current = new URL(location, current);
      } catch {
        throw new InvalidInputError('Redirección con destino no válido');
      }
      continue;
    }

    const out: Record<string, string> = {};
    for (const [k, v] of Object.entries(res.headers)) {
      if (v !== undefined) out[k.toLowerCase()] = Array.isArray(v) ? v.join(', ') : String(v);
    }
    return { status, statusText: res.statusMessage ?? '', headers: out, finalUrl: current.toString(), redirects };
  }
  throw new InvalidInputError(`Demasiadas redirecciones (máximo ${maxRedirects})`);
}

// ---------------------------------------------------------------------------
// Mensajes de error al cliente (sin filtrar detalles internos)
// ---------------------------------------------------------------------------
export function publicErrorMessage(err: unknown, fallback: string): { status: number; message: string } {
  if (err instanceof InvalidInputError) return { status: 400, message: err.message };
  if (err instanceof BlockedTargetError) {
    return { status: 400, message: 'Solo se pueden analizar destinos públicos de Internet (no direcciones locales, privadas ni reservadas).' };
  }
  const code = (err as NodeJS.ErrnoException)?.code;
  const name = (err as Error)?.name;
  if (code === 'ENOTFOUND' || code === 'ENODATA' || code === 'EAI_AGAIN') {
    return { status: 404, message: 'No se pudo resolver el nombre de host indicado.' };
  }
  if (name === 'TimeoutError' || name === 'AbortError' || code === 'ETIMEDOUT') {
    return { status: 504, message: 'Tiempo de espera agotado al contactar con el destino.' };
  }
  if (code === 'ECONNREFUSED' || code === 'ECONNRESET' || code === 'EHOSTUNREACH' || code === 'ENETUNREACH') {
    return { status: 502, message: 'No se pudo establecer conexión con el destino.' };
  }
  return { status: 502, message: fallback };
}

export function sendError(res: Response, err: unknown, fallback: string, extra: Record<string, unknown> = {}): void {
  if (res.headersSent) return;
  const { status, message } = publicErrorMessage(err, fallback);
  res.status(status).json({ error: message, ...extra });
}

/** Captura rechazos de promesas en handlers async (Express 4 no lo hace y Node ≥15 mataría el proceso). */
export const asyncHandler =
  (fn: (req: Request, res: Response, next: NextFunction) => Promise<unknown>): RequestHandler =>
  (req, res, next) => {
    fn(req, res, next).catch((err) => {
      console.error(`[${req.method} ${req.path}]`, err);
      sendError(res, err, 'Error interno del servidor');
    });
  };

// ---------------------------------------------------------------------------
// Rate limiting y límite de concurrencia
// ---------------------------------------------------------------------------
export function rateLimit(opts: { windowMs: number; max: number; message?: string }): RequestHandler {
  const limiter = new FixedWindowLimiter(opts.windowMs, opts.max);
  return (req, res, next) => {
    const r = limiter.take(req.ip || req.socket.remoteAddress || 'unknown');
    res.setHeader('RateLimit-Limit', String(opts.max));
    res.setHeader('RateLimit-Remaining', String(r.remaining));
    if (!r.allowed) {
      res.setHeader('Retry-After', String(r.retryAfterSec));
      res.status(429).json({ error: opts.message ?? `Demasiadas solicitudes. Reintente en ${r.retryAfterSec} s.` });
      return;
    }
    next();
  };
}

/** Limita las conexiones simultáneas por IP y en total (speed test: ancho de banda amplificable). */
export function concurrencyLimit(opts: { perIp: number; total: number }): RequestHandler {
  const perIp = new Map<string, number>();
  let total = 0;
  return (req, res, next) => {
    const key = req.ip || req.socket.remoteAddress || 'unknown';
    const current = perIp.get(key) ?? 0;
    if (current >= opts.perIp || total >= opts.total) {
      res.setHeader('Retry-After', '5');
      res.status(429).json({ error: 'Demasiadas transferencias simultáneas. Espere unos segundos.' });
      return;
    }
    perIp.set(key, current + 1);
    total++;
    let released = false;
    const release = () => {
      if (released) return;
      released = true;
      total--;
      const n = (perIp.get(key) ?? 1) - 1;
      if (n <= 0) perIp.delete(key);
      else perIp.set(key, n);
    };
    res.on('close', release);
    next();
  };
}

/** Tope de bytes servidos por IP y ventana (protege la factura de ancho de banda del speed test). */
export function bandwidthBudget(opts: { windowMs: number; maxBytes: number; bytesOf: (req: Request) => number }): RequestHandler {
  const used = new Map<string, { bytes: number; reset: number }>();
  return (req, res, next) => {
    const now = Date.now();
    if (used.size > 10_000) {
      for (const [k, v] of used) if (v.reset <= now) used.delete(k);
      if (used.size > 10_000) used.clear();
    }
    const key = req.ip || req.socket.remoteAddress || 'unknown';
    let entry = used.get(key);
    if (!entry || entry.reset <= now) {
      entry = { bytes: 0, reset: now + opts.windowMs };
      used.set(key, entry);
    }
    const wanted = opts.bytesOf(req);
    if (entry.bytes + wanted > opts.maxBytes) {
      res.setHeader('Retry-After', String(Math.ceil((entry.reset - now) / 1000)));
      res.status(429).json({ error: 'Cuota de transferencia del test de velocidad agotada temporalmente. Inténtelo más tarde.' });
      return;
    }
    entry.bytes += wanted;
    next();
  };
}

// ---------------------------------------------------------------------------
// Cabeceras de seguridad y CORS
// ---------------------------------------------------------------------------
export function securityHeaders(opts: { production: boolean; headers: Record<string, string> }): RequestHandler {
  return (_req, res, next) => {
    for (const [k, v] of Object.entries(opts.headers)) {
      // En desarrollo, Vite necesita inline/eval/websocket: no se aplica la CSP ni HSTS.
      if (!opts.production && (k === 'Content-Security-Policy' || k === 'Strict-Transport-Security')) continue;
      res.setHeader(k, v);
    }
    res.removeHeader('X-Powered-By');
    next();
  };
}

/** Lista blanca de orígenes para CORS desde ALLOWED_ORIGINS (separados por comas). Vacía = solo mismo origen. */
export function parseAllowedOrigins(env: string | undefined): string[] {
  return (env ?? '')
    .split(',')
    .map((s) => s.trim().replace(/\/$/, ''))
    .filter(Boolean);
}
