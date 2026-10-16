// Utilidades puras (sin APIs de Node ni de Cloudflare) compartidas por
// server.ts (Express) y functions/api/[[route]].ts (Cloudflare Pages Functions).
// Todo lo que decide "¿es seguro conectar con este destino?" vive aquí, en un único sitio.

// ---------------------------------------------------------------------------
// Tipos de registro DNS permitidos
// ---------------------------------------------------------------------------
export const RECORD_TYPES = [
  'A', 'AAAA', 'CNAME', 'MX', 'TXT', 'NS', 'SOA', 'CAA', 'SRV', 'PTR', 'DS', 'DNSKEY', 'RRSIG', 'HTTPS',
] as const;

/** Devuelve el tipo normalizado o null si no está en la lista blanca. */
export function normalizeRecordType(input: unknown): string | null {
  const t = (typeof input === 'string' && input.trim() ? input.trim() : 'A').toUpperCase();
  return (RECORD_TYPES as readonly string[]).includes(t) ? t : null;
}

// ---------------------------------------------------------------------------
// Direcciones IP
// ---------------------------------------------------------------------------
/** IPv4 estricta: 4 octetos decimales, sin ceros a la izquierda (evita ambigüedad octal). */
export function parseIPv4(s: string): number[] | null {
  const m = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/.exec(s);
  if (!m) return null;
  for (let i = 1; i <= 4; i++) {
    if (m[i].length > 1 && m[i].startsWith('0')) return null;
  }
  const bytes = m.slice(1).map(Number);
  return bytes.every((n) => n <= 255) ? bytes : null;
}

/** IPv6 a 16 bytes. Soporta "::" y sufijo IPv4 embebido; rechaza zone ids (%eth0). */
export function parseIPv6(input: string): number[] | null {
  let s = input.toLowerCase();
  if (!s.includes(':') || s.includes('%')) return null;

  let tail: number[] | null = null;
  if (s.includes('.')) {
    const cut = s.lastIndexOf(':');
    tail = parseIPv4(s.slice(cut + 1));
    if (!tail) return null;
    s = `${s.slice(0, cut + 1)}0:0`;
  }

  const halves = s.split('::');
  if (halves.length > 2) return null;
  const toGroups = (part: string) => (part === '' ? [] : part.split(':'));
  const head = toGroups(halves[0]);
  const rest = halves.length === 2 ? toGroups(halves[1]) : [];
  const total = head.length + rest.length;

  let groups: string[];
  if (halves.length === 2) {
    if (total > 7) return null;
    groups = [...head, ...Array<string>(8 - total).fill('0'), ...rest];
  } else {
    if (total !== 8) return null;
    groups = head;
  }

  const bytes: number[] = [];
  for (const g of groups) {
    if (!/^[0-9a-f]{1,4}$/.test(g)) return null;
    const n = parseInt(g, 16);
    bytes.push(n >> 8, n & 0xff);
  }
  if (tail) bytes.splice(12, 4, ...tail);
  return bytes;
}

export function isIPv4(s: string): boolean {
  return parseIPv4(s) !== null;
}
export function isIPv6(s: string): boolean {
  return parseIPv6(s) !== null;
}
export function isIP(s: string): 0 | 4 | 6 {
  return isIPv4(s) ? 4 : isIPv6(s) ? 6 : 0;
}

function inCidr(bytes: number[], base: number[], prefix: number): boolean {
  let bits = prefix;
  for (let i = 0; bits > 0; i++, bits -= 8) {
    const mask = bits >= 8 ? 0xff : (0xff << (8 - bits)) & 0xff;
    if ((bytes[i] & mask) !== (base[i] & mask)) return false;
  }
  return true;
}

