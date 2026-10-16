import test, { mock } from 'node:test';
import assert from 'node:assert/strict';
import { onRequest } from '../functions/api/[[route]].ts';
import { RateLimiter } from '../workers/rate-limiter/index.ts';
import { DurableObjectRateStore } from '../shared/rate-limit-do.ts';

const TS = { TURNSTILE_SECRET_KEY: 'edge-secret', TURNSTILE_SITE_KEY: 'edge-site' };
const call = async (path: string, init: RequestInit = {}, env: any = {}) => {
  const res = await onRequest({ request: new Request(`https://app.test${path}`, init), env });
  const isJson = res.headers.get('content-type')?.includes('json');
  return { res, body: isJson ? await res.json() : null };
};
const withIp = (ip: string, extra: Record<string, string> = {}) => ({ 'cf-connecting-ip': ip, ...extra });
const mockSiteverify = (result: () => Response) =>
  mock.method(globalThis, 'fetch', async (input: any) => {
    const url = String(typeof input === 'string' ? input : input.url);
    if (url.includes('turnstile/v0/siteverify')) return result();
    return new Response('{}', { status: 500 });
  });

test('Edge+Turnstile: /api/config publica la clave solo si está activo', async () => {
  assert.equal((await call('/api/config')).body.turnstileSiteKey, null);
  assert.equal((await call('/api/config', {}, TS)).body.turnstileSiteKey, 'edge-site');
  assert.equal((await call('/api/config', {}, { TURNSTILE_SITE_KEY: 'x' })).body.turnstileSiteKey, null, 'sin secreto no se activa');
});

test('Edge+Turnstile: las 5 rutas pesadas piden reto; las demás no', async () => {
  for (const path of ['/api/ssl?host=a.com', '/api/headers?url=a.com', '/api/http-versions?host=a.com', '/api/port-check?host=a.com', '/api/traceroute?target=a.com']) {
    const { res, body } = await call(path, { headers: withIp('192.0.2.50') }, TS);
    assert.equal(res.status, 403, path);
    assert.equal(body.code, 'CAPTCHA_REQUIRED', path);
  }
  // no protegidas
  assert.notEqual((await call('/api/dns?name=a.com&type=ANY', {}, TS)).res.status, 403);
  assert.equal((await call('/api/speedtest/ping', {}, TS)).res.status, 200);
  // sin claves: nada se bloquea por CAPTCHA (la validación normal responde 400)
  assert.equal((await call('/api/ssl?host=127.0.0.1', { headers: withIp('192.0.2.51') })).res.status, 400);
});

test('Edge+Turnstile: verificación emite cookie ligada a la IP que desbloquea las rutas', async (t) => {
  t.after(() => mock.restoreAll());
  mockSiteverify(() => Response.json({ success: true }));
  const v = await call('/api/turnstile/verify', { method: 'POST', body: JSON.stringify({ token: 'tokentokentoken' }), headers: withIp('192.0.2.60') }, TS);
  assert.equal(v.res.status, 200);
  const setCookie = v.res.headers.get('set-cookie')!;
  assert.match(setCookie, /HttpOnly; SameSite=Strict; Secure/);
  const cookie = setCookie.split(';')[0];

  // con la cookie y desde la misma IP: pasa el gate (llega a la validación: IP privada → 400, no 403)
  const ok = await call('/api/ssl?host=127.0.0.1', { headers: withIp('192.0.2.60', { Cookie: cookie }) }, TS);
  assert.equal(ok.res.status, 400);
  assert.notEqual(ok.body.code, 'CAPTCHA_REQUIRED');
  // la misma cookie desde otra IP no sirve (cookie robada)
  const stolen = await call('/api/ssl?host=127.0.0.1', { headers: withIp('192.0.2.61', { Cookie: cookie }) }, TS);
  assert.equal(stolen.res.status, 403);
});

test('Edge+Turnstile: rechazo → 403, Cloudflare caído → 503, sin token → 403 sin llamar', async (t) => {
  t.after(() => mock.restoreAll());
  mockSiteverify(() => Response.json({ success: false, 'error-codes': ['invalid-input-response'] }));
  const bad = await call('/api/turnstile/verify', { method: 'POST', body: JSON.stringify({ token: 'tokentokentoken' }), headers: withIp('192.0.2.70') }, TS);
  assert.equal(bad.res.status, 403);
  assert.equal(bad.body.code, 'CAPTCHA_FAILED');
  assert.equal(bad.res.headers.get('set-cookie'), null);
  mock.restoreAll();

  mockSiteverify(() => { throw new TypeError('down'); });
  const down = await call('/api/turnstile/verify', { method: 'POST', body: JSON.stringify({ token: 'tokentokentoken' }), headers: withIp('192.0.2.71') }, TS);
  assert.equal(down.res.status, 503);
  mock.restoreAll();

  const f = mock.method(globalThis, 'fetch', async () => { throw new Error('no debe llamarse'); });
  const none = await call('/api/turnstile/verify', { method: 'POST', body: '{{{', headers: withIp('192.0.2.72') }, TS);
  assert.equal(none.res.status, 403);
  assert.equal(f.mock.callCount(), 0);
});

