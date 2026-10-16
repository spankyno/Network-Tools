// Cloudflare Turnstile + "pase" firmado, compartido por Node y Cloudflare Functions (solo WebCrypto y fetch).
//
// Flujo: el navegador resuelve el reto UNA vez → POST /api/turnstile/verify → el servidor valida el token con
// siteverify y emite una cookie HttpOnly con un pase firmado (HMAC-SHA256, caduca a los 10 min y va ligado a la IP).
// Las rutas pesadas solo comprueban la firma: sin estado, por lo que funciona con varias instancias sin Redis.
// Sin TURNSTILE_SECRET_KEY la protección queda desactivada y la app funciona igual.

export const PASS_COOKIE = 'nc_pass';
export const PASS_TTL_SEC = 600;
export const SITEVERIFY_URL = 'https://challenges.cloudflare.com/turnstile/v0/siteverify';

/** Rutas que exigen haber superado el reto (las más caras y las más abusables). */
export const HUMAN_GATED_PATHS = new Set(['/api/ssl', '/api/headers', '/api/http-versions', '/api/port-check', '/api/traceroute']);

export interface TurnstileConfig {
  /** Clave secreta de Turnstile. Vacía = desactivado. */
  secret?: string;
  /** Clave pública que se entrega al navegador vía /api/config. */
  siteKey?: string;
  /** Clave de firma del pase; por defecto se usa el secreto. Defínala para poder rotarla aparte. */
  signingKey?: string;
}

export const turnstileEnabled = (c: TurnstileConfig) => Boolean(c.secret && c.siteKey);

const enc = new TextEncoder();

function toBase64Url(bytes: ArrayBuffer): string {
  let s = '';
  for (const b of new Uint8Array(bytes)) s += String.fromCharCode(b);
  return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

async function hmac(key: string, data: string): Promise<string> {
  const k = await crypto.subtle.importKey('raw', enc.encode(key), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  return toBase64Url(await crypto.subtle.sign('HMAC', k, enc.encode(data)));
}

/** Comparación en tiempo constante (evita ataques por temporización sobre la firma). */
function safeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

const keyOf = (c: TurnstileConfig) => c.signingKey || c.secret || '';

export async function signPass(cfg: TurnstileConfig, ip: string, nowMs = Date.now(), ttlSec = PASS_TTL_SEC): Promise<string> {
  const exp = Math.floor(nowMs / 1000) + ttlSec;
  // Separación de dominio ("netcheck-pass-v1"): la firma no puede reutilizarse para otro propósito con la misma clave
  return `${exp}.${await hmac(keyOf(cfg), `netcheck-pass-v1|${exp}|${ip}`)}`;
}

export async function verifyPass(cfg: TurnstileConfig, value: string | undefined | null, ip: string, nowMs = Date.now()): Promise<boolean> {
  if (!value || value.length > 200 || !keyOf(cfg)) return false;
  const dot = value.indexOf('.');
  if (dot < 1) return false;
  const exp = Number(value.slice(0, dot));
  if (!Number.isInteger(exp) || exp * 1000 < nowMs) return false;
  const expected = await hmac(keyOf(cfg), `netcheck-pass-v1|${exp}|${ip}`);
  return safeEqual(expected, value.slice(dot + 1));
}

export interface SiteverifyResult {
  success: boolean;
  errorCodes: string[];
  /** true si no se pudo contactar con Cloudflare (no es un rechazo del usuario: responder 503, no 403). */
  unreachable?: boolean;
}

export async function verifyTurnstileToken(secret: string, token: unknown, ip: string, fetchImpl: typeof fetch = fetch): Promise<SiteverifyResult> {
  if (typeof token !== 'string' || token.length < 10 || token.length > 2048) {
    return { success: false, errorCodes: ['invalid-input-response'] };
  }
  const form = new URLSearchParams({ secret, response: token });
  if (ip && ip !== 'unknown') form.set('remoteip', ip);
  try {
    const r = await fetchImpl(SITEVERIFY_URL, { method: 'POST', body: form, signal: AbortSignal.timeout(5000) });
    if (!r.ok) return { success: false, errorCodes: [`http-${r.status}`], unreachable: true };
    const data = (await r.json()) as { success?: boolean; 'error-codes'?: string[] };
    return { success: data.success === true, errorCodes: data['error-codes'] ?? [] };
  } catch {
    return { success: false, errorCodes: ['unreachable'], unreachable: true };
  }
}

export function parseCookie(header: string | null | undefined, name: string): string | undefined {
  if (!header) return undefined;
  for (const part of header.split(';')) {
    const eq = part.indexOf('=');
    if (eq > 0 && part.slice(0, eq).trim() === name) return part.slice(eq + 1).trim();
  }
  return undefined;
}

export function passCookie(value: string, secure: boolean): string {
  // Path=/api: la cookie solo viaja a la API. SameSite=Strict: no se envía desde otros sitios.
  return `${PASS_COOKIE}=${value}; Path=/api; Max-Age=${PASS_TTL_SEC}; HttpOnly; SameSite=Strict${secure ? '; Secure' : ''}`;
}

export const CAPTCHA_REQUIRED_BODY = { error: 'Verificación anti-bots requerida.', code: 'CAPTCHA_REQUIRED' } as const;