// Rangos que NUNCA deben ser destino de una conexión iniciada por el servidor (SSRF).
const V4_BLOCKED: Array<[string, number]> = [
  ['0.0.0.0', 8], // "esta red"
  ['10.0.0.0', 8], // privada
  ['100.64.0.0', 10], // CGNAT
  ['127.0.0.0', 8], // loopback
  ['169.254.0.0', 16], // link-local + metadatos cloud (169.254.169.254)
  ['172.16.0.0', 12], // privada
  ['192.0.0.0', 24], // IETF
  ['192.0.2.0', 24], // documentación
  ['192.88.99.0', 24], // 6to4 relay (obsoleto)
  ['192.168.0.0', 16], // privada
  ['198.18.0.0', 15], // benchmarking
  ['198.51.100.0', 24], // documentación
  ['203.0.113.0', 24], // documentación
  ['224.0.0.0', 4], // multicast
  ['240.0.0.0', 4], // reservado + broadcast
];

const V6_BLOCKED: Array<[string, number]> = [
  ['::', 96], // sin especificar, loopback e IPv4-compatible (obsoleto)
  ['64:ff9b:1::', 48], // NAT64 de uso local
  ['100::', 64], // discard-only
  ['2001::', 23], // IETF (incluye Teredo)
  ['2001:db8::', 32], // documentación
  ['3fff::', 20], // documentación
  ['fc00::', 7], // ULA
  ['fe80::', 10], // link-local
  ['fec0::', 10], // site-local (obsoleto)
  ['ff00::', 8], // multicast
];

const V4_BLOCKED_PARSED = V4_BLOCKED.map(([b, p]) => [parseIPv4(b)!, p] as const);
const V6_BLOCKED_PARSED = V6_BLOCKED.map(([b, p]) => [parseIPv6(b)!, p] as const);
const V6_MAPPED = parseIPv6('::ffff:0:0')!;
const V6_NAT64 = parseIPv6('64:ff9b::')!;
const V6_6TO4 = parseIPv6('2002::')!;

/** true solo si es una IP válida y de ámbito público. IPs inválidas devuelven false. */
export function isPublicIp(ip: string): boolean {
  const v4 = parseIPv4(ip);
  if (v4) return !V4_BLOCKED_PARSED.some(([base, p]) => inCidr(v4, base, p));

  const v6 = parseIPv6(ip);
  if (!v6) return false;

  // Formas que embeben una IPv4: se juzga la IPv4 embebida (evita ::ffff:127.0.0.1)
  if (inCidr(v6, V6_MAPPED, 96) || inCidr(v6, V6_NAT64, 96)) {
    return isPublicIp(v6.slice(12).join('.'));
  }
  if (inCidr(v6, V6_6TO4, 16)) {
    return isPublicIp(v6.slice(2, 6).join('.'));
  }
  return !V6_BLOCKED_PARSED.some(([base, p]) => inCidr(v6, base, p));
}

// ---------------------------------------------------------------------------
// Hosts
// ---------------------------------------------------------------------------
export type HostKind = 'ipv4' | 'ipv6' | 'domain';
export interface ParsedHost {
  host: string;
  kind: HostKind;
}

const LABEL_RE = /^[a-z0-9_]([a-z0-9_-]{0,61}[a-z0-9_])?$/;
const LOCAL_SUFFIXES = ['.localhost', '.local', '.internal', '.lan', '.home.arpa', '.localdomain', '.intranet', '.corp'];

/** Nombres que son locales por convención, sin necesidad de resolver DNS. */
export function isBlockedHostname(host: string): boolean {
  const h = host.toLowerCase();
  return h === 'localhost' || LOCAL_SUFFIXES.some((s) => h.endsWith(s));
}

/**
 * Normaliza y valida la entrada de un usuario (dominio, IP, URL, host:puerto, [v6]:puerto).
 * Devuelve null si no es un host sintácticamente válido. Canonicaliza formas ambiguas
 * (127.1, 2130706433, 0x7f.1, IDN → punycode) con el parser WHATWG, de modo que
 * isPublicIp() las vea siempre en forma dotted-decimal.
 */
