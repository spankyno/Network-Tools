import { HistoryItem, ToolId } from '../types/network';

const STORAGE_KEY = 'netcheck_query_history_v2';
const MAX_UNPINNED_ITEMS = 25;
const MAX_TOTAL_ITEMS = 200; // fijados + recientes: tope duro para no llenar localStorage
const MAX_IMPORT_CHARS = 1_000_000;
const MAX_QUERY_LEN = 2048;
const MAX_EXTRA_LEN = 64;

// Record<ToolId, true> obliga a actualizar esta lista cuando se añada una herramienta nueva
const TOOL_IDS: Record<ToolId, true> = {
  dns: true, propagation: true, dnssec: true, ssl: true, ctlogs: true, headers: true,
  httpversions: true, ip: true, traceroute: true, ports: true, whois: true, speedtest: true,
};

const newId = () => `${Date.now()}-${Math.random().toString(36).substring(2, 7)}`;

/** Valida un elemento de procedencia no fiable (localStorage manipulado o archivo importado). */
function sanitizeItem(raw: unknown): HistoryItem | null {
  if (!raw || typeof raw !== 'object') return null;
  const r = raw as Record<string, unknown>;
  if (typeof r.tool !== 'string' || !Object.prototype.hasOwnProperty.call(TOOL_IDS, r.tool)) return null;
  if (typeof r.query !== 'string') return null;
  const query = r.query.trim();
  if (!query || query.length > MAX_QUERY_LEN) return null;
  const extra = typeof r.extra === 'string' && r.extra.length <= MAX_EXTRA_LEN ? r.extra : undefined;
  return {
    id: typeof r.id === 'string' && /^[\w.-]{1,64}$/.test(r.id) ? r.id : newId(),
    tool: r.tool as ToolId,
    query,
    extra: extra || undefined,
    timestamp: typeof r.timestamp === 'number' && Number.isFinite(r.timestamp) ? r.timestamp : Date.now(),
    isPinned: Boolean(r.isPinned),
  };
}

const keyOf = (i: HistoryItem) => `${i.tool}\u0000${i.query.toLowerCase()}\u0000${i.extra ?? ''}`;

/** Deduplica (gana el primero), ordena (fijados primero, luego recientes) y aplica los topes. */
function normalize(items: HistoryItem[]): HistoryItem[] {
  const seen = new Set<string>();
  const unique: HistoryItem[] = [];
  for (const it of items) {
    const k = keyOf(it);
    if (!seen.has(k)) {
      seen.add(k);
      unique.push(it);
    }
  }
  const sorted = unique.sort((a, b) => Number(!!b.isPinned) - Number(!!a.isPinned) || b.timestamp - a.timestamp);
  const pinned = sorted.filter((i) => i.isPinned);
  const unpinned = sorted.filter((i) => !i.isPinned).slice(0, MAX_UNPINNED_ITEMS);
  return [...pinned, ...unpinned].slice(0, MAX_TOTAL_ITEMS);
}

function persist(items: HistoryItem[]): HistoryItem[] {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(items));
  } catch {
    // Almacenamiento lleno o bloqueado (modo privado): el historial sigue funcionando en memoria durante la sesión
  }
  return items;
}

export function getHistory(): HistoryItem[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) {
      // Intentar migrar de v1 si existiera
      const oldRaw = localStorage.getItem('netcheck_query_history_v1');
      if (oldRaw) {
        const old = JSON.parse(oldRaw);
        if (Array.isArray(old)) {
          const migrated = normalize(old.map((i) => sanitizeItem({ ...i, isPinned: false })).filter((i): i is HistoryItem => i !== null));
          return persist(migrated);
        }
      }
      return [];
    }
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed.map(sanitizeItem).filter((i): i is HistoryItem => i !== null) : [];
  } catch {
    return [];
  }
}

export function saveHistoryItem(tool: ToolId, query: string, extra?: string): HistoryItem[] {
  const cleanQuery = query.trim();
  if (!cleanQuery || cleanQuery.length > MAX_QUERY_LEN) return getHistory();

  const current = getHistory();
  const probe = { tool, query: cleanQuery, extra } as HistoryItem;
  const existing = current.find((i) => keyOf(i) === keyOf(probe));

  const newItem: HistoryItem = {
    id: existing ? existing.id : newId(),
    tool,
    query: cleanQuery,
    extra,
    timestamp: Date.now(),
    isPinned: existing?.isPinned ?? false,
  };
  return persist(normalize([newItem, ...current]));
}

export function togglePinHistoryItem(id: string): HistoryItem[] {
  const updated = getHistory().map((item) => (item.id === id ? { ...item, isPinned: !item.isPinned } : item));
  return persist(normalize(updated));
}

export function removeHistoryItem(id: string): HistoryItem[] {
  return persist(getHistory().filter((item) => item.id !== id));
}

export function clearHistory(onlyUnpinned: boolean = true): HistoryItem[] {
  return persist(onlyUnpinned ? getHistory().filter((i) => i.isPinned) : []);
}

export function exportHistoryToJson(): void {
  try {
    const blob = new Blob([JSON.stringify(getHistory(), null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `netcheck-historial-${new Date().toISOString().slice(0, 10)}.json`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  } catch (err) {
    console.error('Error al exportar historial:', err);
  }
}

export function importHistoryFromJson(jsonString: string): { success: boolean; count: number; error?: string } {
  if (jsonString.length > MAX_IMPORT_CHARS) {
    return { success: false, count: 0, error: 'El archivo es demasiado grande (máximo 1 MB).' };
  }
  try {
    const parsed = JSON.parse(jsonString);
    if (!Array.isArray(parsed)) {
      return { success: false, count: 0, error: 'El archivo JSON no contiene una lista válida de elementos.' };
    }
    const valid = parsed
      .slice(0, 1000)
      .map(sanitizeItem)
      .filter((i): i is HistoryItem => i !== null);
    if (valid.length === 0) {
      return { success: false, count: 0, error: 'No se encontraron consultas válidas para importar.' };
    }
    // Antes la importación no aplicaba ningún tope: un archivo grande desbordaba el historial y localStorage
    const merged = normalize([...valid, ...getHistory()]);
    persist(merged);
    return { success: true, count: valid.length };
  } catch (err: any) {
    return { success: false, count: 0, error: err?.message || 'Formato JSON inválido.' };
  }
}
