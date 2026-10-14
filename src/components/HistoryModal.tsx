import React, { useState, useRef } from 'react';
import { HistoryItem, ToolId } from '../types/network';
import {
  X,
  Trash2,
  ArrowUpRight,
  Clock,
  Search,
  Star,
  Download,
  Upload,
  Globe,
  Radio,
  Shield,
  ShieldCheck,
  FileSearch,
  Terminal,
  Zap,
  MapPin,
  Route,
  Server,
  FileText,
} from 'lucide-react';
import { clearHistory, removeHistoryItem, togglePinHistoryItem, exportHistoryToJson, importHistoryFromJson } from '../lib/history';
import { useToast } from './Toast';
import { getToolDefinition } from '../tools/registry';

interface HistoryModalProps {
  isOpen: boolean;
  onClose: () => void;
  items: HistoryItem[];
  onSelectQuery: (item: HistoryItem) => void;
  onRefreshHistory: () => void;
}

const TOOL_ICONS: Record<ToolId, React.ReactNode> = {
  dns: <Globe className="w-3.5 h-3.5 text-cyan-400" />,
  propagation: <Radio className="w-3.5 h-3.5 text-blue-400" />,
  dnssec: <ShieldCheck className="w-3.5 h-3.5 text-emerald-400" />,
  ssl: <Shield className="w-3.5 h-3.5 text-emerald-400" />,
  ctlogs: <FileSearch className="w-3.5 h-3.5 text-cyan-400" />,
  headers: <Terminal className="w-3.5 h-3.5 text-amber-400" />,
  httpversions: <Zap className="w-3.5 h-3.5 text-amber-400" />,
  ip: <MapPin className="w-3.5 h-3.5 text-violet-400" />,
  traceroute: <Route className="w-3.5 h-3.5 text-emerald-400" />,
  ports: <Server className="w-3.5 h-3.5 text-rose-400" />,
  whois: <FileText className="w-3.5 h-3.5 text-indigo-400" />,
};

function formatRelativeTime(timestamp: number): string {
  const diff = Date.now() - timestamp;
  const secs = Math.floor(diff / 1000);
  if (secs < 60) return `hace ${secs}s`;
  const mins = Math.floor(secs / 60);
  if (mins < 60) return `hace ${mins}m`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `hace ${hours}h`;
  const days = Math.floor(hours / 24);
  return `hace ${days}d`;
}

