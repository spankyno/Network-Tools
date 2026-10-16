import test from 'node:test';
import assert from 'node:assert/strict';
import {
  isPublicIp,
  parseHost,
  cleanHost,
  parsePort,
  normalizeRecordType,
  TtlCache,
  FixedWindowLimiter,
  analyzeSecurityHeaders,
  isBlockedHostname,
  readJsonLimited,
  ResponseTooLargeError,
  expiryStatusFor,
} from '../shared/net-utils.ts';

test('isPublicIp bloquea rangos privados, loopback, link-local y metadatos cloud', () => {
  for (const ip of [
    '0.0.0.0', '10.1.2.3', '127.0.0.1', '127.255.255.254', '169.254.169.254', '172.16.0.1', '172.31.255.255',
    '192.168.1.1', '100.64.0.1', '198.18.0.1', '224.0.0.1', '255.255.255.255', '192.0.2.10',
  ]) {
    assert.equal(isPublicIp(ip), false, `${ip} debería bloquearse`);
  }
});

test('isPublicIp permite IPs públicas y fronteras de rangos privados', () => {
  for (const ip of ['1.1.1.1', '8.8.8.8', '172.15.255.255', '172.32.0.1', '100.63.255.255', '100.128.0.1', '93.184.216.34']) {
    assert.equal(isPublicIp(ip), true, `${ip} debería permitirse`);
  }
});

test('isPublicIp bloquea IPv6 locales y formas con IPv4 embebida', () => {
  for (const ip of [
    '::', '::1', 'fe80::1', 'fc00::1', 'fd12:3456::1', 'ff02::1', '2001:db8::1',
    '::ffff:127.0.0.1', '::ffff:7f00:1', '::ffff:10.0.0.1', '::ffff:169.254.169.254',
    '64:ff9b::7f00:1', '2002:7f00:1::1', '::127.0.0.1',
  ]) {
    assert.equal(isPublicIp(ip), false, `${ip} debería bloquearse`);
  }
});

test('isPublicIp permite IPv6 públicas y mapeadas a IPv4 públicas', () => {
  for (const ip of ['2606:4700:4700::1111', '2001:4860:4860::8888', '::ffff:8.8.8.8']) {
    assert.equal(isPublicIp(ip), true, `${ip} debería permitirse`);
  }
});

test('isPublicIp rechaza entradas que no son IP', () => {
  for (const ip of ['', 'localhost', 'example.com', '999.1.1.1', '1.2.3', '1.2.3.4.5', '010.0.0.1', '::g', ':::', '1::2::3', 'fe80::1%eth0']) {
    assert.equal(isPublicIp(ip), false, `${JSON.stringify(ip)} no es una IP pública válida`);
  }
});

test('parseHost normaliza URLs, puertos, userinfo y mayúsculas', () => {
  assert.deepEqual(parseHost('HTTPS://Example.COM:8443/ruta?x=1#f'), { host: 'example.com', kind: 'domain' });
  assert.deepEqual(parseHost('user:pass@example.com'), { host: 'example.com', kind: 'domain' });
  assert.deepEqual(parseHost('example.com.'), { host: 'example.com', kind: 'domain' });
  assert.deepEqual(parseHost('1.2.3.4:80'), { host: '1.2.3.4', kind: 'ipv4' });
  assert.deepEqual(parseHost('[2606:4700::1111]:443'), { host: '2606:4700::1111', kind: 'ipv6' });
  assert.deepEqual(parseHost('_dmarc.example.com'), { host: '_dmarc.example.com', kind: 'domain' });
});

test('parseHost canonicaliza trucos de IPv4 para que isPublicIp los detecte', () => {
  for (const sneaky of ['127.1', '2130706433', '0x7f.0.0.1', '0177.0.0.1', '017700000001']) {
    const p = parseHost(sneaky);
    assert.ok(p === null || (p.kind === 'ipv4' && !isPublicIp(p.host)), `${sneaky} no debe pasar como público`);
  }
  assert.equal(parseHost('http://evil.com@127.0.0.1/')?.host, '127.0.0.1');
});

test('parseHost soporta IDN convirtiendo a punycode', () => {
  assert.equal(parseHost('bücher.example')?.host, 'xn--bcher-kva.example');
});

test('parseHost rechaza basura', () => {
  for (const bad of ['', '   ', 'a b.com', 'exa mple.com', '-bad.com', 'bad-.com', 'a..b', '[::1', 'x'.repeat(300), '<script>', 'a.com:abc', 'host:99999999']) {
    assert.equal(parseHost(bad), null, `${JSON.stringify(bad)} debería ser inválido`);
  }
  assert.equal(parseHost(undefined), null);
  assert.equal(parseHost(['a.com']), null);
  assert.equal(cleanHost('///'), '');
});

test('isBlockedHostname detecta nombres locales por convención', () => {
  for (const h of ['localhost', 'foo.localhost', 'router.local', 'db.internal', 'nas.lan', 'x.home.arpa']) {
    assert.equal(isBlockedHostname(h), true, h);
  }
  assert.equal(isBlockedHostname('example.com'), false);
  assert.equal(isBlockedHostname('localhost.example.com'), false);
});

