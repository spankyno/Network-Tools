import test, { mock } from 'node:test';
import assert from 'node:assert/strict';
import { onRequest } from '../functions/api/[[route]].ts';

const DNS: Record<string, string[]> = {
  'ok.test': ['93.184.216.34'],
  'priv.test': ['10.0.0.1'],
  'ssl.test': ['1.1.1.1'],
  'ssl2.test': ['1.1.1.1'],
  'h.test': ['1.1.1.1'],
  'redir.test': ['1.1.1.1'],
};

/** fetch simulado: DoH de Cloudflare, crt.sh, Globalping, proveedores GEO y destinos "web". */
function installFetch(extra: (url: URL, init?: RequestInit) => Response | undefined = () => undefined) {
  mock.method(globalThis, 'fetch', async (input: any, init?: RequestInit) => {
    const url = new URL(typeof input === 'string' ? input : input.url);
    const custom = extra(url, init);
    if (custom) return custom;
    if (url.hostname === 'cloudflare-dns.com') {
      const name = url.searchParams.get('name')!;
      const type = url.searchParams.get('type');
      const addrs = DNS[name] || [];
      const Answer = type === 'A' ? addrs.map((a) => ({ name, type: 1, TTL: 60, data: a })) : [];
      return Response.json({ Status: addrs.length ? 0 : 3, Answer });
    }
    return new Response('{}', { status: 500 });
  });
}
const call = async (path: string, init: RequestInit = {}, ctx: any = {}) => {
  const res = await onRequest({ request: new Request(`https://app.test${path}`, init), env: {}, ...ctx });
  return { res, body: res.headers.get('content-type')?.includes('json') ? await res.json() : null };
};

test('Edge: no hay CORS comodín y los orígenes ajenos no reciben ACAO', async (t) => {
  t.after(() => mock.restoreAll());
  installFetch();
  const { res } = await call('/api/speedtest/ping', { headers: { Origin: 'https://evil.example' } });
  assert.equal(res.headers.get('access-control-allow-origin'), null);
  assert.equal(res.headers.get('x-content-type-options'), 'nosniff');
  const ok = await call('/api/speedtest/ping', { headers: { Origin: 'https://mi.app' } }, { env: { ALLOWED_ORIGINS: 'https://mi.app' } });
  assert.equal(ok.res.headers.get('access-control-allow-origin'), 'https://mi.app');
});

test('Edge: métodos no permitidos y endpoints desconocidos', async (t) => {
  t.after(() => mock.restoreAll());
  installFetch();
  assert.equal((await call('/api/dns?name=a.com', { method: 'DELETE' })).res.status, 405);
  assert.equal((await call('/api/nada')).res.status, 404);
});

test('Edge: validación de tipo DNS y nombre', async (t) => {
  t.after(() => mock.restoreAll());
  installFetch();
  assert.equal((await call('/api/dns?name=a.com&type=ANY')).res.status, 400);
  assert.equal((await call('/api/dns?name=a.com&type=A%26do%3Dtrue')).res.status, 400);
  assert.equal((await call('/api/dns')).res.status, 400);
});

test('Edge: SSRF bloqueado en headers, http-versions, ssl, traceroute y puertos', async (t) => {
  t.after(() => mock.restoreAll());
  installFetch();
  for (const path of [
    '/api/headers?url=http://127.0.0.1:8080/',
    '/api/headers?url=http://169.254.169.254/latest/meta-data/',
    '/api/headers?url=http://2130706433:8080/',
    '/api/headers?url=http://localhost:8080/',
    '/api/headers?url=http://priv.test/', // nombre que resuelve a 10.0.0.1
    '/api/http-versions?host=127.0.0.1',
    '/api/ssl?host=10.0.0.1',
    '/api/ssl?host=priv.test',
    '/api/traceroute?target=192.168.0.1',
    '/api/port-check?host=127.0.0.1',
    '/api/port-check?host=priv.test&port=22',
  ]) {
    const { res, body } = await call(path);
    assert.equal(res.status, 400, `${path} debería ser 400 y fue ${res.status}`);
    assert.match(body.error, /públicos|válid|no permitido|credenciales/i, path);
  }
});