export const HistoryModal: React.FC<HistoryModalProps> = ({
  isOpen,
  onClose,
  items,
  onSelectQuery,
  onRefreshHistory,
}) => {
  const [filterMode, setFilterMode] = useState<'all' | 'pinned'>('all');
  const [searchTerm, setSearchTerm] = useState('');
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  const { toast } = useToast();

  if (!isOpen) return null;

  const handleTogglePin = (e: React.MouseEvent, id: string) => {
    e.stopPropagation();
    togglePinHistoryItem(id);
    onRefreshHistory();
  };

  const handleDeleteItem = (e: React.MouseEvent, id: string) => {
    e.stopPropagation();
    removeHistoryItem(id);
    onRefreshHistory();
  };

  const handleClearHistory = () => {
    clearHistory(true); // borra solo no fijados
    onRefreshHistory();
    toast('Consultas no fijadas eliminadas', 'info');
  };

  const handleExport = () => {
    exportHistoryToJson();
    toast('Historial exportado a archivo JSON', 'success');
  };

  const handleImportClick = () => {
    fileInputRef.current?.click();
  };

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = (event) => {
      const content = event.target?.result as string;
      const res = importHistoryFromJson(content);
      if (res.success) {
        onRefreshHistory();
        toast(`Se importaron ${res.count} consultas correctamente`, 'success');
      } else {
        toast(res.error || 'Error al importar archivo', 'error');
      }
    };
    reader.readAsText(file);
    e.target.value = '';
  };

  const filteredItems = items.filter((item) => {
    if (filterMode === 'pinned' && !item.isPinned) return false;
    if (searchTerm.trim()) {
      const q = searchTerm.toLowerCase();
      return item.query.toLowerCase().includes(q) || item.tool.toLowerCase().includes(q);
    }
    return true;
  });

  const pinnedCount = items.filter((i) => i.isPinned).length;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm animate-in fade-in duration-150">
      <div className="w-full max-w-xl rounded-xl border border-slate-800 bg-slate-900 shadow-2xl overflow-hidden flex flex-col max-h-[88vh]">
        {/* Encabezado */}
        <div className="flex items-center justify-between px-5 py-4 border-b border-slate-800 bg-slate-950/40">
          <div className="flex items-center gap-2">
            <Clock className="w-4 h-4 text-cyan-400" />
            <h2 className="text-base font-semibold text-slate-100">Historial y Favoritos</h2>
            <span className="text-xs text-slate-500 font-mono">({items.length})</span>
          </div>

          <div className="flex items-center gap-2">
            <button
              onClick={handleExport}
              className="flex items-center gap-1 text-xs text-slate-300 hover:text-white px-2 py-1 rounded bg-slate-800/80 hover:bg-slate-700 transition-colors"
              title="Descargar archivo JSON"
            >
              <Download className="w-3 h-3 text-cyan-400" />
              <span className="hidden sm:inline">Exportar</span>
            </button>
            <button
              onClick={handleImportClick}
              className="flex items-center gap-1 text-xs text-slate-300 hover:text-white px-2 py-1 rounded bg-slate-800/80 hover:bg-slate-700 transition-colors"
              title="Importar archivo JSON"
            >
              <Upload className="w-3 h-3 text-cyan-400" />
              <span className="hidden sm:inline">Importar</span>
            </button>
            <input
              type="file"
              ref={fileInputRef}
              onChange={handleFileChange}
              accept=".json"
              className="hidden"
            />
            <button
              onClick={onClose}
              className="text-slate-400 hover:text-slate-200 transition-colors p-1 rounded ml-1"
              aria-label="Cerrar modal"
            >
              <X className="w-4 h-4" />
            </button>
          </div>
        </div>

        {/* Barra de Filtros y Búsqueda */}
        <div className="px-5 py-3 border-b border-slate-800/80 bg-slate-950/20 flex flex-col sm:flex-row items-stretch sm:items-center justify-between gap-3">
          <div className="flex items-center gap-1 p-1 bg-slate-950 rounded-lg border border-slate-800">
            <button
              onClick={() => setFilterMode('all')}
              className={`px-3 py-1 text-xs font-medium rounded-md transition-colors ${
                filterMode === 'all' ? 'bg-slate-800 text-white shadow-sm' : 'text-slate-400 hover:text-slate-200'
              }`}
            >
              Todos ({items.length})
            </button>
            <button
              onClick={() => setFilterMode('pinned')}
              className={`flex items-center gap-1 px-3 py-1 text-xs font-medium rounded-md transition-colors ${
                filterMode === 'pinned' ? 'bg-slate-800 text-amber-300 shadow-sm' : 'text-slate-400 hover:text-slate-200'
              }`}
            >
              <Star className="w-3 h-3 text-amber-400 fill-amber-400" />
              <span>Favoritos ({pinnedCount})</span>
            </button>
          </div>

          <div className="flex items-center gap-2">
            <input
              type="text"
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              placeholder="Buscar en historial..."
              className="w-full sm:w-48 px-3 py-1.5 rounded-lg border border-slate-700/80 bg-slate-950 text-xs font-mono text-slate-200 placeholder:text-slate-500 focus:outline-none focus:ring-1 focus:ring-cyan-500"
            />
            {items.length > pinnedCount && (
              <button
                onClick={handleClearHistory}
                className="text-xs text-slate-400 hover:text-red-400 p-1.5 rounded hover:bg-slate-800 transition-colors whitespace-nowrap"
                title="Limpiar consultas no fijadas"
              >
                Limpiar no fijadas
              </button>
            )}
          </div>
        </div>

        {/* Lista de Consultas */}
        <div className="p-3 overflow-y-auto divide-y divide-slate-800/60 flex-1">
          {filteredItems.length === 0 ? (
            <div className="py-12 text-center text-slate-400 text-sm">
              <Clock className="w-8 h-8 mx-auto mb-2 text-slate-600" />
              <p>
                {filterMode === 'pinned'
                  ? 'No hay consultas fijadas en Favoritos.'
                  : 'No hay consultas en el historial.'}
              </p>
              <p className="text-xs text-slate-500 mt-1">
                {filterMode === 'pinned'
                  ? 'Pulse el icono de estrella ⭐ en cualquier consulta para fijarla permanentemente.'
                  : 'Las consultas que realice se guardarán automáticamente aquí.'}
              </p>
            </div>
          ) : (
            filteredItems.map((item) => {
              const toolDef = getToolDefinition(item.tool);
              return (
                <div
                  key={item.id}
                  onClick={() => {
                    onSelectQuery(item);
                    onClose();
                  }}
                  className="group flex items-center justify-between p-3 rounded-lg hover:bg-slate-800/60 transition-colors cursor-pointer text-left"
                >
                  <div className="flex items-center gap-3 min-w-0">
                    <button
                      onClick={(e) => handleTogglePin(e, item.id)}
                      className="p-1 rounded hover:bg-slate-800 text-slate-500 hover:text-amber-400 transition-colors shrink-0"
                      title={item.isPinned ? 'Desfijar de favoritos' : 'Fijar en favoritos permanentemente'}
                    >
                      <Star
                        className={`w-4 h-4 ${
                          item.isPinned ? 'text-amber-400 fill-amber-400' : 'text-slate-600'
                        }`}
                      />
                    </button>

                    <div className="w-7 h-7 rounded bg-slate-800 border border-slate-700/60 flex items-center justify-center shrink-0">
                      {TOOL_ICONS[item.tool] || <Search className="w-3.5 h-3.5 text-slate-400" />}
                    </div>

                    <div className="min-w-0">
                      <div className="flex items-center gap-2">
                        <span className="font-mono text-sm font-medium text-slate-200 truncate group-hover:text-cyan-400 transition-colors">
                          {item.query}
                        </span>
                        {item.extra && (
                          <span className="text-[10px] font-mono px-1.5 py-0.2 rounded bg-slate-800 border border-slate-700 text-slate-400 uppercase">
                            {item.extra}
                          </span>
                        )}
                      </div>
                      <div className="text-xs text-slate-500 flex items-center gap-2 mt-0.5">
                        <span>{toolDef.name}</span>
                        <span>·</span>
                        <span className="tabular-nums">{formatRelativeTime(item.timestamp)}</span>
                      </div>
                    </div>
                  </div>

                  <div className="flex items-center gap-1 shrink-0 opacity-0 group-hover:opacity-100 transition-opacity">
                    <button
                      onClick={(e) => handleDeleteItem(e, item.id)}
                      className="p-1.5 text-slate-400 hover:text-red-400 rounded hover:bg-slate-700/50 transition-colors"
                      title="Eliminar consulta"
                    >
                      <Trash2 className="w-3.5 h-3.5" />
                    </button>
                    <div className="p-1.5 text-slate-400 group-hover:text-cyan-400 transition-colors">
                      <ArrowUpRight className="w-3.5 h-3.5" />
                    </div>
                  </div>
                </div>
              );
            })
          )}
        </div>
      </div>
    </div>
  );
};
