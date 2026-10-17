import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import { CSP } from '../shared/headers.ts';

const swSource = readFileSync(new URL('../public/sw.js', import.meta.url), 'utf8');

/** Directiva del CSP → lista de fuentes. */
const directive = (name: string) =>
  (CSP.split(';').map((d) => d.trim()).find((d) => d.startsWith(`${name} `)) ?? '').split(/\s+/).slice(1);

/** ¿Alguna fuente CSP (https://host o https://*.host) permite esta URL? */
function allowed(sources: string[], urlStr: string): boolean {
  const u = new URL(urlStr);
  return sources.some((src) => {
    if (!src.startsWith('https://')) return false;
    const host = src.slice('https://'.length);
    return host.startsWith('*.') ? u.hostname.endsWith(host.slice(1)) && u.hostname.length > host.length - 1 : u.hostname === host;
  });
}

// URLs reales que usa la app (IpLookupTool e index.html). {s} = subdominio de balanceo (a, b, c)
const appResources = [
  ...[...readFileSync(new URL('../src/components/tools/IpLookupTool.tsx', import.meta.url), 'utf8').matchAll(/url: '(https:\/\/[^']+)'/g)].map((m) => m[1].replace('{s}', 'a').replace(/\{[a-z]\}/g, '1')),
  'https://fonts.googleapis.com/css2?family=Plus+Jakarta+Sans:wght@400&display=swap',
  'https://fonts.gstatic.com/s/plusjakartasans/v1/x.woff2',
];

test('hay recursos externos que comprobar (el test no puede quedar vacío)', () => {
  assert.ok(appResources.length >= 5, `solo se detectaron ${appResources.length}`);
});

test('regresión: el SW descarga fuentes y teselas con fetch(), así que TODAS deben estar en connect-src', () => {
  const connect = directive('connect-src');
  for (const url of appResources) {
    assert.ok(allowed(connect, url), `connect-src bloquea ${url} cuando lo descarga el Service Worker`);
  }
});

test('las teselas siguen permitidas en img-src y las fuentes en style-src/font-src (carga directa sin SW)', () => {
  for (const url of appResources.filter((u) => /tile|cartocdn/.test(u))) assert.ok(allowed(directive('img-src'), url), url);
  assert.ok(allowed(directive('style-src'), appResources.find((u) => u.includes('googleapis'))!));
  assert.ok(allowed(directive('font-src'), appResources.find((u) => u.includes('gstatic'))!));
});

test('todo host que intercepta el SW (ALLOWED_HOSTS) está cubierto por connect-src', () => {
  const hosts = [...swSource.match(/const ALLOWED_HOSTS = \[([\s\S]*?)\];/)![1].matchAll(/'([^']+)'/g)].map((m) => m[1]);
  assert.ok(hosts.length >= 5);
  const connect = directive('connect-src');
  for (const h of hosts) {
    assert.ok(allowed(connect, `https://${h}/x`) || allowed(connect, `https://a.${h}/x`), `ALLOWED_HOSTS incluye ${h} pero connect-src no lo permite`);
  }
});

// ---- ejecutar el sw.js REAL con un entorno simulado -------------------------------------------------
function loadSw(opts: { fetchImpl: (req: any) => Promise<Response>; cached?: Response | undefined }) {
  const handlers: Record<string, (e: any) => void> = {};
  const puts: string[] = [];
  const cache = {
    match: async () => opts.cached,
    put: async (req: any) => void puts.push(req.url),
    keys: async () => [],
    delete: async () => true,
    addAll: async () => undefined,
  };
  const self: any = {
    location: { origin: 'https://app.test' },
    addEventListener: (type: string, fn: (e: any) => void) => (handlers[type] = fn),
    skipWaiting: () => undefined,
    clients: { claim: async () => undefined },
  };
  const ctx = vm.createContext({
    self, URL, Response, Promise, console,
    caches: { open: async () => cache, match: async () => opts.cached, keys: async () => [], delete: async () => true },
    fetch: opts.fetchImpl,
  });
  vm.runInContext(swSource, ctx);
  return { handlers, puts };
}

async function dispatchFetch(h: ReturnType<typeof loadSw>, url: string, init: { method?: string; mode?: string } = {}) {
  let responded: Promise<unknown> | undefined;
  h.handlers.fetch({ request: { method: init.method ?? 'GET', url, mode: init.mode ?? 'no-cors' }, respondWith: (p: Promise<unknown>) => (responded = p) });
  return responded;
}

const TILE = 'https://tile.openstreetmap.org/12/2003/1545.png';

test('SW: sin red y sin caché devuelve una Response (antes: undefined → "Failed to convert value to Response")', async () => {
  const sw = loadSw({ fetchImpl: async () => { throw new TypeError('Failed to fetch'); } });
  const result = await (await dispatchFetch(sw, TILE)) as Response;
  assert.ok(result instanceof Response, 'respondWith debe recibir siempre una Response');
  assert.equal(result.type, 'error');
});

test('SW: sin red pero con caché sirve la copia', async () => {
  const cached = new Response('tesela-en-cache');
  const sw = loadSw({ fetchImpl: async () => { throw new TypeError('Failed to fetch'); }, cached });
  const result = await (await dispatchFetch(sw, TILE)) as Response;
  assert.equal(await result.text(), 'tesela-en-cache');
});

test('SW: con red devuelve la respuesta de red', async () => {
  const sw = loadSw({ fetchImpl: async () => new Response('png', { status: 200 }) });
  const result = await (await dispatchFetch(sw, TILE)) as Response;
  assert.equal(await result.text(), 'png');
});

test('SW: no intercepta /api/, POST, hosts no permitidos ni esquemas raros', async () => {
  const sw = loadSw({ fetchImpl: async () => new Response('x') });
  assert.equal(await dispatchFetch(sw, 'https://app.test/api/ip'), undefined);
  assert.equal(await dispatchFetch(sw, TILE, { method: 'POST' }), undefined);
  assert.equal(await dispatchFetch(sw, 'https://evil-openstreetmap.org.attacker.com/x.png'), undefined);
  assert.equal(await dispatchFetch(sw, 'https://tile.openstreetmap.org.attacker.com/x.png'), undefined);
  assert.equal(await dispatchFetch(sw, 'chrome-extension://abc/x.js'), undefined);
});

test('SW: navegación sin red ni caché devuelve Response.error() en vez de colgarse', async () => {
  const sw = loadSw({ fetchImpl: async () => { throw new TypeError('offline'); } });
  const result = await (await dispatchFetch(sw, 'https://app.test/', { mode: 'navigate' })) as Response;
  assert.ok(result instanceof Response);
});
