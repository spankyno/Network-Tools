import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import express from 'express';
import {
  signPass, verifyPass, verifyTurnstileToken, parseCookie, passCookie, turnstileEnabled, PASS_COOKIE, type TurnstileConfig,
} from '../shared/turnstile.ts';
import { MemoryRateStore } from '../shared/rate-limit.ts';
import { humanGate, rateLimit, turnstileVerifyHandler } from '../server/security.ts';

const cfg: TurnstileConfig = { secret: 'secret-key-for-tests', siteKey: 'site-key' };
const IP = '203.0.113.7';

test('pase: firma y verificación correctas', async () => {
  const pass = await signPass(cfg, IP);
  assert.equal(await verifyPass(cfg, pass, IP), true);
});

test('pase: rechaza otra IP, caducado, manipulado, vacío y con otra clave', async () => {
  const now = 1_800_000_000_000;
  const pass = await signPass(cfg, IP, now, 600);
  assert.equal(await verifyPass(cfg, pass, IP, now + 599_000), true);
  assert.equal(await verifyPass(cfg, pass, IP, now + 601_000), false, 'caducado');
  assert.equal(await verifyPass(cfg, pass, '198.51.100.9', now), false, 'otra IP');
  const [exp, sig] = pass.split('.');
  assert.equal(await verifyPass(cfg, `${Number(exp) + 3600}.${sig}`, IP, now), false, 'alargar la caducidad invalida la firma');
  assert.equal(await verifyPass(cfg, `${exp}.${sig.slice(0, -2)}AA`, IP, now), false, 'firma alterada');
  assert.equal(await verifyPass(cfg, undefined, IP, now), false);
  assert.equal(await verifyPass(cfg, 'basura', IP, now), false);
  assert.equal(await verifyPass(cfg, `x.${sig}`, IP, now), false);
  assert.equal(await verifyPass({ ...cfg, secret: 'otra' }, pass, IP, now), false, 'otra clave');
});

test('pase: signingKey separada permite rotar sin tocar el secreto de Turnstile', async () => {
  const withKey = { ...cfg, signingKey: 'rotable' };
  const pass = await signPass(withKey, IP);
  assert.equal(await verifyPass(withKey, pass, IP), true);
  assert.equal(await verifyPass(cfg, pass, IP), false);
});

test('siteverify: éxito, rechazo, entrada inválida e inalcanzable', async () => {
  const ok = async (_u: any, init: any) => {
    assert.equal(init.body.get('secret'), 'S');
    assert.equal(init.body.get('response'), 'tokentokentoken');
    assert.equal(init.body.get('remoteip'), IP);
    return Response.json({ success: true });
  };
  assert.deepEqual(await verifyTurnstileToken('S', 'tokentokentoken', IP, ok as any), { success: true, errorCodes: [] });
  const bad = async () => Response.json({ success: false, 'error-codes': ['invalid-input-response'] });
  const r = await verifyTurnstileToken('S', 'tokentokentoken', IP, bad as any);
  assert.equal(r.success, false);
  assert.equal(r.unreachable, undefined);
  assert.equal((await verifyTurnstileToken('S', '', IP, ok as any)).success, false, 'token vacío ni llega a Cloudflare');
  assert.equal((await verifyTurnstileToken('S', 'x'.repeat(3000), IP, ok as any)).success, false);
  const down = async () => { throw new TypeError('fetch failed'); };
  assert.equal((await verifyTurnstileToken('S', 'tokentokentoken', IP, down as any)).unreachable, true);
  const http500 = async () => new Response('', { status: 500 });
  assert.equal((await verifyTurnstileToken('S', 'tokentokentoken', IP, http500 as any)).unreachable, true);
});

test('cookie: parseo y atributos de seguridad', () => {
  assert.equal(parseCookie(`a=1; ${PASS_COOKIE}=abc.def; b=2`, PASS_COOKIE), 'abc.def');
  assert.equal(parseCookie('a=1', PASS_COOKIE), undefined);
  assert.equal(parseCookie(null, PASS_COOKIE), undefined);
  const c = passCookie('v', true);
  for (const attr of ['HttpOnly', 'SameSite=Strict', 'Secure', 'Path=/api', 'Max-Age=600']) assert.ok(c.includes(attr), attr);
  assert.ok(!passCookie('v', false).includes('Secure'));
  assert.equal(turnstileEnabled({ secret: 's' }), false, 'hacen falta ambas claves');
  assert.equal(turnstileEnabled(cfg), true);
});