test('Edge: /api/headers revalida redirecciones (público → metadatos cloud)', async (t) => {
  t.after(() => mock.restoreAll());
  const seen: string[] = [];
  installFetch((url) => {
    if (url.hostname === 'redir.test') {
      seen.push(url.href);
      return new Response(null, { status: 302, headers: { location: 'http://169.254.169.254/latest/meta-data/' } });
    }
    if (url.hostname === '169.254.169.254') {
      seen.push(url.href);
      return new Response('SECRET', { status: 200 });
    }
  });
  const { res } = await call('/api/headers?url=https://redir.test/');
  assert.equal(res.status, 400);
  assert.deepEqual(seen, ['https://redir.test/'], 'nunca se pidió el destino interno');
});

test('Edge: /api/headers devuelve cabeceras y auditoría para un destino público', async (t) => {
  t.after(() => mock.restoreAll());
  installFetch((url) => {
    if (url.hostname === 'ok.test') {
      return new Response('<html>', { status: 200, headers: { 'strict-transport-security': 'max-age=63072000', 'x-content-type-options': 'nosniff' } });
    }
  });
  const { res, body } = await call('/api/headers?url=ok.test');
  assert.equal(res.status, 200);
  assert.equal(body.statusCode, 200);
  assert.equal(body.headers['x-content-type-options'], 'nosniff');
  assert.ok(body.securityScore > 0 && body.securityAudit.length === 6);
});

test('Edge: /api/ssl NO fabrica datos y marca la respuesta como limitada', async (t) => {
  t.after(() => mock.restoreAll());
  const future = new Date(Date.now() + 60 * 86_400_000).toISOString();
  const past = new Date(Date.now() - 30 * 86_400_000).toISOString();
  installFetch((url) => {
    if (url.hostname === 'crt.sh') {
      return Response.json([
        { id: 1, serial_number: 'AAA', issuer_name: "C=US, O=Let's Encrypt, CN=R11", common_name: 'ssl.test', name_value: 'ssl.test\nwww.ssl.test', not_before: past, not_after: future, entry_timestamp: past },
      ]);
    }
    if (url.hostname === 'ssl.test') return new Response(null, { status: 200 });
  });
  const { res, body } = await call('/api/ssl?host=ssl.test');
  assert.equal(res.status, 200);
  assert.equal(body.limited, true);
  assert.match(body.notice, /Transparencia/);
  assert.equal(body.authorized, true);
  assert.equal(body.cipher, null);
  assert.notEqual(body.protocol, 'TLSv1.3', 'ya no se inventa el protocolo');
  assert.equal(body.fingerprint256, '');
  assert.equal(body.serialNumber, 'AAA');
  assert.equal(body.issuer.commonName, 'R11');
  assert.equal(body.issuer.organization, "Let's Encrypt");
  assert.ok(body.daysRemaining >= 59 && body.daysRemaining <= 60);
  assert.equal(body.expiryStatus, 'VALID');
});

test('Edge: /api/ssl sin HTTPS verificable → authorized=false; sin CT → 404; puerto ≠ 443 → 400', async (t) => {
  t.after(() => mock.restoreAll());
  installFetch((url) => {
    if (url.hostname === 'crt.sh') return Response.json([]);
    if (url.hostname === 'ssl2.test') throw new TypeError('fetch failed');
  });
  assert.equal((await call('/api/ssl?host=ssl2.test')).res.status, 404);
  assert.equal((await call('/api/ssl?host=ssl2.test&port=8443')).res.status, 400);
});