export function parseHost(input: unknown): ParsedHost | null {
  if (typeof input !== 'string') return null;
  let s = input.trim().toLowerCase();
  if (!s || s.length > 2048) return null;

  s = s.replace(/^[a-z][a-z0-9+.-]*:\/\//, ''); // esquema
  s = s.replace(/[/?#].*$/, ''); // ruta, query, fragmento
  s = s.replace(/^.*@/, ''); // userinfo (el parser usa el último @)

  let hostPart: string;
  if (s.startsWith('[')) {
    const end = s.indexOf(']');
    if (end < 0) return null;
    hostPart = s.slice(1, end);
    const rest = s.slice(end + 1);
    if (rest && !/^:\d{1,5}$/.test(rest)) return null;
  } else if ((s.match(/:/g) || []).length === 1) {
    const [h, port] = s.split(':');
    if (port !== '' && !/^\d{1,5}$/.test(port)) return null;
    hostPart = h;
  } else {
    hostPart = s;
  }

  hostPart = hostPart.replace(/\.$/, '');
  if (!hostPart) return null;

  if (hostPart.includes(':')) {
    if (!parseIPv6(hostPart)) return null;
    try {
      const canonical = new URL(`http://[${hostPart}]`).hostname.replace(/^\[|\]$/g, '');
      return { host: canonical, kind: 'ipv6' };
    } catch {
      return null;
    }
  }

  let ascii: string;
  try {
    ascii = new URL(`http://${hostPart}`).hostname;
  } catch {
    return null;
  }
  if (!ascii || ascii.length > 253) return null;
  if (isIPv4(ascii)) return { host: ascii, kind: 'ipv4' };

  const labels = ascii.split('.');
  if (!labels.every((l) => LABEL_RE.test(l))) return null;
  if (/^\d+$/.test(labels[labels.length - 1])) return null; // TLD numérico: ambiguo
  return { host: ascii, kind: 'domain' };
}

/** Compatibilidad con el antiguo cleanHost: cadena vacía si la entrada no es válida. */
export function cleanHost(input: unknown): string {
  return parseHost(input)?.host ?? '';
}

/** Valida un puerto 1-65535. Devuelve null si no es válido. */
export function parsePort(input: unknown, fallback: number | null = null): number | null {
  if (input === undefined || input === null || input === '') return fallback;
  const n = typeof input === 'number' ? input : Number(String(input).trim());
  return Number.isInteger(n) && n >= 1 && n <= 65535 ? n : null;
}

// ---------------------------------------------------------------------------
// Caché con TTL + deduplicación de peticiones en vuelo
// ---------------------------------------------------------------------------
export class TtlCache<V> {
  private store = new Map<string, { value: V; expires: number }>();
  private inflight = new Map<string, Promise<V>>();

  constructor(private ttlMs: number, private maxEntries = 500) {}

  get(key: string): V | undefined {
    const hit = this.store.get(key);
    if (!hit) return undefined;
    if (hit.expires < Date.now()) {
      this.store.delete(key);
      return undefined;
    }
    return hit.value;
  }

  set(key: string, value: V): void {
    if (this.store.size >= this.maxEntries) {
      const oldest = this.store.keys().next().value;
      if (oldest !== undefined) this.store.delete(oldest);
    }
    this.store.set(key, { value, expires: Date.now() + this.ttlMs });
  }

  /** Devuelve el valor cacheado o ejecuta fn() una sola vez aunque haya llamadas concurrentes. Los errores no se cachean. */
  wrap(key: string, fn: () => Promise<V>): Promise<V> {
    const cached = this.get(key);
    if (cached !== undefined) return Promise.resolve(cached);
    let pending = this.inflight.get(key);
    if (!pending) {
      pending = fn()
        .then((v) => {
          this.set(key, v);
          return v;
        })
        .finally(() => this.inflight.delete(key));
      this.inflight.set(key, pending);
    }
    return pending;
  }
}

// ---------------------------------------------------------------------------
// Limitador de ritmo (ventana fija) en memoria
// ---------------------------------------------------------------------------
export class FixedWindowLimiter {
  private hits = new Map<string, { count: number; reset: number }>();

  constructor(private windowMs: number, private max: number, private maxKeys = 10_000) {}

  take(key: string, now = Date.now()): { allowed: boolean; remaining: number; retryAfterSec: number } {
    if (this.hits.size >= this.maxKeys) {
      for (const [k, v] of this.hits) if (v.reset <= now) this.hits.delete(k);
      if (this.hits.size >= this.maxKeys) this.hits.clear(); // último recurso: evitar crecimiento sin límite
    }
    let entry = this.hits.get(key);
    if (!entry || entry.reset <= now) {
      entry = { count: 0, reset: now + this.windowMs };
      this.hits.set(key, entry);
    }
    entry.count++;
    return {
      allowed: entry.count <= this.max,
      remaining: Math.max(0, this.max - entry.count),
      retryAfterSec: Math.max(1, Math.ceil((entry.reset - now) / 1000)),
    };
  }
}

// ---------------------------------------------------------------------------
// Lectura de JSON con tope de tamaño (evita agotar memoria con respuestas enormes)
// ---------------------------------------------------------------------------
export class ResponseTooLargeError extends Error {
  constructor() {
    super('RESPONSE_TOO_LARGE');
    this.name = 'ResponseTooLargeError';
  }
}

export async function readJsonLimited<T = any>(resp: Response, maxBytes: number): Promise<T> {
  const declared = Number(resp.headers.get('content-length'));
  if (Number.isFinite(declared) && declared > maxBytes) throw new ResponseTooLargeError();
  if (!resp.body) return JSON.parse(await resp.text()) as T;

  const reader = resp.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > maxBytes) {
      await reader.cancel().catch(() => undefined);
      throw new ResponseTooLargeError();
    }
    chunks.push(value);
  }
  const buf = new Uint8Array(total);
  let offset = 0;
  for (const c of chunks) {
    buf.set(c, offset);
    offset += c.byteLength;
  }
  return JSON.parse(new TextDecoder().decode(buf)) as T;
}

// ---------------------------------------------------------------------------
// Estado de caducidad de certificados (umbrales unificados Node / Edge)
// ---------------------------------------------------------------------------
export function expiryStatusFor(daysRemaining: number): 'VALID' | 'EXPIRING_SOON' | 'CRITICAL' | 'EXPIRED' {
  if (daysRemaining < 0) return 'EXPIRED';
  if (daysRemaining < 15) return 'CRITICAL';
  if (daysRemaining < 30) return 'EXPIRING_SOON';
  return 'VALID';
}

// ---------------------------------------------------------------------------
// Auditoría de cabeceras de seguridad HTTP (antes duplicada en ambos backends)
// ---------------------------------------------------------------------------
export interface SecurityAuditItem {
  name: string;
  header: string;
  present: boolean;
  value: string | null;
  score: number;
  maxScore: number;
  status: 'pass' | 'warning' | 'missing';
  recommendation: string;
}

export function analyzeSecurityHeaders(raw: Record<string, string>): {
  securityAudit: SecurityAuditItem[];
  securityScore: number;
  securityGrade: string;
} {
  const audit: SecurityAuditItem[] = [];
  const push = (
    name: string,
    header: string,
    value: string | undefined,
    maxScore: number,
    evaluate: (v: string) => { score: number; status: 'pass' | 'warning'; recommendation: string },
    missing: string
  ) => {
    if (value === undefined || value === '') {
      audit.push({ name, header, present: false, value: null, score: 0, maxScore, status: 'missing', recommendation: missing });
      return;
    }
    const r = evaluate(value);
    audit.push({ name, header, present: true, value, maxScore, ...r });
  };

  const csp = raw['content-security-policy'];

  // HSTS
  push('Strict-Transport-Security (HSTS)', 'strict-transport-security', raw['strict-transport-security'], 20,
    (v) => {
      const maxAge = Number(/max-age=(\d+)/i.exec(v)?.[1] ?? 0);
      if (maxAge < 15_552_000) {
        return { score: 8, status: 'warning', recommendation: 'HSTS presente pero con max-age inferior a 180 días; súbelo a 31536000 (1 año) como mínimo.' };
      }
      return {
        score: /includesubdomains/i.test(v) ? 20 : 15,
        status: 'pass',
        recommendation: 'HSTS está activo y previene ataques de degradación de protocolo.',
      };
    },
    'Habilite Strict-Transport-Security para forzar a los navegadores a conectarse solo mediante HTTPS.');

  // CSP
  push('Content-Security-Policy (CSP)', 'content-security-policy', csp, 25,
    (v) => {
      const scriptDirective = /(?:^|;)\s*(?:script-src|default-src)\s+([^;]*)/i.exec(v)?.[1] ?? '';
      if (/'unsafe-inline'|'unsafe-eval'|(?:^|\s)\*(?:\s|$)/i.test(scriptDirective)) {
        return { score: 15, status: 'warning', recommendation: "CSP presente pero permite 'unsafe-inline', 'unsafe-eval' o comodines en script-src; endurécela con nonces o hashes." };
      }
      return { score: 25, status: 'pass', recommendation: 'CSP configurado contra inyecciones XSS y scripts no autorizados.' };
    },
    'Defina Content-Security-Policy para mitigar inyecciones de código malicioso y cross-site scripting.');

  // X-Frame-Options (frame-ancestors de la CSP lo sustituye en navegadores modernos)
  const framed = /frame-ancestors/i.test(csp || '');
  push('X-Frame-Options', 'x-frame-options', raw['x-frame-options'] ?? (framed ? `(CSP frame-ancestors)` : undefined), 15,
    (v) => {
      if (/^(deny|sameorigin)$/i.test(v.trim()) || framed) {
        return { score: 15, status: 'pass', recommendation: `Protección anti-clickjacking activa (${v}).` };
      }
      return { score: 5, status: 'warning', recommendation: `Valor '${v}' no reconocido o obsoleto; use DENY, SAMEORIGIN o frame-ancestors en la CSP.` };
    },
    'Configure X-Frame-Options (DENY o SAMEORIGIN) o frame-ancestors en la CSP para prevenir clickjacking.');

  // X-Content-Type-Options
  push('X-Content-Type-Options', 'x-content-type-options', raw['x-content-type-options'], 15,
    (v) =>
      /nosniff/i.test(v)
        ? { score: 15, status: 'pass', recommendation: 'Prevención de detección de tipos MIME activa (nosniff).' }
        : { score: 0, status: 'warning', recommendation: `Valor '${v}' ineficaz; debe ser exactamente nosniff.` },
    'Establezca X-Content-Type-Options: nosniff para impedir que el navegador interprete archivos con tipos MIME incorrectos.');

  // Referrer-Policy
  push('Referrer-Policy', 'referrer-policy', raw['referrer-policy'], 15,
    (v) =>
      /unsafe-url|no-referrer-when-downgrade/i.test(v)
        ? { score: 5, status: 'warning', recommendation: `Política '${v}' filtra la URL completa a terceros; prefiera strict-origin-when-cross-origin o más estricta.` }
        : { score: 15, status: 'pass', recommendation: `Política de referencia definida (${v}).` },
    'Configure Referrer-Policy para limitar la información de navegación enviada a sitios de terceros.');

  // Permissions-Policy
  push('Permissions-Policy', 'permissions-policy', raw['permissions-policy'], 10,
    () => ({ score: 10, status: 'pass', recommendation: 'Permisos de APIs del navegador restringidos de forma explícita.' }),
    'Defina Permissions-Policy para restringir acceso a cámara, micrófono y geolocalización.');

  const earned = audit.reduce((a, c) => a + c.score, 0);
  const max = audit.reduce((a, c) => a + c.maxScore, 0);
  const pct = Math.round((earned / max) * 100);
  const grade = pct >= 90 ? 'A+' : pct >= 80 ? 'A' : pct >= 65 ? 'B' : pct >= 50 ? 'C' : pct >= 35 ? 'D' : 'F';

  return { securityAudit: audit, securityScore: pct, securityGrade: grade };
}
