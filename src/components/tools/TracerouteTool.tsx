import React, { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { fetchTraceroute } from '../../lib/api';
import { TracerouteResponse, ToolId } from '../../types/network';
import { saveHistoryItem } from '../../lib/history';
import { useToast } from '../Toast';
import { Route, Search, RefreshCw, Copy, Check, Server, Globe2, AlertCircle, ArrowDown } from 'lucide-react';

const EXAMPLES = ['1.1.1.1', '8.8.8.8', 'github.com', 'wikimedia.org'];

interface TracerouteToolProps {
  initialQuery?: string;
  onRunQuery?: (tool: ToolId, query: string, extra?: string) => void;
}

export const TracerouteTool: React.FC<TracerouteToolProps> = ({
  initialQuery = '1.1.1.1',
  onRunQuery,
}) => {
  const [target, setTarget] = useState(initialQuery);
  const [activeTarget, setActiveTarget] = useState(initialQuery);
  const [copied, setCopied] = useState(false);

  const { toast } = useToast();

  const { data, isLoading, isError, error, refetch, isFetching } = useQuery<TracerouteResponse>({
    queryKey: ['traceroute', activeTarget],
    queryFn: async () => {
      if (!activeTarget) throw new Error('El host o IP de destino es obligatorio');
      const res = await fetchTraceroute(activeTarget);
      saveHistoryItem('traceroute', activeTarget);
      if (onRunQuery) onRunQuery('traceroute', activeTarget);
      return res;
    },
    enabled: Boolean(activeTarget),
    staleTime: 60000,
  });

  const handleSearch = (e?: React.FormEvent) => {
    if (e) e.preventDefault();
    const clean = target.trim().toLowerCase().replace(/^https?:\/\//i, '').replace(/\/.*$/, '').replace(/:\d+$/, '');
    if (!clean) return;
    setActiveTarget(clean);
  };

  const copyTraceroute = () => {
    if (!data) return;
    const txt = data.hops
      .map((h) => `${h.hop}\t${h.ip}\t${h.hostname || '*'}\t${h.rttMs !== null ? `${h.rttMs} ms` : '*'}`)
      .join('\n');
    navigator.clipboard.writeText(`Traceroute hacia ${data.target} (${data.totalHops} saltos):\n${txt}`);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
    toast('Trazado de ruta copiado al portapapeles', 'success');
  };

  const maxRtt = data?.hops.reduce((max, h) => (h.rttMs && h.rttMs > max ? h.rttMs : max), 1) || 100;

  return (
    <div className="space-y-6">
      {/* Barra de Búsqueda */}
      <div className="rounded-xl border border-slate-800 bg-slate-900/70 p-5 backdrop-blur-sm">
        <form onSubmit={handleSearch} className="flex flex-col sm:flex-row gap-3">
          <div className="relative flex-1">
            <div className="absolute inset-y-0 left-0 pl-3.5 flex items-center pointer-events-none text-slate-500">
              <Route className="w-4 h-4 text-emerald-400" />
            </div>
            <input
              type="text"
              value={target}
              onChange={(e) => setTarget(e.target.value)}
              placeholder="Introduzca host o IP de destino (ej. 1.1.1.1, github.com)..."
              className="w-full pl-10 pr-4 py-2.5 rounded-lg border border-slate-700/80 bg-slate-950/80 text-sm font-mono text-slate-100 placeholder:text-slate-500 focus:outline-none focus:ring-2 focus:ring-emerald-500 focus:border-transparent transition-all"
            />
          </div>
          <button
            type="submit"
            disabled={isLoading || isFetching}
            className="flex items-center justify-center gap-2 px-6 py-2.5 rounded-lg bg-emerald-500 hover:bg-emerald-400 text-slate-950 text-sm font-semibold transition-colors disabled:opacity-50 whitespace-nowrap shadow-sm shadow-emerald-500/20"
          >
            {isLoading || isFetching ? (
              <RefreshCw className="w-4 h-4 animate-spin" />
            ) : (
              <Search className="w-4 h-4" />
            )}
            <span>Trazar Ruta</span>
          </button>
        </form>

        <div className="mt-4 pt-4 border-t border-slate-800/80 flex items-center gap-2 text-xs text-slate-500">
          <span>Ejemplos:</span>
          {EXAMPLES.map((ex) => (
            <button
              key={ex}
              type="button"
              onClick={() => {
                setTarget(ex);
                setActiveTarget(ex);
              }}
              className="text-slate-400 hover:text-emerald-400 transition-colors underline decoration-slate-700 hover:decoration-emerald-400 font-mono"
            >
              {ex}
            </button>
          ))}
        </div>
      </div>

      {/* Esqueleto de Carga */}
      {isLoading && (
        <div className="rounded-xl border border-slate-800 bg-slate-900/40 p-6 space-y-4 animate-pulse">
          <div className="h-6 w-48 bg-slate-800 rounded"></div>
          <div className="space-y-3">
            {[1, 2, 3, 4, 5].map((i) => (
              <div key={i} className="h-16 bg-slate-800/50 rounded-xl"></div>
            ))}
          </div>
        </div>
      )}

      {/* Estado de Error */}
      {isError && (
        <div className="rounded-xl border border-red-500/30 bg-red-950/20 p-6 text-slate-200">
          <p className="text-sm text-slate-300">
            {(error as any)?.message || 'No se pudo completar el traceroute hacia el destino.'}
          </p>
          <button
            onClick={() => refetch()}
            className="mt-3 px-3 py-1.5 rounded bg-slate-800 hover:bg-slate-700 text-xs font-medium text-slate-200 transition-colors"
          >
            Reintentar Trazado
          </button>
        </div>
      )}

      {/* Resultados de Saltos */}
      {data && !isLoading && (
        <div className="space-y-5 animate-in fade-in slide-in-from-bottom-2 duration-300">
          {/* Encabezado */}
          <div className="rounded-xl border border-slate-800 bg-slate-900/60 p-5 flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
            <div>
              <div className="flex items-center gap-2">
                <span className="font-mono text-base font-bold text-slate-100">{data.target}</span>
                <span className="text-xs font-mono px-2 py-0.5 rounded bg-emerald-500/20 text-emerald-400 font-semibold">
                  {data.totalHops} Saltos de Red
                </span>
              </div>
              <div className="text-xs text-slate-400 mt-1 flex items-center gap-2">
                <span>Sonda: <strong className="text-slate-200">{data.probeLocation} ({data.probeCountry})</strong></span>
                <span aria-hidden="true">·</span>
                <span>Proveedor: {data.provider}</span>
              </div>
            </div>

            <button
              onClick={copyTraceroute}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded bg-slate-800 hover:bg-slate-700 border border-slate-700 text-xs text-slate-200 transition-colors"
            >
              {copied ? <Check className="w-3.5 h-3.5 text-emerald-400" /> : <Copy className="w-3.5 h-3.5" />}
              <span>Copiar Ruta</span>
            </button>
          </div>

          {/* Camino de Saltos */}
          <div className="rounded-xl border border-slate-800 bg-slate-900/60 p-5 space-y-3 font-mono text-xs">
            <div className="flex items-center justify-between text-slate-400 text-xs font-sans pb-2 border-b border-slate-800 font-medium">
              <span className="w-16">Salto</span>
              <span className="flex-1">Dirección IP / Hostname</span>
              <span className="w-32 text-right">Latencia RTT</span>
            </div>

            <div className="space-y-2">
              {data.hops.map((hop, idx) => (
                <div
                  key={idx}
                  className="p-3 rounded-lg bg-slate-950/60 border border-slate-800/80 hover:border-slate-700 flex items-center justify-between gap-3 transition-colors"
                >
                  <div className="w-16 flex items-center gap-2">
                    <span className="w-6 h-6 rounded bg-slate-800 flex items-center justify-center font-bold text-slate-300 text-[11px] tabular-nums">
                      {hop.hop}
                    </span>
                    {idx < data.hops.length - 1 && (
                      <ArrowDown className="w-3 h-3 text-slate-600 hidden sm:block" />
                    )}
                  </div>

                  <div className="flex-1 min-w-0">
                    <div className="text-slate-100 font-semibold truncate">{hop.ip}</div>
                    {hop.hostname && (
                      <div className="text-[11px] text-slate-400 truncate mt-0.5">{hop.hostname}</div>
                    )}
                  </div>

                  <div className="w-36 flex flex-col items-end gap-1">
                    <span
                      className={`tabular-nums font-semibold ${
                        hop.loss
                          ? 'text-red-400'
                          : hop.rttMs !== null && hop.rttMs < 30
                          ? 'text-emerald-400'
                          : hop.rttMs !== null && hop.rttMs < 80
                          ? 'text-cyan-400'
                          : 'text-amber-400'
                      }`}
                    >
                      {hop.loss ? '* Tiempo agotado' : `${hop.rttMs} ms`}
                    </span>

                    {/* Barra visual de latencia relativa */}
                    {!hop.loss && hop.rttMs !== null && (
                      <div className="w-24 bg-slate-800 h-1.5 rounded-full overflow-hidden">
                        <div
                          className="bg-cyan-500 h-full rounded-full"
                          style={{ width: `${Math.min(100, Math.max(8, (hop.rttMs / maxRtt) * 100))}%` }}
                        ></div>
                      </div>
                    )}
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