test('Edge: /api/http-versions no afirma HTTP/2 sin evidencia', async (t) => {
  t.after(() => mock.restoreAll());
  installFetch((url) => {
    if (url.hostname === 'h.test') return new Response(null, { status: 200 }); // responde, pero sin alt-svc ni HTTPS RR
  });
  const { body } = await call('/api/http-versions?host=h.test');
  assert.equal(body.supports.http2, false, 'antes se marcaba true siempre que el fetch respondía');
  assert.equal(body.supports.http3, false);
  assert.match(body.protocols[1].statusText, /no confirmado/i);
});

test('Edge: /api/traceroute no inventa saltos cuando Globalping falla', async (t) => {
  t.after(() => mock.restoreAll());
  installFetch(); // api.globalping.io → 500
  const { res, body } = await call('/api/traceroute?target=ok.test');
  assert.equal(res.status, 502);
  assert.ok(!body.hops && !body.probes, 'sin saltos simulados');
  assert.match(body.error, /Globalping/);
  assert.equal((await call('/api/traceroute?target=ok.test&region=%3Cscript%3E')).res.status, 400);
});

test('Edge: /api/ip no inventa "Madrid/Telefónica" ni mezcla datos del visitante con otra IP', async (t) => {
  t.after(() => mock.restoreAll());
  installFetch(); // todos los proveedores → 500
  const other = await call('/api/ip?ip=8.8.8.8');
  assert.equal(other.res.status, 502);
  assert.ok(!JSON.stringify(other.body).includes('Madrid'));
  assert.ok(!JSON.stringify(other.body).includes('Telef'));
  assert.equal((await call('/api/ip?ip=192.168.1.5')).res.status, 400);
  assert.equal((await call('/api/ip?ip=127.0.0.1')).res.status, 400);
  assert.equal((await call('/api/ip?ip=localhost')).res.status, 400);
});

test('Edge: /api/ip usa los datos cf SOLO para la IP del propio visitante', async (t) => {
  t.after(() => mock.restoreAll());
  installFetch();
  const req = new Request('https://app.test/api/ip', { headers: { 'cf-connecting-ip': '203.0.114.9' } });
  Object.defineProperty(req, 'cf', { value: { city: 'Valencia', country: 'ES', asOrganization: 'ISP Real', asn: 1234, latitude: '39.47', longitude: '-0.37' } });
  const res = await onRequest({ request: req, env: {} });
  const body: any = await res.json();
  assert.equal(res.status, 200);
  assert.equal(body.city, 'Valencia');
  assert.equal(body.org, 'ISP Real');
  assert.match(body.providerUsed, /propio visitante/);
  // X-Forwarded-For (controlado por el cliente) NO se usa como IP del visitante
  const spoof = await call('/api/ip', { headers: { 'x-forwarded-for': '8.8.8.8' } });
  assert.ok(!spoof.body.ip || spoof.body.ip !== '8.8.8.8');
});

test('Edge: subida del speed test con tope de 32 MB', async (t) => {
  t.after(() => mock.restoreAll());
  installFetch();
  const big = new Uint8Array(33 * 1024 * 1024);
  const { res } = await call('/api/speedtest/upload', { method: 'POST', body: big, headers: { 'content-type': 'application/octet-stream' } });
  assert.equal(res.status, 413);
  const small = await call('/api/speedtest/upload', { method: 'POST', body: new Uint8Array(1024) });
  assert.equal(small.body.receivedBytes, 1024);
});

test('Edge: límite de ritmo por IP', async (t) => {
  t.after(() => mock.restoreAll());
  installFetch();
  const codes: number[] = [];
  for (let i = 0; i < 130; i++) {
    codes.push((await call('/api/dns?name=a.com&type=ANY', { headers: { 'cf-connecting-ip': '198.51.100.77' } })).res.status);
  }
  assert.ok(codes.filter((c) => c === 429).length >= 10, 'tras 120 peticiones/min se devuelve 429');
  assert.equal(codes[0], 400);
});
