import test, { beforeEach } from 'node:test';
import assert from 'node:assert/strict';

// localStorage simulado (los tests corren en Node, sin navegador)
const store = new Map<string, string>();
(globalThis as any).localStorage = {
  getItem: (k: string) => (store.has(k) ? store.get(k)! : null),
  setItem: (k: string, v: string) => void store.set(k, String(v)),
  removeItem: (k: string) => void store.delete(k),
};

const { getHistory, saveHistoryItem, importHistoryFromJson, togglePinHistoryItem, clearHistory } = await import('../src/lib/history.ts');

beforeEach(() => store.clear());

test('la importación descarta herramientas desconocidas, consultas vacías o enormes y ids maliciosos', () => {
  const payload = [
    { tool: 'dns', query: 'ok.com', id: '<img src=x onerror=alert(1)>' },
    { tool: '__proto__', query: 'x' },
    { tool: 'constructor', query: 'x' },
    { tool: 'nope', query: 'x' },
    { tool: 'dns', query: '   ' },
    { tool: 'dns', query: 'a'.repeat(5000) },
    { tool: 'dns', query: 123 },
    null,
    'texto',
  ];
  const r = importHistoryFromJson(JSON.stringify(payload));
  assert.equal(r.success, true);
  assert.equal(r.count, 1);
  const [item] = getHistory();
  assert.equal(item.query, 'ok.com');
  assert.match(item.id, /^[\w.-]+$/, 'el id con HTML se sustituye por uno generado');
});

test('la importación respeta el tope de recientes (antes no había ninguno)', () => {
  const many = Array.from({ length: 400 }, (_, i) => ({ tool: 'dns', query: `d${i}.com`, timestamp: i }));
  importHistoryFromJson(JSON.stringify(many));
  assert.equal(getHistory().length, 25);
});

test('los fijados nunca se descartan por el tope', () => {
  const many = Array.from({ length: 60 }, (_, i) => ({ tool: 'ip', query: `1.1.1.${i}`, timestamp: i, isPinned: i < 40 }));
  importHistoryFromJson(JSON.stringify(many));
  const h = getHistory();
  assert.equal(h.filter((i) => i.isPinned).length, 40);
  assert.equal(h.filter((i) => !i.isPinned).length, 20);
});

test('rechaza archivos demasiado grandes y JSON inválido', () => {
  assert.equal(importHistoryFromJson('x'.repeat(1_100_000)).success, false);
  assert.equal(importHistoryFromJson('{no es json').success, false);
  assert.equal(importHistoryFromJson('{"a":1}').success, false);
});

test('localStorage manipulado no rompe getHistory', () => {
  store.set('netcheck_query_history_v2', JSON.stringify([{ tool: 'dns', query: 'ok.com' }, { tool: 5 }, 'x', { query: 'sin tool' }]));
  const h = getHistory();
  assert.equal(h.length, 1);
  store.set('netcheck_query_history_v2', '{{{{');
  assert.deepEqual(getHistory(), []);
});

test('guardar deduplica sin distinguir mayúsculas y conserva el estado de fijado', () => {
  saveHistoryItem('dns', 'Example.com', 'A');
  const id = getHistory()[0].id;
  togglePinHistoryItem(id);
  saveHistoryItem('dns', 'example.COM', 'A');
  const h = getHistory();
  assert.equal(h.length, 1);
  assert.equal(h[0].isPinned, true);
  assert.equal(h[0].id, id);
  saveHistoryItem('dns', 'example.com', 'MX'); // otro extra = otra entrada
  assert.equal(getHistory().length, 2);
  assert.equal(clearHistory(true).length, 1, 'borrar no fijados conserva el fijado');
});
