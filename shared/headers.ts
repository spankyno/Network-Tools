// Fuente única de las cabeceras de seguridad. La usan:
//   - server.ts (Express)                       → middleware securityHeaders()
//   - scripts/gen-headers.ts → public/_headers  → Cloudflare Pages (se regenera en cada build)

/** Origen del script de analítica propia declarado en index.html. */
export const TRACKER_ORIGIN = 'https://aitors-hub-dashboard.asanchezgu.workers.dev';
/** Cloudflare Turnstile: script del widget + iframe del reto. */
export const TURNSTILE_ORIGIN = 'https://challenges.cloudflare.com';

export const CSP = [
  "default-src 'self'",
  `script-src 'self' ${TRACKER_ORIGIN} ${TURNSTILE_ORIGIN}`,
  // Tailwind/Leaflet inyectan estilos en línea; los scripts en línea siguen prohibidos.
  "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",
  "font-src 'self' https://fonts.gstatic.com",
  // Teselas de los tres mapas base de IpLookupTool
  "img-src 'self' data: https://tile.openstreetmap.org https://*.tile.openstreetmap.fr https://*.basemaps.cartocdn.com",
  `connect-src 'self' https://speed.cloudflare.com ${TRACKER_ORIGIN} ${TURNSTILE_ORIGIN}`,
  `frame-src ${TURNSTILE_ORIGIN}`,
  "manifest-src 'self'",
  "worker-src 'self'",
  "object-src 'none'",
  "base-uri 'self'",
  "form-action 'self'",
  "frame-ancestors 'none'",
].join('; ');

export const SECURITY_HEADERS: Record<string, string> = {
  'Content-Security-Policy': CSP,
  'Strict-Transport-Security': 'max-age=31536000',
  'X-Content-Type-Options': 'nosniff',
  'X-Frame-Options': 'DENY',
  'Referrer-Policy': 'strict-origin-when-cross-origin',
  'Permissions-Policy': 'camera=(), microphone=(), geolocation=(), payment=(), usb=()',
  'Cross-Origin-Opener-Policy': 'same-origin',
};
