import test, { mock } from 'node:test';
import assert from 'node:assert/strict';
import dns from 'node:dns';
import http from 'node:http';
import https from 'node:https';
import { EventEmitter } from 'node:events';
import { BlockedTargetError, InvalidInputError, safeHeadRequest, safeLookup, assertPublicHost } from '../server/security.ts';

type Addr = { address: string; family: number };

/** Sustituye dns.lookup (callback) y dns.promises.lookup por una tabla host → direcciones. */
function mockDns(table: Record<string, Addr[]>) {
  const resolve = (host: string): Addr[] => {
    const found = table[host];
    if (!found) throw Object.assign(new Error(`getaddrinfo ENOTFOUND ${host}`), { code: 'ENOTFOUND' });
    return found;
  };
  mock.method(dns, 'lookup', (host: string, _opts: unknown, cb: (e: Error | null, a?: Addr[]) => void) => {
    try {
      cb(null, resolve(host));
    } catch (e) {
      cb(e as Error);
    }
  });
  mock.method(dns.promises, 'lookup', async (host: string) => resolve(host));
}

const lookupAsync = (host: string, all = false) =>
  new Promise<any>((resolve, reject) => {
    (safeLookup as any)(host, { all }, (err: Error | null, a: unknown, f?: number) => (err ? reject(err) : resolve(all ? a : { address: a, family: f })));
  });

test('safeLookup rechaza si CUALQUIER respuesta A/AAAA es privada (DNS rebinding multi-registro)', async (t) => {
  t.after(() => mock.restoreAll());
  mockDns({
    'ok.test': [{ address: '93.184.216.34', family: 4 }],
    'mixed.test': [{ address: '93.184.216.34', family: 4 }, { address: '10.0.0.5', family: 4 }],
    'meta.test': [{ address: '169.254.169.254', family: 4 }],
    'v6.test': [{ address: '::ffff:127.0.0.1', family: 6 }],
  });
  assert.deepEqual(await lookupAsync('ok.test'), { address: '93.184.216.34', family: 4 });
  assert.equal((await lookupAsync('ok.test', true)).length, 1, 'modo all:true (autoSelectFamily de Node 20+)');
  await assert.rejects(lookupAsync('mixed.test'), BlockedTargetError);
  await assert.rejects(lookupAsync('mixed.test', true), BlockedTargetError);
  await assert.rejects(lookupAsync('meta.test'), BlockedTargetError);
  await assert.rejects(lookupAsync('v6.test'), BlockedTargetError);
  await assert.rejects(lookupAsync('localhost'), BlockedTargetError, 'nombres locales ni se resuelven');
});

test('assertPublicHost bloquea nombres que resuelven a IPs privadas', async (t) => {
  t.after(() => mock.restoreAll());
  mockDns({ 'rebind.test': [{ address: '127.0.0.1', family: 4 }], 'good.test': [{ address: '1.1.1.1', family: 4 }] });
  await assert.rejects(assertPublicHost('rebind.test'), BlockedTargetError);
  await assert.doesNotReject(assertPublicHost('good.test'));
});

/** Simula http(s).request devolviendo una respuesta fija por cada llamada, y registra a qué host se pidió. */
function mockRequests(responses: Array<{ status: number; headers: Record<string, string> }>) {
  const calls: string[] = [];
  let i = 0;
  const fake = (opts: any, cb: (res: any) => void) => {
    calls.push(`${opts.protocol}//${opts.hostname}:${opts.port}${opts.path}`);
    const r = responses[Math.min(i++, responses.length - 1)];
    const req = new EventEmitter() as any;
    req.end = () => queueMicrotask(() => cb({ statusCode: r.status, statusMessage: 'X', headers: r.headers, destroy() {} }));
    return req;
  };
  mock.method(http, 'request', fake as any);
  mock.method(https, 'request', fake as any);
  return calls;
}

test('safeHeadRequest revalida CADA redirección: público → 169.254.169.254 se bloquea', async (t) => {
  t.after(() => mock.restoreAll());
  mockDns({ 'public.test': [{ address: '93.184.216.34', family: 4 }] });
  const calls = mockRequests([{ status: 302, headers: { location: 'http://169.254.169.254/latest/meta-data/' } }]);
  await assert.rejects(safeHeadRequest('http://public.test/'), BlockedTargetError);
  assert.equal(calls.length, 1, 'no se llegó a pedir el destino interno');
});

test('safeHeadRequest bloquea redirección a un host cuyo DNS apunta a IP privada', async (t) => {
  t.after(() => mock.restoreAll());
  mockDns({
    'public.test': [{ address: '93.184.216.34', family: 4 }],
    'sneaky.test': [{ address: '192.168.1.10', family: 4 }],
  });
  const calls = mockRequests([{ status: 301, headers: { location: 'https://sneaky.test/admin' } }]);
  await assert.rejects(safeHeadRequest('https://public.test/'), BlockedTargetError);
  assert.equal(calls.length, 1);
});

test('safeHeadRequest bloquea redirecciones a puertos/esquemas no permitidos y con credenciales', async (t) => {
  t.after(() => mock.restoreAll());
  mockDns({ 'public.test': [{ address: '93.184.216.34', family: 4 }] });
  mockRequests([{ status: 302, headers: { location: 'http://public.test:6379/' } }]);
  await assert.rejects(safeHeadRequest('http://public.test/'), InvalidInputError);
  mock.restoreAll();

  mockDns({ 'public.test': [{ address: '93.184.216.34', family: 4 }] });
  mockRequests([{ status: 302, headers: { location: 'file:///etc/passwd' } }]);
  await assert.rejects(safeHeadRequest('http://public.test/'), InvalidInputError);
  mock.restoreAll();

  mockDns({ 'public.test': [{ address: '93.184.216.34', family: 4 }] });
  mockRequests([{ status: 302, headers: { location: 'http://user:pw@public.test/' } }]);
  await assert.rejects(safeHeadRequest('http://public.test/'), InvalidInputError);
});

test('safeHeadRequest sigue redirecciones legítimas y devuelve cabeceras normalizadas', async (t) => {
  t.after(() => mock.restoreAll());
  mockDns({
    'a.test': [{ address: '93.184.216.34', family: 4 }],
    'b.test': [{ address: '1.1.1.1', family: 4 }],
  });
  const calls = mockRequests([
    { status: 301, headers: { location: 'https://b.test/home' } },
    { status: 200, headers: { 'content-type': 'text/html', 'strict-transport-security': 'max-age=1' } },
  ]);
  const r = await safeHeadRequest('http://a.test/');
  assert.equal(r.status, 200);
  assert.equal(r.finalUrl, 'https://b.test/home');
  assert.deepEqual(r.redirects, ['http://a.test/']);
  assert.equal(r.headers['strict-transport-security'], 'max-age=1');
  assert.equal(calls.length, 2);
});

test('safeHeadRequest corta bucles de redirección', async (t) => {
  t.after(() => mock.restoreAll());
  mockDns({ 'loop.test': [{ address: '93.184.216.34', family: 4 }] });
  const calls = mockRequests([{ status: 302, headers: { location: 'http://loop.test/' } }]);
  await assert.rejects(safeHeadRequest('http://loop.test/', { maxRedirects: 3 }), /redirecciones/i);
  assert.equal(calls.length, 4);
});