// ---- integración Express (servidor real en puerto efímero) -----------------------------------------
function request(port: number, method: string, path: string, opts: { cookie?: string; body?: unknown } = {}) {
  return new Promise<{ status: number; headers: http.IncomingHttpHeaders; json: any }>((resolve, reject) => {
    const data = opts.body !== undefined ? JSON.stringify(opts.body) : undefined;
    const req = http.request({ port, method, path, host: '127.0.0.1', headers: { ...(opts.cookie ? { Cookie: opts.cookie } : {}), ...(data ? { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(data) } : {}) } }, (res) => {
      let buf = '';
      res.on('data', (c) => (buf += c));
      res.on('end', () => resolve({ status: res.statusCode!, headers: res.headers, json: buf ? JSON.parse(buf) : null }));
    });
    req.on('error', reject);
    if (data) req.write(data);
    req.end();
  });
}

async function withApp(config: TurnstileConfig, fetchImpl: typeof fetch, fn: (port: number) => Promise<void>) {
  const app = express();
  const store = new MemoryRateStore();
  app.post('/api/turnstile/verify', rateLimit({ name: 'verify', store, windowMs: 60_000, max: 3 }), express.json({ limit: '4kb' }), turnstileVerifyHandler(config, fetchImpl));
  app.get('/api/heavy', humanGate(config), (_req, res) => res.json({ ok: true }));
  app.get('/api/light', (_req, res) => res.json({ ok: true }));
  const server = await new Promise<http.Server>((r) => { const s = app.listen(0, '127.0.0.1', () => r(s)); });
  try { await fn((server.address() as any).port); } finally { server.close(); }
}

test('Express: ruta pesada exige pase; verificación correcta emite cookie que la desbloquea', async () => {
  await withApp(cfg, (async () => Response.json({ success: true })) as any, async (port) => {
    assert.equal((await request(port, 'GET', '/api/light')).status, 200, 'rutas no protegidas no se tocan');
    const blocked = await request(port, 'GET', '/api/heavy');
    assert.equal(blocked.status, 403);
    assert.equal(blocked.json.code, 'CAPTCHA_REQUIRED');

    const v = await request(port, 'POST', '/api/turnstile/verify', { body: { token: 'tokentokentoken' } });
    assert.equal(v.status, 200);
    const setCookie = String(v.headers['set-cookie']);
    assert.match(setCookie, /nc_pass=\d+\.[\w-]+; Path=\/api; Max-Age=600; HttpOnly; SameSite=Strict/);

    const cookie = setCookie.split(';')[0];
    assert.equal((await request(port, 'GET', '/api/heavy', { cookie })).status, 200);
    const forged = cookie.replace(/.$/, (c) => (c === 'A' ? 'B' : 'A'));
    assert.equal((await request(port, 'GET', '/api/heavy', { cookie: forged })).status, 403, 'cookie falsificada');
  });
});

test('Express: verificación rechazada → 403 y sin cookie; Cloudflare caído → 503', async () => {
  await withApp(cfg, (async () => Response.json({ success: false, 'error-codes': ['invalid-input-response'] })) as any, async (port) => {
    const v = await request(port, 'POST', '/api/turnstile/verify', { body: { token: 'tokentokentoken' } });
    assert.equal(v.status, 403);
    assert.equal(v.json.code, 'CAPTCHA_FAILED');
    assert.equal(v.headers['set-cookie'], undefined);
  });
  await withApp(cfg, (async () => { throw new TypeError('down'); }) as any, async (port) => {
    const v = await request(port, 'POST', '/api/turnstile/verify', { body: { token: 'tokentokentoken' } });
    assert.equal(v.status, 503);
    assert.equal(v.json.code, 'CAPTCHA_UNAVAILABLE');
  });
});

test('Express: sin token o con cuerpo no JSON no llega a Cloudflare ni da pase', async () => {
  let calls = 0;
  await withApp(cfg, (async () => { calls++; return Response.json({ success: true }); }) as any, async (port) => {
    assert.equal((await request(port, 'POST', '/api/turnstile/verify', { body: {} })).status, 403);
    assert.equal((await request(port, 'POST', '/api/turnstile/verify', { body: { token: 12345 } })).status, 403);
    assert.equal(calls, 0);
  });
});

test('Express: intentos de verificación limitados (anti fuerza bruta)', async () => {
  await withApp(cfg, (async () => Response.json({ success: false })) as any, async (port) => {
    const codes: number[] = [];
    for (let i = 0; i < 5; i++) codes.push((await request(port, 'POST', '/api/turnstile/verify', { body: { token: 'tokentokentoken' } })).status);
    assert.deepEqual(codes, [403, 403, 403, 429, 429]);
  });
});

test('Express: sin claves de Turnstile no hay gate y la app funciona igual', async () => {
  await withApp({}, (async () => { throw new Error('no debe llamarse'); }) as any, async (port) => {
    assert.equal((await request(port, 'GET', '/api/heavy')).status, 200);
    const v = await request(port, 'POST', '/api/turnstile/verify', { body: {} });
    assert.equal(v.status, 200);
    assert.equal(v.json.disabled, true);
  });
});
