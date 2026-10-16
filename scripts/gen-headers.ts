// Genera public/_headers (Cloudflare Pages) a partir de shared/headers.ts.
// Se ejecuta automáticamente antes de `vite build` (ver "prebuild" en package.json).
import { writeFileSync } from 'node:fs';
import { SECURITY_HEADERS } from '../shared/headers.ts';

const lines = [
  '# ARCHIVO GENERADO por scripts/gen-headers.ts — no editar a mano (edite shared/headers.ts)',
  '/*',
  ...Object.entries(SECURITY_HEADERS).map(([k, v]) => `  ${k}: ${v}`),
  '',
  '/api/*',
  '  Cache-Control: no-store',
  '',
  '/assets/*',
  '  Cache-Control: public, max-age=31536000, immutable',
  '',
  '/sw.js',
  '  Cache-Control: no-cache',
  '',
];
writeFileSync(new URL('../public/_headers', import.meta.url), lines.join('\n'));
console.log('public/_headers generado');
