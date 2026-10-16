import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn, spawnSync, type ChildProcess } from 'node:child_process';
import { FallbackRateStore, MemoryRateStore, takeFrom, type RateStore } from '../shared/rate-limit.ts';
import { RedisRateStore } from '../server/rate-store.ts';

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

test('MemoryRateStore: ventana fija, coste y reinicio', async () => {
  const s = new MemoryRateStore();
  assert.equal((await s.hit('a', 100)).count, 1);
  assert.equal((await s.hit('a', 100, 4)).count, 5);
  assert.equal((await s.hit('b', 100)).count, 1, 'claves independientes');
  await sleep(120);
  assert.equal((await s.hit('a', 100)).count, 1, 'nueva ventana');
});

test('MemoryRateStore: modo strict no contabiliza lo rechazado', async () => {
  const s = new MemoryRateStore();
  assert.deepEqual((await s.hit('q', 1000, 60, { max: 100, strict: true })).applied, true);
  const denied = await s.hit('q', 1000, 60, { max: 100, strict: true });
  assert.equal(denied.applied, false);
  assert.equal(denied.count, 60, 'el rechazo no gasta presupuesto');
  assert.equal((await s.hit('q', 1000, 40, { max: 100, strict: true })).applied, true, 'lo que sí cabe, cabe');
});

test('takeFrom aplica el máximo y calcula Retry-After', async () => {
  const s = new MemoryRateStore();
  for (let i = 0; i < 3; i++) assert.equal((await takeFrom(s, 'k', 5000, 3)).allowed, true);
  const d = await takeFrom(s, 'k', 5000, 3);
  assert.equal(d.allowed, false);
  assert.ok(d.retryAfterSec >= 1 && d.retryAfterSec <= 5);
});

test('FallbackRateStore degrada a memoria cuando el almacén externo falla (y avisa una sola vez)', async () => {
  let errors = 0;
  const broken: RateStore = { hit: async () => { throw new Error('ECONNREFUSED'); } };
  const s = new FallbackRateStore(broken, new MemoryRateStore(), () => errors++);
  for (let i = 0; i < 5; i++) await s.hit('k', 1000);
  assert.equal((await s.hit('k', 1000)).count, 6, 'sigue limitando en local');
  assert.equal(errors, 1, 'no inunda los logs');
});

// ---- Redis real (se omite si no hay redis-server instalado) ------------------------------------
const hasRedis = spawnSync('redis-server', ['--version']).status === 0;
const PORT = 6391;

test('RedisRateStore contra un Redis real', { skip: !hasRedis && 'redis-server no instalado' }, async (t) => {
  const proc: ChildProcess = spawn('redis-server', ['--port', String(PORT), '--save', '', '--appendonly', 'no'], { stdio: 'ignore' });
  const { default: Redis } = await import('ioredis');
  const client = new Redis({ port: PORT, lazyConnect: true, maxRetriesPerRequest: 1, enableOfflineQueue: false, commandTimeout: 1000 });
  client.on('error', () => undefined);
  t.after(async () => {
    await client.quit().catch(() => undefined);
    proc.kill();
  });
  for (let i = 0; i < 50; i++) {
    try { await client.connect(); break; } catch { await sleep(100); }
  }
  const store = new RedisRateStore(client as any, 'test:');

  await t.test('cuenta y reinicia la ventana', async () => {
    assert.equal((await store.hit('w', 300)).count, 1);
    const r = await store.hit('w', 300);
    assert.equal(r.count, 2);
    assert.ok(r.resetMs > 0 && r.resetMs <= 300);
    await sleep(350);
    assert.equal((await store.hit('w', 300)).count, 1);
  });

  await t.test('es atómico: 200 peticiones concurrentes suman exactamente 200', async () => {
    await Promise.all(Array.from({ length: 200 }, () => store.hit('conc', 5000)));
    assert.equal((await store.hit('conc', 5000)).count, 201);
  });

  await t.test('dos "instancias" comparten contador', async () => {
    const other = new RedisRateStore(client as any, 'test:');
    await store.hit('shared', 5000);
    await other.hit('shared', 5000);
    assert.equal((await store.hit('shared', 5000)).count, 3);
  });

  await t.test('strict: rechaza sin gastar presupuesto', async () => {
    assert.equal((await store.hit('bw', 5000, 600, { max: 1000, strict: true })).applied, true);
    const d = await store.hit('bw', 5000, 600, { max: 1000, strict: true });
    assert.equal(d.applied, false);
    assert.equal(d.count, 600);
    assert.equal((await store.hit('bw', 5000, 400, { max: 1000, strict: true })).applied, true);
  });

  await t.test('autorreparación: una clave sin TTL recibe uno', async () => {
    await client.set('test:zombie', '5'); // sin expiración: bloquearía a la IP para siempre
    assert.equal(await client.pttl('test:zombie'), -1);
    const r = await store.hit('zombie', 2000);
    assert.equal(r.count, 6);
    assert.ok((await client.pttl('test:zombie')) > 0, 'ya expira');
  });

  await t.test('FallbackRateStore + Redis caído → sigue funcionando en local', async () => {
    const dead = new Redis({ port: 6399, lazyConnect: true, maxRetriesPerRequest: 0, enableOfflineQueue: false, commandTimeout: 200 });
    dead.on('error', () => undefined);
    const s = new FallbackRateStore(new RedisRateStore(dead as any), new MemoryRateStore(), () => undefined);
    assert.equal((await s.hit('x', 1000)).count, 1);
    assert.equal((await s.hit('x', 1000)).count, 2);
    dead.disconnect();
  });
});