// ---- Durable Object --------------------------------------------------------------------------------
test('RateLimiter DO: ventana, coste y modo strict', async () => {
  const doObj = new RateLimiter();
  const hit = async (body: object) => (await doObj.fetch(new Request('https://x/hit', { method: 'POST', body: JSON.stringify(body) }))).json() as Promise<any>;
  assert.equal((await hit({ windowMs: 200, cost: 1 })).count, 1);
  assert.equal((await hit({ windowMs: 200, cost: 4 })).count, 5);
  const s = await hit({ windowMs: 200, cost: 10, max: 8, strict: true });
  assert.deepEqual([s.applied, s.count], [false, 5], 'strict no gasta presupuesto');
  await new Promise((r) => setTimeout(r, 220));
  assert.equal((await hit({ windowMs: 200, cost: 1 })).count, 1, 'nueva ventana');
  assert.equal((await doObj.fetch(new Request('https://x/hit'))).status, 405);
  assert.equal((await doObj.fetch(new Request('https://x/hit', { method: 'POST', body: '{{' }))).status, 400);
  // valores hostiles se acotan en lugar de romper el objeto
  const hostile = await hit({ windowMs: -5, cost: 'NaN', max: 'x' });
  assert.ok(Number.isFinite(hostile.count) && hostile.resetMs > 0);
});

/** Namespace de DO simulado: un RateLimiter por nombre, igual que en Cloudflare. */
function fakeNamespace(onFetch?: () => void) {
  const objs = new Map<string, RateLimiter>();
  return {
    idFromName: (n: string) => n,
    get: (id: unknown) => {
      if (!objs.has(id as string)) objs.set(id as string, new RateLimiter());
      const o = objs.get(id as string)!;
      return { fetch: async (input: string, init?: RequestInit) => { onFetch?.(); return o.fetch(new Request(input, init)); } };
    },
  };
}

test('DurableObjectRateStore: el límite es compartido por todas las peticiones (globalmente consistente)', async () => {
  const ns = fakeNamespace();
  const a = new DurableObjectRateStore(ns), b = new DurableObjectRateStore(ns); // dos "ubicaciones"
  await a.hit('heavy|1.1.1.1', 5000);
  await b.hit('heavy|1.1.1.1', 5000);
  assert.equal((await a.hit('heavy|1.1.1.1', 5000)).count, 3);
  assert.equal((await a.hit('heavy|2.2.2.2', 5000)).count, 1, 'otra clave, otro objeto');
});

test('Edge: con binding RATE_LIMITER el límite se aplica vía Durable Object', async () => {
  let doCalls = 0;
  const env = { RATE_LIMITER: fakeNamespace(() => doCalls++) };
  const codes: number[] = [];
  for (let i = 0; i < 125; i++) codes.push((await call('/api/dns?name=a.com&type=ANY', { headers: withIp('192.0.2.80') }, env)).res.status);
  assert.ok(doCalls >= 125, 'los contadores viven en el DO');
  assert.equal(codes.filter((c) => c === 429).length, 5);
  // otra IP no se ve afectada
  assert.equal((await call('/api/dns?name=a.com&type=ANY', { headers: withIp('192.0.2.81') }, env)).res.status, 400);
});

test('Edge: si el Durable Object falla, se degrada a memoria y la API sigue protegida', async () => {
  const broken = { idFromName: (n: string) => n, get: () => ({ fetch: async () => { throw new Error('DO caído'); } }) };
  const env = { RATE_LIMITER: broken };
  const logs = mock.method(console, 'error', () => undefined);
  const codes: number[] = [];
  for (let i = 0; i < 125; i++) codes.push((await call('/api/dns?name=a.com&type=ANY', { headers: withIp('192.0.2.90') }, env)).res.status);
  logs.mock.restore();
  assert.equal(codes[0], 400, 'la API responde pese al fallo');
  assert.equal(codes.filter((c) => c === 429).length, 5, 'y sigue limitando en local');
});
