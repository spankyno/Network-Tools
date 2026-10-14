import React, { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { fetchWhois } from '../../lib/api';
import { WhoisResponse, ToolId } from '../../types/network';
import { saveHistoryItem } from '../../lib/history';
import { useToast } from '../Toast';
import { FileText, Search, RefreshCw, Copy, Check, ShieldCheck, ShieldAlert, Server, Calendar, Building } from 'lucide-react';

const EXAMPLES = ['github.com', 'wikipedia.org', 'cloudflare.com', 'ietf.org'];

interface WhoisLookupToolProps {
  initialQuery?: string;
  onRunQuery?: (tool: ToolId, query: string, extra?: string) => void;
}

export const WhoisLookupTool: React.FC<WhoisLookupToolProps> = ({
  initialQuery = 'github.com',
  onRunQuery,
}) => {
  const [query, setQuery] = useState(initialQuery);
  const [activeQuery, setActiveQuery] = useState(initialQuery);
  const [showRaw, setShowRaw] = useState(false);
  const [copied, setCopied] = useState(false);

  const { toast } = useToast();

  const { data, isLoading, isError, error, refetch, isFetching } = useQuery<WhoisResponse>({
    queryKey: ['whois', activeQuery],
    queryFn: async () => {
      if (!activeQuery) throw new Error('El dominio o dirección IP es obligatorio');
      const res = await fetchWhois(activeQuery);
      saveHistoryItem('whois', activeQuery);
      if (onRunQuery) onRunQuery('whois', activeQuery);
      return res;
    },
    enabled: Boolean(activeQuery),
    staleTime: 60000,
  });

  const handleSearch = (e?: React.FormEvent) => {
    if (e) e.preventDefault();
    const clean = query.trim().toLowerCase().replace(/^https?:\/\//i, '').replace(/\/.*$/, '');
    if (!clean) return;
    setActiveQuery(clean);
  };

  const copyDetails = () => {
    if (!data) return;
    const txt = `Dominio: ${data.name}\nRegistrador: ${data.registrar}\nFecha de Creación: ${data.creationDate}\nFecha de Expiración: ${data.expirationDate}\nServidores DNS: ${data.nameservers.join(', ')}`;
    navigator.clipboard.writeText(txt);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
    toast('Resumen Whois copiado al portapapeles', 'success');
  };

  const formatDate = (dateStr: string) => {
    if (!dateStr) return 'N/A';
    try {
      return new Date(dateStr).toLocaleDateString('es-ES', {
        year: 'numeric',
        month: 'short',
        day: 'numeric',
        hour: '2-digit',
        minute: '2-digit',
      });
    } catch {
      return dateStr;
    }
  };

  return (
    <div className="space-y-6">
      {/* Barra de Búsqueda */}
      <div className="rounded-xl border border-slate-800 bg-slate-900/70 p-5 backdrop-blur-sm">
        <form onSubmit={handleSearch} className="flex flex-col sm:flex-row gap-3">
          <div className="relative flex-1">
            <div className="absolute inset-y-0 left-0 pl-3.5 flex items-center pointer-events-none text-slate-500">
              <FileText className="w-4 h-4 text-indigo-400" />
            </div>
            <input
              type="text"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Introduzca dominio o IP (ej. github.com, 1.1.1.1)..."
              className="w-full pl-10 pr-4 py-2.5 rounded-lg border border-slate-700/80 bg-slate-950/80 text-sm font-mono text-slate-100 placeholder:text-slate-500 focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:border-transparent transition-all"
            />
          </div>
          <button
            type="submit"
            disabled={isLoading || isFetching}
            className="flex items-center justify-center gap-2 px-6 py-2.5 rounded-lg bg-indigo-500 hover:bg-indigo-400 text-white text-sm font-semibold transition-colors disabled:opacity-50 whitespace-nowrap shadow-sm shadow-indigo-500/20"
          >
            {isLoading || isFetching ? (
              <RefreshCw className="w-4 h-4 animate-spin" />
            ) : (
              <Search className="w-4 h-4" />
            )}
            <span>Consultar RDAP</span>
          </button>
        </form>

        <div className="mt-4 pt-4 border-t border-slate-800/80 flex items-center gap-2 text-xs text-slate-500">
          <span>Ejemplos:</span>
          {EXAMPLES.map((ex) => (
            <button
              key={ex}
              type="button"
              onClick={() => {
                setQuery(ex);
                setActiveQuery(ex);
              }}
              className="text-slate-400 hover:text-indigo-400 transition-colors underline decoration-slate-700 hover:decoration-indigo-400 font-mono"
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
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div className="h-32 bg-slate-800/50 rounded-lg"></div>
            <div className="h-32 bg-slate-800/50 rounded-lg"></div>
          </div>
        </div>
      )}

      {/* Error */}
      {isError && (
        <div className="rounded-xl border border-red-500/30 bg-red-950/20 p-6 text-slate-200 animate-in fade-in">
          <p className="text-sm text-slate-300">
            {(error as any)?.message || 'No se pudo obtener información RDAP para esta entidad.'}
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
        <div className="space-y-5 animate-in fade-in slide-in-from-bottom-2 duration-300">
          {/* Barra Superior de Acciones */}
          <div className="flex items-center justify-between gap-4 text-xs text-slate-400">
            <div className="flex items-center gap-2 font-mono">
              <span className="text-sm font-semibold text-slate-100">{data.name}</span>
              <span aria-hidden="true">·</span>
              <span className="text-indigo-400">{data.isIp ? 'Red IP' : 'Nombre de Dominio'}</span>
            </div>
            <div className="flex items-center gap-2">
              <button
                onClick={copyDetails}
                className="flex items-center gap-1.5 px-3 py-1.5 rounded bg-slate-800 hover:bg-slate-700 border border-slate-700 text-slate-200 transition-colors"
              >
                {copied ? <Check className="w-3.5 h-3.5 text-emerald-400" /> : <Copy className="w-3.5 h-3.5" />}
                <span>{copied ? 'Copiado' : 'Copiar Resumen'}</span>
              </button>
              <button
                onClick={() => setShowRaw(!showRaw)}
                className="px-3 py-1.5 rounded bg-slate-800 hover:bg-slate-700 border border-slate-700 text-slate-200 transition-colors font-mono"
              >
                {showRaw ? 'Vista Resumen' : 'JSON Crudo'}
              </button>
            </div>
          </div>

          {showRaw ? (
            <div className="rounded-xl border border-slate-800 bg-slate-950 p-4 font-mono text-xs text-slate-300 overflow-x-auto max-h-[600px]">
              <pre>{JSON.stringify(data.raw, null, 2)}</pre>
            </div>
          ) : (
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              {/* Registrador y Entidad */}
              <div className="rounded-xl border border-slate-800 bg-slate-900/60 p-5 space-y-4">
                <div className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wider text-slate-400 font-mono">
                  <Building className="w-4 h-4 text-indigo-400" />
                  <span>Registrador y Entidad</span>
                </div>
                <div className="space-y-3 text-xs">
                  <div>
                    <span className="text-slate-500 block mb-0.5">Registrador Patrocinador</span>
                    <span className="text-slate-100 font-medium text-sm">{data.registrar}</span>
                  </div>
                  <div>
                    <span className="text-slate-500 block mb-0.5">Titular / Registrant</span>
                    <span className="text-slate-300 font-mono">{data.registrant}</span>
                  </div>
                  <div>
                    <span className="text-slate-500 block mb-0.5">Identificador de Registro</span>
                    <span className="text-slate-300 font-mono">{data.handle}</span>
                  </div>
                  <div className="flex items-center gap-2 pt-1">
                    {data.dnssec ? (
                      <div className="flex items-center gap-1.5 text-emerald-400 font-medium">
                        <ShieldCheck className="w-4 h-4" />
                        <span>DNSSEC Firmado</span>
                      </div>
                    ) : (
                      <div className="flex items-center gap-1.5 text-slate-400">
                        <ShieldAlert className="w-4 h-4 text-amber-500" />
                        <span>DNSSEC Sin Firmar</span>
                      </div>
                    )}
                  </div>
                </div>
              </div>

              {/* Fechas Importantes */}
              <div className="rounded-xl border border-slate-800 bg-slate-900/60 p-5 space-y-4">
                <div className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wider text-slate-400 font-mono">
                  <Calendar className="w-4 h-4 text-indigo-400" />
                  <span>Fechas Clave del Ciclo de Vida</span>
                </div>
                <div className="space-y-3 text-xs">
                  <div>
                    <span className="text-slate-500 block mb-0.5">Fecha de Registro</span>
                    <span className="text-slate-100 font-mono tabular-nums">{formatDate(data.creationDate)}</span>
                  </div>
                  <div>
                    <span className="text-slate-500 block mb-0.5">Última Actualización</span>
                    <span className="text-slate-100 font-mono tabular-nums">{formatDate(data.updatedDate)}</span>
                  </div>
                  <div>
                    <span className="text-slate-500 block mb-0.5">Fecha de Expiración</span>
                    <span className="text-slate-100 font-mono tabular-nums font-semibold text-cyan-400">
                      {formatDate(data.expirationDate)}
                    </span>
                  </div>
                </div>
              </div>

              {/* Servidores DNS */}
              <div className="rounded-xl border border-slate-800 bg-slate-900/60 p-5 space-y-3 md:col-span-2">
                <div className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wider text-slate-400 font-mono">
                  <Server className="w-4 h-4 text-indigo-400" />
                  <span>Servidores DNS Autoritativos ({data.nameservers.length})</span>
                </div>
                <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-2">
                  {data.nameservers.length === 0 ? (
                    <span className="text-xs text-slate-500 italic">No se detectaron nameservers</span>
                  ) : (
                    data.nameservers.map((ns, idx) => (
                      <div
                        key={idx}
                        className="p-2.5 rounded-lg bg-slate-950/60 border border-slate-800 font-mono text-xs text-slate-200 truncate select-all"
                        title={ns}
                      >
                        {ns}
                      </div>
                    ))
                  )}
                </div>
              </div>

              {/* Estados EPP */}
              {data.status && data.status.length > 0 && (
                <div className="rounded-xl border border-slate-800 bg-slate-900/60 p-5 space-y-3 md:col-span-2">
                  <div className="text-xs font-semibold uppercase tracking-wider text-slate-400 font-mono">
                    Códigos de Estado EPP y Protección ({data.status.length})
                  </div>
                  <div className="flex flex-wrap gap-2">
                    {data.status.map((st, idx) => (
                      <span
                        key={idx}
                        className="px-2.5 py-1 rounded bg-slate-800/80 border border-slate-700/60 text-slate-300 font-mono text-xs"
                      >
                        {st}
                      </span>
                    ))}
                  </div>
                </div>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  );
};