test('parsePort valida rango y usa el valor por defecto', () => {
  assert.equal(parsePort(undefined, 443), 443);
  assert.equal(parsePort('8080'), 8080);
  assert.equal(parsePort('0'), null);
  assert.equal(parsePort('65536'), null);
  assert.equal(parsePort('abc'), null);
  assert.equal(parsePort('80.5'), null);
});

test('normalizeRecordType aplica lista blanca', () => {
  assert.equal(normalizeRecordType(undefined), 'A');
  assert.equal(normalizeRecordType('mx'), 'MX');
  assert.equal(normalizeRecordType('ANY'), null);
  assert.equal(normalizeRecordType('A&do=true'), null);
});

test('TtlCache.wrap deduplica llamadas concurrentes y no cachea errores', async () => {
  const cache = new TtlCache<number>(1000);
  let calls = 0;
  const fn = async () => {
    calls++;
    await new Promise((r) => setTimeout(r, 10));
    return 42;
  };
  const [a, b, c] = await Promise.all([cache.wrap('k', fn), cache.wrap('k', fn), cache.wrap('k', fn)]);
  assert.deepEqual([a, b, c], [42, 42, 42]);
  assert.equal(calls, 1);
  await cache.wrap('k', fn);
  assert.equal(calls, 1, 'segunda llamada sirve desde caché');

  await assert.rejects(cache.wrap('err', async () => { throw new Error('boom'); }));
  assert.equal(await cache.wrap('err', async () => 7), 7, 'tras un error se reintenta');
});

test('TtlCache expira entradas y respeta el máximo', async () => {
  const cache = new TtlCache<string>(20, 2);
  cache.set('a', '1');
  cache.set('b', '2');
  cache.set('c', '3');
  assert.equal(cache.get('a'), undefined, 'la más antigua se expulsa');
  assert.equal(cache.get('c'), '3');
  await new Promise((r) => setTimeout(r, 30));
  assert.equal(cache.get('c'), undefined, 'expira por TTL');
});

test('FixedWindowLimiter limita por clave y se reinicia', () => {
  const lim = new FixedWindowLimiter(1000, 3);
  const t = 1_000_000;
  assert.equal(lim.take('ip1', t).allowed, true);
  assert.equal(lim.take('ip1', t).allowed, true);
  assert.equal(lim.take('ip1', t).allowed, true);
  const blocked = lim.take('ip1', t + 10);
  assert.equal(blocked.allowed, false);
  assert.ok(blocked.retryAfterSec >= 1);
  assert.equal(lim.take('ip2', t).allowed, true, 'otra clave no se ve afectada');
  assert.equal(lim.take('ip1', t + 1500).allowed, true, 'nueva ventana');
});

test('readJsonLimited corta respuestas demasiado grandes', async () => {
  const ok = new Response(JSON.stringify({ a: 1 }));
  assert.deepEqual(await readJsonLimited(ok, 1024), { a: 1 });
  const big = new Response(JSON.stringify({ blob: 'x'.repeat(5000) }));
  await assert.rejects(readJsonLimited(big, 1024), ResponseTooLargeError);
});

test('expiryStatusFor usa umbrales consistentes', () => {
  assert.equal(expiryStatusFor(-1), 'EXPIRED');
  assert.equal(expiryStatusFor(0), 'CRITICAL');
  assert.equal(expiryStatusFor(14), 'CRITICAL');
  assert.equal(expiryStatusFor(15), 'EXPIRING_SOON');
  assert.equal(expiryStatusFor(29), 'EXPIRING_SOON');
  assert.equal(expiryStatusFor(30), 'VALID');
});

test('analyzeSecurityHeaders puntúa y detecta configuraciones débiles', () => {
  const none = analyzeSecurityHeaders({});
  assert.equal(none.securityScore, 0);
  assert.equal(none.securityGrade, 'F');
  assert.ok(none.securityAudit.every((i) => i.status === 'missing'));

  const strong = analyzeSecurityHeaders({
    'strict-transport-security': 'max-age=63072000; includeSubDomains; preload',
    'content-security-policy': "default-src 'self'; frame-ancestors 'none'",
    'x-content-type-options': 'nosniff',
    'referrer-policy': 'strict-origin-when-cross-origin',
    'permissions-policy': 'camera=()',
  });
  assert.equal(strong.securityScore, 100);
  assert.equal(strong.securityGrade, 'A+');

  const weak = analyzeSecurityHeaders({
    'strict-transport-security': 'max-age=300',
    'content-security-policy': "script-src 'self' 'unsafe-inline'",
    'x-content-type-options': 'sniff',
  });
  const byHeader = Object.fromEntries(weak.securityAudit.map((i) => [i.header, i]));
  assert.equal(byHeader['strict-transport-security'].status, 'warning');
  assert.equal(byHeader['content-security-policy'].status, 'warning');
  assert.equal(byHeader['x-content-type-options'].status, 'warning');
  assert.equal(byHeader['x-content-type-options'].score, 0, 'ya no puntúa nosniff inexistente como acierto');
});
