import { HistoryItem, ToolId } from '../types/network';

const STORAGE_KEY = 'netcheck_query_history_v2';
const MAX_UNPINNED_ITEMS = 25;

export function getHistory(): HistoryItem[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) {
      // Intentar migrar de v1 si existiera
      const oldRaw = localStorage.getItem('netcheck_query_history_v1');
      if (oldRaw) {
        const oldParsed = JSON.parse(oldRaw);
        if (Array.isArray(oldParsed)) {
          const migrated = oldParsed.map((item) => ({ ...item, isPinned: false }));
          localStorage.setItem(STORAGE_KEY, JSON.stringify(migrated));
          return migrated;
        }
      }
      return [];
    }
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

export function saveHistoryItem(tool: ToolId, query: string, extra?: string): HistoryItem[] {
  try {
    const cleanQuery = query.trim();
    if (!cleanQuery) return getHistory();

    const current = getHistory();
    // Buscar si ya existía para mantener su estado de fijado
    const existing = current.find(
      (item) => item.tool === tool && item.query.toLowerCase() === cleanQuery.toLowerCase() && item.extra === extra
    );

    const isPinned = existing?.isPinned ?? false;

    // Remover duplicados existentes
    const rest = current.filter(
      (item) => !(item.tool === tool && item.query.toLowerCase() === cleanQuery.toLowerCase() && item.extra === extra)
    );

    const newItem: HistoryItem = {
      id: existing ? existing.id : `${Date.now()}-${Math.random().toString(36).substring(2, 7)}`,
      tool,
      query: cleanQuery,
      extra,
      timestamp: Date.now(),
      isPinned,
    };

    // Separar fijados y no fijados para no borrar nunca los fijados
    const allPinned = [newItem, ...rest].filter((i) => i.isPinned);
    const unpinned = [newItem, ...rest].filter((i) => !i.isPinned).slice(0, MAX_UNPINNED_ITEMS);

    const merged = Array.from(new Set([...allPinned, ...unpinned])).sort((a, b) => {
      // Fijados primero, luego por fecha reciente
      if (a.isPinned && !b.isPinned) return -1;
      if (!a.isPinned && b.isPinned) return 1;
      return b.timestamp - a.timestamp;
    });

    localStorage.setItem(STORAGE_KEY, JSON.stringify(merged));
    return merged;
  } catch {
    return [];
  }
}

export function togglePinHistoryItem(id: string): HistoryItem[] {
  try {
    const current = getHistory();
    const updated = current.map((item) => {
      if (item.id === id) {
        return { ...item, isPinned: !item.isPinned };
      }
      return item;
    });
    localStorage.setItem(STORAGE_KEY, JSON.stringify(updated));
    return updated;
  } catch {
    return getHistory();
  }
}

export function removeHistoryItem(id: string): HistoryItem[] {
  try {
    const current = getHistory();
    const updated = current.filter((item) => item.id !== id);
    localStorage.setItem(STORAGE_KEY, JSON.stringify(updated));
    return updated;
  } catch {
    return [];
  }
}

export function clearHistory(onlyUnpinned: boolean = true): HistoryItem[] {
  try {
    const current = getHistory();
    const updated = onlyUnpinned ? current.filter((i) => i.isPinned) : [];
    localStorage.setItem(STORAGE_KEY, JSON.stringify(updated));
    return updated;
  } catch {
    return [];
  }
}

export function exportHistoryToJson(): void {
  try {
    const items = getHistory();
    const blob = new Blob([JSON.stringify(items, null, 2)], { type: 'application/json' });
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
  try {
    const parsed = JSON.parse(jsonString);
    if (!Array.isArray(parsed)) {
      return { success: false, count: 0, error: 'El archivo JSON no contiene una lista válida de elementos.' };
    }

    // Validar esquema mínimo
    const validItems: HistoryItem[] = [];
    for (const item of parsed) {
      if (item && typeof item.query === 'string' && typeof item.tool === 'string') {
        validItems.push({
          id: item.id || `${Date.now()}-${Math.random().toString(36).substring(2, 7)}`,
          tool: item.tool as ToolId,
          query: item.query,
          extra: item.extra || undefined,
          timestamp: typeof item.timestamp === 'number' ? item.timestamp : Date.now(),
          isPinned: Boolean(item.isPinned),
        });
      }
    }

    if (validItems.length === 0) {
      return { success: false, count: 0, error: 'No se encontraron consultas válidas para importar.' };
    }

    const current = getHistory();
    // Combinar evitando duplicados exactos
    const combined = [...validItems, ...current];
    const seen = new Set<string>();
    const unique: HistoryItem[] = [];

    for (const it of combined) {
      const key = `${it.tool}-${it.query.toLowerCase()}-${it.extra || ''}`;
      if (!seen.has(key)) {
        seen.add(key);
        unique.push(it);
      }
    }

    localStorage.setItem(STORAGE_KEY, JSON.stringify(unique));
    return { success: true, count: validItems.length };
  } catch (err: any) {
    return { success: false, count: 0, error: err.message || 'Formato JSON inválido.' };
  }
}
