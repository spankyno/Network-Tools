import React, { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { fetchDnsPropagation } from '../../lib/api';
import { DnsPropagationResponse, ResolverResult, ToolId } from '../../types/network';
import { saveHistoryItem } from '../../lib/history';
import { useToast } from '../Toast';
import { Radio, Search, RefreshCw, Copy, CheckCircle2, AlertTriangle, XCircle, Globe2, Check } from 'lucide-react';

const PROP_TYPES = ['A', 'AAAA', 'CNAME', 'MX', 'TXT', 'NS'];
const EXAMPLES = ['cloudflare.com', 'google.com', 'amazon.com', 'reddit.com'];

interface DnsPropagationToolProps {
  initialQuery?: string;
  initialType?: string;
  onRunQuery?: (tool: ToolId, query: string, extra?: string) => void;
}

export const DnsPropagationTool: React.FC<DnsPropagationToolProps> = ({
  initialQuery = 'cloudflare.com',
  initialType = 'A',
  onRunQuery,
}) => {
  const [domain, setDomain] = useState(initialQuery);
  const [selectedType, setSelectedType] = useState(initialType);
  const [activeQuery, setActiveQuery] = useState({ domain: initialQuery, type: initialType });
  const [copied, setCopied] = useState(false);

  const { toast } = useToast();

  const { data, isLoading, isError, error, refetch, isFetching } = useQuery<DnsPropagationResponse>({
    queryKey: ['propagation', activeQuery.domain, activeQuery.type],
    queryFn: async () => {
      if (!activeQuery.domain) throw new Error('El dominio es obligatorio');
      const res = await fetchDnsPropagation(activeQuery.domain, activeQuery.type);
      saveHistoryItem('propagation', activeQuery.domain, activeQuery.type);
      if (onRunQuery) onRunQuery('propagation', activeQuery.domain, activeQuery.type);
      return res;
    },
    enabled: Boolean(activeQuery.domain),
    staleTime: 60000,
  });

  const handleSearch = (e?: React.FormEvent) => {
    if (e) e.preventDefault();
    const clean = domain.trim().toLowerCase().replace(/^https?:\/\//i, '').replace(/\/.*$/, '');
    if (!clean) return;
    setActiveQuery({ domain: clean, type: selectedType });
  };

  const handleTypeChange = (type: string) => {
    setSelectedType(type);
    if (domain.trim()) {
      setActiveQuery({ domain: domain.trim(), type });
    }
  };

  const copySummary = () => {
    if (!data) return;
    const resolversList = data.resolvers || (data as any).results || [];
    const txt = resolversList
      .map((r: any) => `${r.resolver || r.name} (${r.location}) [${r.durationMs}ms]: ${(r.records || []).join(', ') || r.status}`)
      .join('\n');
    navigator.clipboard.writeText(txt);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
    toast('Resultados de propagación copiados al portapapeles', 'success');
  };

  return (
    <div className="space-y-6">
      {/* Barra de Búsqueda */}
      <div className="rounded-xl border border-slate-800 bg-slate-900/70 p-5 backdrop-blur-sm">
        <form onSubmit={handleSearch} className="flex flex-col sm:flex-row gap-3">
          <div className="relative flex-1">
            <div className="absolute inset-y-0 left-0 pl-3.5 flex items-center pointer-events-none text-slate-500">
              <Radio className="w-4 h-4 text-blue-400" />
            </div>
            <input
              type="text"
              value={domain}
              onChange={(e) => setDomain(e.target.value)}
              placeholder="Introduzca dominio a comprobar propagación mundial..."
              className="w-full pl-10 pr-4 py-2.5 rounded-lg border border-slate-700/80 bg-slate-950/80 text-sm font-mono text-slate-100 placeholder:text-slate-500 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent transition-all"
            />
          </div>
          <button
            type="submit"
            disabled={isLoading || isFetching}
            className="flex items-center justify-center gap-2 px-6 py-2.5 rounded-lg bg-blue-500 hover:bg-blue-400 text-slate-950 text-sm font-semibold transition-colors disabled:opacity-50 whitespace-nowrap shadow-sm shadow-blue-500/20"
          >
            {isLoading || isFetching ? (
              <RefreshCw className="w-4 h-4 animate-spin" />
            ) : (
              <Search className="w-4 h-4" />
            )}
            <span>Verificar Propagación</span>
          </button>
        </form>

        <div className="mt-4 pt-4 border-t border-slate-800/80 flex flex-wrap items-center justify-between gap-3">
          <div className="flex flex-wrap items-center gap-1.5">
            <span className="text-xs text-slate-400 mr-1 font-medium">Tipo de Registro:</span>
            {PROP_TYPES.map((type) => (
              <button
                key={type}
                type="button"
                onClick={() => handleTypeChange(type)}
                className={`px-3 py-1 text-xs font-mono font-medium rounded-md transition-colors ${
                  selectedType === type
                    ? 'bg-blue-500 text-slate-950 font-bold shadow-sm'
                    : 'bg-slate-800/80 text-slate-300 hover:bg-slate-700/80 hover:text-white'
                }`}
              >
                {type}
              </button>
            ))}
          </div>

          <div className="flex items-center gap-1.5 text-xs text-slate-500">
            <span>Ejemplos:</span>
            {EXAMPLES.map((ex) => (
              <button
                key={ex}
                type="button"
                onClick={() => {
                  setDomain(ex);
                  setActiveQuery({ domain: ex, type: selectedType });
                }}
                className="text-slate-400 hover:text-blue-400 transition-colors underline decoration-slate-700 hover:decoration-blue-400"
              >
                {ex}
              </button>
            ))}
          </div>
        </div>
      </div>

      {/* Esqueleto de Carga */}
      {isLoading && (
        <div className="rounded-xl border border-slate-800 bg-slate-900/40 p-6 space-y-4 animate-pulse">
          <div className="h-6 w-56 bg-slate-800 rounded"></div>
          <div className="h-3 w-full bg-slate-800 rounded-full"></div>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3 pt-2">
            {[1, 2, 3, 4, 5, 6, 7, 8].map((i) => (
              <div key={i} className="h-20 bg-slate-800/60 rounded-lg"></div>
            ))}
          </div>
        </div>
      )}

      {/* Estado de Error */}
      {isError && (
        <div className="rounded-xl border border-red-500/30 bg-red-950/20 p-6 text-slate-200 animate-in fade-in">
          <p className="text-sm text-slate-300">{(error as any)?.message || 'Error en la verificación de propagación.'}</p>
          <button
            onClick={() => refetch()}
            className="mt-3 px-3 py-1.5 rounded bg-slate-800 hover:bg-slate-700 text-xs font-medium text-slate-200 transition-colors"
          >
            Reintentar
          </button>
        </div>
      )}

      {/* Resultados */}
      {data && !isLoading && (() => {
        const resolvers: ResolverResult[] = (data.resolvers || (data as any).results || []).map((r: any) => ({
          resolver: r.resolver || r.name || 'Resolutor',
          ip: r.ip || '',
          location: r.location || '',
          country: r.country || '',
          status: r.status || (r.success ? 'OK' : 'ERROR'),
          durationMs: r.durationMs ?? 0,
          records: Array.isArray(r.records) ? r.records : [],
          success: Boolean(r.success),
          matchesMajority: Boolean(r.matchesMajority),
          error: r.error,
        }));
        const majorityRecords: string[] = Array.isArray(data.majorityRecords)
          ? data.majorityRecords
          : [];
        const percent = typeof data.propagationPercent === 'number'
          ? data.propagationPercent
          : typeof (data as any).propagationRate === 'number'
          ? (data as any).propagationRate
          : 0;

        return (
          <div className="space-y-5 animate-in fade-in slide-in-from-bottom-2 duration-300">
            {/* Tarjeta de Resumen y Consenso */}
            <div className="rounded-xl border border-slate-800 bg-slate-900/60 p-5">
              <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4 mb-4">
                <div>
                  <div className="flex items-center gap-2">
                    <Globe2 className="w-4 h-4 text-blue-400" />
                    <h3 className="text-sm font-semibold text-slate-200">
                      Consistencia Global: {percent}%
                    </h3>
                  </div>
                  <div className="text-xs text-slate-400 mt-1 flex items-center gap-2">
                    <span>Auditados {resolvers.length} resolutores mundiales</span>
                    <span aria-hidden="true">·</span>
                    <span className="font-mono text-slate-300">
                      {majorityRecords.length > 0
                        ? `Consenso: ${majorityRecords.join(', ')}`
                        : 'Sin consenso unánime'}
                    </span>
                  </div>
                </div>

                <button
                  onClick={copySummary}
                  className="flex items-center gap-1.5 px-3 py-1.5 rounded bg-slate-800 hover:bg-slate-700 border border-slate-700 text-xs text-slate-200 transition-colors"
                >
                  {copied ? <Check className="w-3.5 h-3.5 text-emerald-400" /> : <Copy className="w-3.5 h-3.5" />}
                  <span>{copied ? 'Copiado' : 'Copiar Resumen'}</span>
                </button>
              </div>

              {/* Barra de Progreso */}
              <div className="w-full bg-slate-800 h-2.5 rounded-full overflow-hidden">
                <div
                  className={`h-full transition-all duration-500 rounded-full ${
                    percent >= 80
                      ? 'bg-emerald-500'
                      : percent >= 50
                      ? 'bg-amber-500'
                      : 'bg-red-500'
                  }`}
                  style={{ width: `${percent}%` }}
                ></div>
              </div>
            </div>

            {/* Grilla de Resolutores */}
            <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
              {resolvers.map((res, index) => (
                <div
                  key={index}
                  className={`rounded-lg border p-3.5 transition-colors flex flex-col justify-between ${
                    res.matchesMajority
                      ? 'border-slate-800 bg-slate-900/50 hover:border-slate-700'
                      : 'border-amber-500/30 bg-amber-950/10 hover:border-amber-500/50'
                  }`}
                >
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <div className="flex items-center gap-2">
                        <span className="text-xs font-semibold text-slate-100">{res.resolver}</span>
                        {res.ip && <span className="text-[11px] font-mono text-slate-400">({res.ip})</span>}
                      </div>
                      <div className="text-[11px] text-slate-500 mt-0.5">
                        <span>{res.location || res.country || 'Ubicación global'}</span>
                      </div>
                    </div>

                    <div className="flex items-center gap-1.5 shrink-0">
                      <span className="font-mono text-xs tabular-nums text-slate-400">{res.durationMs}ms</span>
                      {res.matchesMajority ? (
                        <span title="Coincide con consenso"><CheckCircle2 className="w-4 h-4 text-emerald-400 shrink-0" /></span>
                      ) : res.success ? (
                        <span title="Registro divergente"><AlertTriangle className="w-4 h-4 text-amber-400 shrink-0" /></span>
                      ) : (
                        <span title="Fallo o timeout"><XCircle className="w-4 h-4 text-red-400 shrink-0" /></span>
                      )}
                    </div>
                  </div>

                  <div className="mt-2.5 pt-2 border-t border-slate-800/60 font-mono text-xs">
                    {(res.records || []).length > 0 ? (
                      <div className="text-slate-200 break-all select-all">{res.records.join(', ')}</div>
                    ) : (
                      <div className="text-slate-500 italic">{res.status || res.error || 'Sin registros devueltos'}</div>
                    )}
                  </div>
                </div>
              ))}
            </div>
          </div>
        );
      })()}
    </div>
  );
};
