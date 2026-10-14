import React, { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { fetchDns } from '../../lib/api';
import { DnsResponse, ToolId } from '../../types/network';
import { saveHistoryItem } from '../../lib/history';
import { useToast } from '../Toast';
import { Globe, Search, Copy, Check, RefreshCw, FileCode } from 'lucide-react';

const DNS_TYPES = ['A', 'AAAA', 'MX', 'TXT', 'NS', 'CNAME', 'SOA', 'CAA'];
const EXAMPLES = ['cloudflare.com', 'google.com', 'github.com', 'nic.es'];

interface DnsLookupToolProps {
  initialQuery?: string;
  initialType?: string;
  onRunQuery?: (tool: ToolId, query: string, extra?: string) => void;
}

export const DnsLookupTool: React.FC<DnsLookupToolProps> = ({
  initialQuery = 'cloudflare.com',
  initialType = 'A',
  onRunQuery,
}) => {
  const [domain, setDomain] = useState(initialQuery);
  const [selectedType, setSelectedType] = useState(initialType);
  const [activeQuery, setActiveQuery] = useState({ domain: initialQuery, type: initialType });
  const [copiedIndex, setCopiedIndex] = useState<number | null>(null);
  const [showRawJson, setShowRawJson] = useState(false);

  const { toast } = useToast();

  const { data, isLoading, isError, error, refetch, isFetching } = useQuery<DnsResponse>({
    queryKey: ['dns', activeQuery.domain, activeQuery.type],
    queryFn: async () => {
      if (!activeQuery.domain) throw new Error('El nombre de dominio es obligatorio');
      const res = await fetchDns(activeQuery.domain, activeQuery.type);
      saveHistoryItem('dns', activeQuery.domain, activeQuery.type);
      if (onRunQuery) onRunQuery('dns', activeQuery.domain, activeQuery.type);
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

  const copyToClipboard = (text: string, index?: number) => {
    navigator.clipboard.writeText(text);
    if (index !== undefined) {
      setCopiedIndex(index);
      setTimeout(() => setCopiedIndex(null), 1800);
    }
    toast('Copiado al portapapeles', 'success');
  };

  const copyAllRecords = () => {
    if (!data || !data.records) return;
    const txt = data.records.map((r) => `${r.name}\t${r.TTL}\tIN\t${r.type}\t${r.data}`).join('\n');
    copyToClipboard(txt);
  };

  return (
    <div className="space-y-6">
      {/* Barra de Búsqueda y Selectores */}
      <div className="rounded-xl border border-slate-800 bg-slate-900/70 p-5 backdrop-blur-sm">
        <form onSubmit={handleSearch} className="flex flex-col sm:flex-row gap-3">
          <div className="relative flex-1">
            <div className="absolute inset-y-0 left-0 pl-3.5 flex items-center pointer-events-none text-slate-500">
              <Globe className="w-4 h-4 text-cyan-400" />
            </div>
            <input
              type="text"
              value={domain}
              onChange={(e) => setDomain(e.target.value)}
              placeholder="Introduzca dominio (ej. cloudflare.com, github.com)..."
              className="w-full pl-10 pr-4 py-2.5 rounded-lg border border-slate-700/80 bg-slate-950/80 text-sm font-mono text-slate-100 placeholder:text-slate-500 focus:outline-none focus:ring-2 focus:ring-cyan-500 focus:border-transparent transition-all"
            />
          </div>
          <button
            type="submit"
            disabled={isLoading || isFetching}
            className="flex items-center justify-center gap-2 px-6 py-2.5 rounded-lg bg-cyan-500 hover:bg-cyan-400 text-slate-950 text-sm font-semibold transition-colors disabled:opacity-50 whitespace-nowrap shadow-sm shadow-cyan-500/20"
          >
            {isLoading || isFetching ? (
              <RefreshCw className="w-4 h-4 animate-spin" />
            ) : (
              <Search className="w-4 h-4" />
            )}
            <span>Consultar DNS</span>
          </button>
        </form>

        {/* Tipos de Registro DNS */}
        <div className="mt-4 pt-4 border-t border-slate-800/80 flex flex-wrap items-center justify-between gap-3">
          <div className="flex flex-wrap items-center gap-1.5">
            <span className="text-xs text-slate-400 mr-1 font-medium">Tipo:</span>
            {DNS_TYPES.map((type) => (
              <button
                key={type}
                type="button"
                onClick={() => handleTypeChange(type)}
                className={`px-3 py-1 text-xs font-mono font-medium rounded-md transition-colors ${
                  selectedType === type
                    ? 'bg-cyan-500 text-slate-950 font-bold shadow-sm'
                    : 'bg-slate-800/80 text-slate-300 hover:bg-slate-700/80 hover:text-white'
                }`}
              >
                {type}
              </button>
            ))}
          </div>

          {/* Ejemplos */}
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
                className="text-slate-400 hover:text-cyan-400 transition-colors underline decoration-slate-700 hover:decoration-cyan-400"
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
          <div className="h-5 w-48 bg-slate-800 rounded"></div>
          <div className="space-y-2.5">
            <div className="h-12 bg-slate-800/60 rounded-lg"></div>
            <div className="h-12 bg-slate-800/60 rounded-lg"></div>
            <div className="h-12 bg-slate-800/60 rounded-lg"></div>
          </div>
        </div>
      )}

      {/* Error */}
      {isError && (
        <div className="rounded-xl border border-red-500/30 bg-red-950/20 p-6 text-slate-200 animate-in fade-in">
          <p className="text-sm text-slate-300">
            {(error as any)?.message || 'No se pudieron resolver los registros DNS.'}
          </p>
          <button
            onClick={() => refetch()}
            className="mt-3 px-3 py-1.5 rounded bg-slate-800 hover:bg-slate-700 text-xs font-medium text-slate-200 transition-colors"
          >
            Reintentar
          </button>
        </div>
      )}

      {/* Resultados */}
      {data && !isLoading && (
        <div className="space-y-4 animate-in fade-in slide-in-from-bottom-2 duration-300">
          {/* Barra de Metadatos */}
          <div className="flex flex-wrap items-center justify-between gap-4 px-1 text-xs text-slate-400">
            <div className="flex items-center gap-2 flex-wrap">
              <span className="font-semibold text-slate-200 font-mono">{data.query.name}</span>
              <span aria-hidden="true">·</span>
              <span className="font-mono text-cyan-400 font-bold">{data.query.type}</span>
              <span aria-hidden="true">·</span>
              <span
                className={`font-mono font-semibold ${
                  data.status === 'NOERROR' ? 'text-emerald-400' : 'text-amber-400'
                }`}
              >
                {data.status}
              </span>
              <span aria-hidden="true">·</span>
              <span className="tabular-nums font-mono">{data.durationMs}ms</span>
              {data.providerUsed && (
                <>
                  <span aria-hidden="true">·</span>
                  <span className="text-slate-500">Proveedor: {data.providerUsed}</span>
                </>
              )}
            </div>

            <div className="flex items-center gap-2">
              <button
                onClick={copyAllRecords}
                className="flex items-center gap-1.5 px-2.5 py-1 rounded bg-slate-800/80 hover:bg-slate-700 border border-slate-700/60 text-slate-300 hover:text-white transition-colors"
              >
                <Copy className="w-3.5 h-3.5" />
                <span>Copiar Registros</span>
              </button>
              <button
                onClick={() => setShowRawJson(!showRawJson)}
                className="flex items-center gap-1.5 px-2.5 py-1 rounded bg-slate-800/80 hover:bg-slate-700 border border-slate-700/60 text-slate-300 hover:text-white transition-colors font-mono"
              >
                <FileCode className="w-3.5 h-3.5" />
                <span>{showRawJson ? 'Vista Tabla' : 'JSON Crudo'}</span>
              </button>
            </div>
          </div>

          {showRawJson ? (
            <div className="rounded-xl border border-slate-800 bg-slate-950 p-4 font-mono text-xs text-slate-300 overflow-x-auto">
              <pre>{JSON.stringify(data.raw || data, null, 2)}</pre>
            </div>
          ) : (
            <div className="rounded-xl border border-slate-800 bg-slate-900/60 overflow-hidden shadow-sm">
              <div className="overflow-x-auto">
                <table className="w-full text-left text-xs border-collapse">
                  <thead>
                    <tr className="border-b border-slate-800 bg-slate-950/60 text-slate-400 font-mono uppercase tracking-wider">
                      <th className="py-3 px-4 font-semibold">Nombre</th>
                      <th className="py-3 px-4 font-semibold w-24">Tipo</th>
                      <th className="py-3 px-4 font-semibold w-28 text-right">TTL</th>
                      <th className="py-3 px-4 font-semibold">Valor / Destino</th>
                      <th className="py-3 px-4 w-16 text-right">Acción</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-800/60 font-mono">
                    {data.records.length === 0 ? (
                      <tr>
                        <td colSpan={5} className="py-10 text-center text-slate-500 font-sans">
                          No se encontraron registros {data.query.type} para <span className="font-mono">{data.query.name}</span>.
                        </td>
                      </tr>
                    ) : (
                      data.records.map((rec, idx) => (
                        <tr
                          key={`${rec.name}-${rec.data}-${idx}`}
                          className="hover:bg-slate-800/40 transition-colors group"
                        >
                          <td className="py-3 px-4 text-slate-300 truncate max-w-xs">{rec.name}</td>
                          <td className="py-3 px-4">
                            <span className="font-semibold text-cyan-400">{rec.type}</span>
                          </td>
                          <td className="py-3 px-4 text-right tabular-nums text-slate-400">{rec.TTL}s</td>
                          <td className="py-3 px-4 text-slate-100 font-medium break-all select-all">{rec.data}</td>
                          <td className="py-3 px-4 text-right">
                            <button
                              onClick={() => copyToClipboard(rec.data, idx)}
                              className="p-1 rounded text-slate-400 hover:text-slate-100 hover:bg-slate-800 transition-colors"
                              title="Copiar valor"
                            >
                              {copiedIndex === idx ? (
                                <Check className="w-3.5 h-3.5 text-emerald-400" />
                              ) : (
                                <Copy className="w-3.5 h-3.5" />
                              )}
                            </button>
                          </td>
                        </tr>
                      ))
                    )}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          {/* Registros de Autoridad */}
          {data.authority && data.authority.length > 0 && !showRawJson && (
            <div className="rounded-xl border border-slate-800 bg-slate-900/40 p-4 space-y-2">
              <h4 className="text-xs font-semibold text-slate-300 uppercase tracking-wider font-mono">
                Registros de Autoridad (Authority)
              </h4>
              <div className="space-y-1 font-mono text-xs text-slate-400">
                {data.authority.map((auth, idx) => (
                  <div key={idx} className="flex items-center gap-3 py-1 border-b border-slate-800/40 last:border-0">
                    <span className="text-slate-300">{auth.name}</span>
                    <span className="text-cyan-400">{auth.type}</span>
                    <span className="text-slate-500 tabular-nums">{auth.TTL}s</span>
                    <span className="text-slate-200">{auth.data}</span>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
};
