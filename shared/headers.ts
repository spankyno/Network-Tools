// Fuente única de las cabeceras de seguridad. La usan:
//   - server.ts (Express)                       → middleware securityHeaders()
//   - scripts/gen-headers.ts → public/_headers  → Cloudflare Pages (se regenera en cada build)

/** Origen del script de analítica propia declarado en index.html. */
export const TRACKER_ORIGIN = 'https://aitors-hub-dashboard.asanchezgu.workers.dev';
/** Cloudflare Turnstile: script del widget + iframe del reto. */
export const TURNSTILE_ORIGIN = 'https://challenges.cloudflare.com';

// Hosts de recursos que el Service Worker (public/sw.js) intercepta y descarga con fetch(): fuentes y teselas de los mapas.
// IMPORTANTE: las descargas hechas por el Service Worker se rigen por `connect-src`, no por img-src/font-src/style-src.
// Cada host de ALLOWED_HOSTS en sw.js debe estar aquí (lo verifica tests/csp-sw.test.ts).
const FONT_SOURCES = ['https://fonts.googleapis.com', 'https://fonts.gstatic.com'];
const TILE_SOURCES = ['https://tile.openstreetmap.org', 'https://*.tile.openstreetmap.fr', 'https://*.basemaps.cartocdn.com'];

export const CSP = [
  "default-src 'self'",
  `script-src 'self' ${TRACKER_ORIGIN} ${TURNSTILE_ORIGIN}`,
  // Tailwind/Leaflet inyectan estilos en línea; los scripts en línea siguen prohibidos.
  "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",
  "font-src 'self' https://fonts.gstatic.com",
  // Teselas de los tres mapas base de IpLookupTool
  `img-src 'self' data: ${TILE_SOURCES.join(' ')}`,
  `connect-src 'self' https://speed.cloudflare.com ${TRACKER_ORIGIN} ${TURNSTILE_ORIGIN} ${FONT_SOURCES.join(' ')} ${TILE_SOURCES.join(' ')}`,
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
