import React, { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { fetchPortCheck } from '../../lib/api';
import { PortCheckResponse, ToolId } from '../../types/network';
import { saveHistoryItem } from '../../lib/history';
import { useToast } from '../Toast';
import { Server, Search, RefreshCw, Copy, Check, CheckCircle2, XCircle, Clock } from 'lucide-react';

const EXAMPLES = ['github.com', 'cloudflare.com', 'google.com'];

interface PortCheckerToolProps {
  initialQuery?: string;
  onRunQuery?: (tool: ToolId, query: string, extra?: string) => void;
}

export const PortCheckerTool: React.FC<PortCheckerToolProps> = ({
  initialQuery = 'github.com',
  onRunQuery,
}) => {
  const [host, setHost] = useState(initialQuery);
  const [customPort, setCustomPort] = useState('');
  const [activeQuery, setActiveQuery] = useState<{ host: string; port?: number }>({ host: initialQuery });
  const [statusFilter, setStatusFilter] = useState<'ALL' | 'OPEN' | 'CLOSED' | 'FILTERED'>('ALL');
  const [copied, setCopied] = useState(false);

  const { toast } = useToast();

  const { data, isLoading, isError, error, refetch, isFetching } = useQuery<PortCheckResponse>({
    queryKey: ['port-check', activeQuery.host, activeQuery.port],
    queryFn: async () => {
      if (!activeQuery.host) throw new Error('El host es obligatorio');
      const res = await fetchPortCheck(activeQuery.host, activeQuery.port);
      saveHistoryItem('ports', activeQuery.host, activeQuery.port ? String(activeQuery.port) : 'Puertos Comunes');
      if (onRunQuery) onRunQuery('ports', activeQuery.host, activeQuery.port ? String(activeQuery.port) : 'Puertos Comunes');
      return res;
    },
    enabled: Boolean(activeQuery.host),
    staleTime: 60000,
  });

  const handleSearch = (e?: React.FormEvent) => {
    if (e) e.preventDefault();
    const clean = host.trim().toLowerCase().replace(/^https?:\/\//i, '').replace(/\/.*$/, '').replace(/:\d+$/, '');
    if (!clean) return;
    const p = customPort.trim() ? parseInt(customPort.trim(), 10) : undefined;
    setActiveQuery({ host: clean, port: p });
  };

  const copyResults = () => {
    if (!data) return;
    const txt = data.results
      .map((r) => `Puerto ${r.port} (${r.service}): ${r.status} [${r.durationMs}ms]`)
      .join('\n');
    navigator.clipboard.writeText(txt);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
    toast('Resultados de puertos copiados', 'success');
  };

  const filteredResults = (data?.results || []).filter((r) => {
    if (statusFilter === 'ALL') return true;
    return r.status === statusFilter;
  });

  return (
    <div className="space-y-6">
      {/* Barra de Búsqueda */}
      <div className="rounded-xl border border-slate-800 bg-slate-900/70 p-5 backdrop-blur-sm">
        <form onSubmit={handleSearch} className="flex flex-col sm:flex-row gap-3">
          <div className="relative flex-1">
            <div className="absolute inset-y-0 left-0 pl-3.5 flex items-center pointer-events-none text-slate-500">
              <Server className="w-4 h-4 text-rose-400" />
            </div>
            <input
              type="text"
              value={host}
              onChange={(e) => setHost(e.target.value)}
              placeholder="Introduzca host o IP a sondear (ej. github.com)..."
              className="w-full pl-10 pr-4 py-2.5 rounded-lg border border-slate-700/80 bg-slate-950/80 text-sm font-mono text-slate-100 placeholder:text-slate-500 focus:outline-none focus:ring-2 focus:ring-rose-500 focus:border-transparent transition-all"
            />
          </div>
          <div className="w-36">
            <input
              type="number"
              value={customPort}
              onChange={(e) => setCustomPort(e.target.value)}
              placeholder="Puerto (o todos)"
              className="w-full px-3 py-2.5 rounded-lg border border-slate-700/80 bg-slate-950/80 text-sm font-mono text-slate-100 placeholder:text-slate-500 focus:outline-none focus:ring-2 focus:ring-rose-500 text-center"
            />
          </div>
          <button
            type="submit"
            disabled={isLoading || isFetching}
            className="flex items-center justify-center gap-2 px-6 py-2.5 rounded-lg bg-rose-500 hover:bg-rose-400 text-slate-950 text-sm font-semibold transition-colors disabled:opacity-50 whitespace-nowrap shadow-sm shadow-rose-500/20"
          >
            {isLoading || isFetching ? (
              <RefreshCw className="w-4 h-4 animate-spin" />
            ) : (
              <Search className="w-4 h-4" />
            )}
            <span>{customPort ? 'Probar Puerto' : 'Escanear Puertos'}</span>
          </button>
        </form>

        <div className="mt-4 pt-4 border-t border-slate-800/80 flex items-center justify-between gap-2 text-xs text-slate-500">
          <div className="flex items-center gap-2">
            <span>Ejemplos:</span>
            {EXAMPLES.map((ex) => (
              <button
                key={ex}
                type="button"
                onClick={() => {
                  setHost(ex);
                  setActiveQuery({ host: ex });
                }}
                className="text-slate-400 hover:text-rose-400 transition-colors underline decoration-slate-700 hover:decoration-rose-400 font-mono"
              >
                {ex}
              </button>
            ))}
          </div>
          <span className="text-[11px] text-slate-500 hidden sm:inline">
            Deje el puerto en blanco para probar la suite de servicios comunes (HTTP, HTTPS, SSH, FTP, Mail, DB)
          </span>
        </div>
      </div>

      {/* Esqueleto de Carga */}
      {isLoading && (
        <div className="rounded-xl border border-slate-800 bg-slate-900/40 p-6 space-y-4 animate-pulse">
          <div className="h-6 w-48 bg-slate-800 rounded"></div>
          <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-3">
            {[1, 2, 3, 4, 5, 6].map((i) => (
              <div key={i} className="h-20 bg-slate-800/50 rounded-lg"></div>
            ))}
          </div>
        </div>
      )}

      {/* Error */}
      {isError && (
        <div className="rounded-xl border border-red-500/30 bg-red-950/20 p-6 text-slate-200 animate-in fade-in">
          <p className="text-sm text-slate-300">
            {(error as any)?.message || 'Error al sondear puertos en el host remoto.'}
          </p>
          <button
            onClick={() => refetch()}
            className="mt-3 px-3 py-1.5 rounded bg-slate-800 hover:bg-slate-700 text-xs font-medium text-slate-200 transition-colors"
          >
            Reintentar Escaneo
          </button>
        </div>
      )}

      {/* Resultados */}
      {data && !isLoading && (
        <div className="space-y-5 animate-in fade-in slide-in-from-bottom-2 duration-300">
          {/* Métricas y Resumen */}
          <div className="rounded-xl border border-slate-800 bg-slate-900/60 p-5 flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
            <div className="flex items-center gap-4 flex-wrap">
              <div>
                <span className="text-xs text-slate-500 font-mono">Host Destino</span>
                <div className="text-sm font-semibold font-mono text-slate-100">{data.host}</div>
              </div>
              <div className="h-8 w-px bg-slate-800 hidden sm:block"></div>
              {data.summary && (
                <div className="flex items-center gap-3 text-xs font-mono">
                  <div>
                    <span className="text-slate-500 block text-[11px]">Abiertos</span>
                    <span className="font-bold text-emerald-400 text-sm tabular-nums">{data.summary.open}</span>
                  </div>
                  <div>
                    <span className="text-slate-500 block text-[11px]">Cerrados</span>
                    <span className="font-bold text-amber-400 text-sm tabular-nums">{data.summary.closed}</span>
                  </div>
                  <div>
                    <span className="text-slate-500 block text-[11px]">Filtrados</span>
                    <span className="font-bold text-slate-400 text-sm tabular-nums">{data.summary.filtered}</span>
                  </div>
                </div>
              )}
            </div>

            <button
              onClick={copyResults}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded bg-slate-800 hover:bg-slate-700 border border-slate-700 text-xs text-slate-200 transition-colors"
            >
              {copied ? <Check className="w-3.5 h-3.5 text-emerald-400" /> : <Copy className="w-3.5 h-3.5" />}
              <span>{copied ? 'Copiado' : 'Copiar Resultados'}</span>
            </button>
          </div>

          {/* Filtro de Estado */}
          {data.results.length > 1 && (
            <div className="flex items-center gap-1 p-1 bg-slate-950 rounded-lg border border-slate-800/80 w-fit">
              {(['ALL', 'OPEN', 'CLOSED', 'FILTERED'] as const).map((filter) => (
                <button
                  key={filter}
                  onClick={() => setStatusFilter(filter)}
                  className={`px-3 py-1 text-xs font-mono font-medium rounded-md transition-colors ${
                    statusFilter === filter
                      ? 'bg-slate-800 text-white shadow-sm'
                      : 'text-slate-400 hover:text-slate-200'
                  }`}
                >
                  {filter === 'ALL'
                    ? 'TODOS'
                    : filter === 'OPEN'
                    ? 'ABIERTOS'
                    : filter === 'CLOSED'
                    ? 'CERRADOS'
                    : 'FILTRADOS'}
                </button>
              ))}
            </div>
          )}

          {/* Grilla de Puertos */}
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
            {filteredResults?.map((res, idx) => (
              <div
                key={idx}
                className={`rounded-lg border p-3.5 transition-colors flex items-center justify-between gap-3 ${
                  res.status === 'OPEN'
                    ? 'border-emerald-500/30 bg-emerald-950/10'
                    : res.status === 'CLOSED'
                    ? 'border-slate-800 bg-slate-900/50'
                    : 'border-slate-800/60 bg-slate-950/40 opacity-75'
                }`}
              >
                <div className="min-w-0">
                  <div className="flex items-center gap-2">
                    <span className="font-mono text-sm font-bold text-slate-100">{res.port}</span>
                    <span className="text-xs text-slate-400 truncate">{res.service}</span>
                  </div>
                  <div className="text-[11px] font-mono text-slate-500 mt-0.5">
                    <span>{res.protocol}</span>
                    <span aria-hidden="true" className="mx-1">·</span>
                    <span className="tabular-nums">{res.durationMs}ms</span>
                  </div>
                </div>

                <div className="flex items-center gap-1.5 shrink-0">
                  {res.status === 'OPEN' ? (
                    <span className="flex items-center gap-1 font-mono text-xs font-bold text-emerald-400 bg-emerald-500/10 px-2 py-0.5 rounded border border-emerald-500/30">
                      <CheckCircle2 className="w-3.5 h-3.5" /> ABIERTO
                    </span>
                  ) : res.status === 'CLOSED' ? (
                    <span className="flex items-center gap-1 font-mono text-xs text-amber-400 bg-amber-500/10 px-2 py-0.5 rounded border border-amber-500/30">
                      <XCircle className="w-3.5 h-3.5" /> CERRADO
                    </span>
                  ) : (
                    <span className="flex items-center gap-1 font-mono text-xs text-slate-400 bg-slate-800/60 px-2 py-0.5 rounded border border-slate-700/40">
                      <Clock className="w-3.5 h-3.5" /> FILTRADO
                    </span>
                  )}
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
};
