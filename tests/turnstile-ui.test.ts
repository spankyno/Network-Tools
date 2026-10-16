import test, { mock } from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';

// Entorno de navegador simulado ANTES de importar los módulos del frontend
const dom = new JSDOM('<!doctype html><html><body></body></html>', { url: 'https://app.test/' });
Object.assign(globalThis, { window: dom.window, document: dom.window.document });
const w = dom.window as any;

const { fetchSsl, ApiError } = await import('../src/lib/api.ts');

interface Widget { opts: any; id: string }
let widgets: Widget[] = [];
let resets = 0;
w.turnstile = {
  render: (_el: HTMLElement, opts: any) => { const id = `w${widgets.length + 1}`; widgets.push({ opts, id }); return id; },
  reset: () => { resets++; },
  remove: () => undefined,
};

const calls: string[] = [];
let passed = false;
let verifyResult: () => Response = () => Response.json({ ok: true });
let sslOverride: (() => Response) | null = null;

mock.method(globalThis, 'fetch', async (input: any, init?: RequestInit) => {
  const url = String(typeof input === 'string' ? input : input.url);
  calls.push(`${init?.method ?? 'GET'} ${url}`);
  if (url === '/api/config') return Response.json({ turnstileSiteKey: 'site-key' });
  if (url === '/api/turnstile/verify') {
    const r = verifyResult();
    if (r.ok) passed = true;
    return r;
  }
  if (url.startsWith('/api/ssl')) {
    if (sslOverride) return sslOverride();
    return passed ? Response.json({ host: 'a.com', ok: true }) : Response.json({ error: 'Verificación anti-bots requerida.', code: 'CAPTCHA_REQUIRED' }, { status: 403 });
  }
  return new Response('{}', { status: 404 });
});

const reset = () => { calls.length = 0; widgets = []; resets = 0; passed = false; verifyResult = () => Response.json({ ok: true }); sslOverride = null; document.body.innerHTML = ''; };
const tick = (ms = 20) => new Promise((r) => setTimeout(r, ms));
const dialogs = () => document.querySelectorAll('[role="dialog"]');
const solve = async () => { await widgets[widgets.length - 1].opts.callback('tokentokentoken'); await tick(); };

test('403 CAPTCHA_REQUIRED → muestra el modal, se resuelve una vez y la petición se reintenta sola', async () => {
  reset();
  const p = fetchSsl('a.com') as Promise<any>;
  await tick(50);
  assert.equal(dialogs().length, 1, 'aparece el modal');
  assert.equal(widgets[0].opts.sitekey, 'site-key');
  assert.equal(document.querySelector('[role="dialog"]')!.getAttribute('aria-modal'), 'true');
  await solve();
  const data = await p;
  assert.equal(data.ok, true, 'el llamador recibe el resultado final sin enterarse del reto');
  assert.equal(dialogs().length, 0, 'el modal se cierra');
  assert.deepEqual(calls.filter((c) => c.includes('/api/ssl')).length, 2, 'ssl se pidió dos veces (fallo + reintento)');
  assert.equal(calls.filter((c) => c.includes('verify')).length, 1);
});

test('con el pase ya concedido no se vuelve a mostrar el reto', async () => {
  // `passed` sigue true del test anterior: simula la cookie vigente
  calls.length = 0;
  const data: any = await fetchSsl('b.com');
  assert.equal(data.ok, true);
  assert.equal(dialogs().length, 0);
  assert.equal(calls.length, 1);
});

test('peticiones concurrentes comparten UN solo modal', async () => {
  reset();
  const ps = [fetchSsl('a.com'), fetchSsl('b.com'), fetchSsl('c.com')] as Promise<any>[];
  await tick(60);
  assert.equal(dialogs().length, 1, 'un modal, no tres');
  await solve();
  const all = await Promise.all(ps);
  assert.ok(all.every((r) => r.ok));
  assert.equal(calls.filter((c) => c.includes('verify')).length, 1);
});

test('Cancelar → ApiError CAPTCHA_CANCELLED y el modal se retira', async () => {
  reset();
  const p = fetchSsl('a.com') as Promise<any>;
  const assertion = assert.rejects(p, (e: any) => e instanceof ApiError && e.code === 'CAPTCHA_CANCELLED' && e.status === 403);
  await tick(50);
  (document.querySelector('[data-cancel]') as HTMLButtonElement).click();
  await assertion;
  assert.equal(dialogs().length, 0);
});

test('Escape también cancela y devuelve el foco', async () => {
  reset();
  const btn = document.createElement('button');
  document.body.appendChild(btn);
  btn.focus();
  const p = fetchSsl('a.com') as Promise<any>;
  const assertion = assert.rejects(p, (e: any) => e.code === 'CAPTCHA_CANCELLED');
  await tick(50);
  document.dispatchEvent(new dom.window.KeyboardEvent('keydown', { key: 'Escape' }));
  await assertion;
  assert.equal(document.activeElement, btn, 'el foco vuelve a donde estaba');
});

test('verificación fallida: muestra el error (como texto, no HTML), reinicia el widget y permite reintentar', async () => {
  reset();
  verifyResult = () => Response.json({ error: '<img src=x onerror=alert(1)> falló', code: 'CAPTCHA_FAILED' }, { status: 403 });
  const p = fetchSsl('a.com') as Promise<any>;
  await tick(50);
  await solve();
  assert.equal(dialogs().length, 1, 'el modal sigue abierto');
  const err = document.querySelector('[data-error]') as HTMLElement;
  assert.ok(!err.classList.contains('hidden'));
  assert.match(err.textContent!, /falló/);
  assert.equal(err.querySelector('img'), null, 'el mensaje del servidor no se interpreta como HTML');
  assert.equal(resets, 1, 'widget reiniciado');
  verifyResult = () => Response.json({ ok: true });
  await solve();
  assert.equal((await p).ok, true);
});

test('no entra en bucle: si tras el reto sigue el 403, se informa del error', async () => {
  reset();
  sslOverride = () => Response.json({ error: 'Verificación anti-bots requerida.', code: 'CAPTCHA_REQUIRED' }, { status: 403 });
  const p = fetchSsl('a.com') as Promise<any>;
  const assertion = assert.rejects(p, (e: any) => e instanceof ApiError && e.status === 403);
  await tick(50);
  await solve();
  await assertion;
  assert.equal(calls.filter((c) => c.includes('/api/ssl')).length, 2, 'solo UN reintento');
  assert.equal(dialogs().length, 0);
});

test('un 4xx normal (p. ej. destino no permitido) no dispara el reto', async () => {
  reset();
  sslOverride = () => Response.json({ error: 'Solo destinos públicos' }, { status: 400 });
  await assert.rejects(fetchSsl('127.0.0.1') as Promise<any>, (e: any) => e.status === 400 && e.message === 'Solo destinos públicos');
  assert.equal(dialogs().length, 0);
  assert.equal(calls.filter((c) => c.includes('config')).length, 0, 'ni siquiera se consulta la configuración');
});

test('servidor exige reto pero no publica clave → error claro, sin modal', async () => {
  // Instancia nueva del módulo (query distinta) para no heredar la clave cacheada por los tests anteriores
  const spec = '../src/lib/turnstile.ts?sin-clave';
  const { ensureHumanPass } = (await import(spec)) as typeof import('../src/lib/turnstile.ts');
  mock.method(globalThis, 'fetch', async () => Response.json({ turnstileSiteKey: null }));
  await assert.rejects(ensureHumanPass(''), /NO_TURNSTILE/);
  assert.equal(dialogs().length, 0);
});
