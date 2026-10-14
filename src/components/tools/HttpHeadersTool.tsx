import React, { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { fetchHeaders } from '../../lib/api';
import { HttpHeadersResponse, ToolId } from '../../types/network';
import { saveHistoryItem } from '../../lib/history';
import { useToast } from '../Toast';
import { Terminal, Search, RefreshCw, Copy, Check, CheckCircle2, AlertTriangle, ShieldCheck, Filter } from 'lucide-react';

const EXAMPLES = ['https://cloudflare.com', 'https://github.com', 'https://google.com', 'https://wikipedia.org'];

interface HttpHeadersToolProps {
  initialQuery?: string;
  onRunQuery?: (tool: ToolId, query: string, extra?: string) => void;
}

export const HttpHeadersTool: React.FC<HttpHeadersToolProps> = ({
  initialQuery = 'https://cloudflare.com',
  onRunQuery,
}) => {
  const [url, setUrl] = useState(initialQuery);
  const [activeUrl, setActiveUrl] = useState(initialQuery);
  const [headerFilter, setHeaderFilter] = useState('');
  const [activeTab, setActiveTab] = useState<'all' | 'security' | 'caching'>('all');
  const [copied, setCopied] = useState(false);

  const { toast } = useToast();

  const { data, isLoading, isError, error, refetch, isFetching } = useQuery<HttpHeadersResponse>({
    queryKey: ['headers', activeUrl],
    queryFn: async () => {
      if (!activeUrl) throw new Error('La URL es obligatoria');
      const res = await fetchHeaders(activeUrl);
      saveHistoryItem('headers', activeUrl);
      if (onRunQuery) onRunQuery('headers', activeUrl);
      return res;
    },
    enabled: Boolean(activeUrl),
    staleTime: 60000,
  });

  const handleSearch = (e?: React.FormEvent) => {
    if (e) e.preventDefault();
    let clean = url.trim();
    if (!clean) return;
    if (!/^https?:\/\//i.test(clean)) {
      clean = 'https://' + clean;
      setUrl(clean);
    }
    setActiveUrl(clean);
  };

  const copyAllHeaders = () => {
    if (!data) return;
    const txt = Object.entries(data.headers)
      .map(([k, v]) => `${k}: ${v}`)
      .join('\n');
    navigator.clipboard.writeText(txt);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
    toast('Encabezados HTTP copiados al portapapeles', 'success');
  };

  const getFilteredHeaders = () => {
    if (!data) return [];
    let entries = Object.entries(data.headers);

    if (activeTab === 'security') {
      const secKeys = [
        'strict-transport-security',
        'content-security-policy',
        'x-frame-options',
        'x-content-type-options',
        'referrer-policy',
        'permissions-policy',
        'cross-origin-opener-policy',
        'cross-origin-resource-policy',
      ];
      entries = entries.filter(
        ([k]) => secKeys.includes(k.toLowerCase()) || k.toLowerCase().includes('sec-') || k.toLowerCase().includes('security')
      );
    } else if (activeTab === 'caching') {
      const cacheKeys = ['cache-control', 'etag', 'expires', 'last-modified', 'age', 'pragma', 'vary', 'cf-cache-status'];
      entries = entries.filter(([k]) => cacheKeys.includes(k.toLowerCase()));
    }

    if (headerFilter.trim()) {
      const q = headerFilter.toLowerCase();
      entries = entries.filter(([k, v]) => k.toLowerCase().includes(q) || v.toLowerCase().includes(q));
    }

    return entries;
  };

  const getGradeColor = (grade: string) => {
    switch (grade) {
      case 'A+':
      case 'A':
        return 'text-emerald-400 border-emerald-500/40 bg-emerald-500/10';
      case 'B':
        return 'text-blue-400 border-blue-500/40 bg-blue-500/10';
      case 'C':
        return 'text-amber-400 border-amber-500/40 bg-amber-500/10';
      default:
        return 'text-red-400 border-red-500/40 bg-red-500/10';
    }
  };

  return (
    <div className="space-y-6">
      {/* Barra de Búsqueda */}
      <div className="rounded-xl border border-slate-800 bg-slate-900/70 p-5 backdrop-blur-sm">
        <form onSubmit={handleSearch} className="flex flex-col sm:flex-row gap-3">
          <div className="relative flex-1">
            <div className="absolute inset-y-0 left-0 pl-3.5 flex items-center pointer-events-none text-slate-500">
              <Terminal className="w-4 h-4 text-amber-400" />
            </div>
            <input
              type="text"
              value={url}
              onChange={(e) => setUrl(e.target.value)}
              placeholder="Introduzca URL a inspeccionar (ej. https://cloudflare.com)..."
              className="w-full pl-10 pr-4 py-2.5 rounded-lg border border-slate-700/80 bg-slate-950/80 text-sm font-mono text-slate-100 placeholder:text-slate-500 focus:outline-none focus:ring-2 focus:ring-amber-500 focus:border-transparent transition-all"
            />
          </div>
          <button
            type="submit"
            disabled={isLoading || isFetching}
            className="flex items-center justify-center gap-2 px-6 py-2.5 rounded-lg bg-amber-500 hover:bg-amber-400 text-slate-950 text-sm font-semibold transition-colors disabled:opacity-50 whitespace-nowrap shadow-sm shadow-amber-500/20"
          >
            {isLoading || isFetching ? (
              <RefreshCw className="w-4 h-4 animate-spin" />
            ) : (
              <Search className="w-4 h-4" />
            )}
            <span>Analizar Encabezados</span>
          </button>
        </form>

        <div className="mt-4 pt-4 border-t border-slate-800/80 flex items-center gap-2 text-xs text-slate-500">
          <span>Ejemplos:</span>
          {EXAMPLES.map((ex) => (
            <button
              key={ex}
              type="button"
              onClick={() => {
                setUrl(ex);
                setActiveUrl(ex);
              }}
              className="text-slate-400 hover:text-amber-400 transition-colors underline decoration-slate-700 hover:decoration-amber-400 font-mono"
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
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            <div className="h-32 bg-slate-800/50 rounded-lg"></div>
            <div className="h-32 bg-slate-800/50 rounded-lg md:col-span-2"></div>
          </div>
        </div>
      )}

      {/* Error */}
      {isError && (
        <div className="rounded-xl border border-red-500/30 bg-red-950/20 p-6 text-slate-200 animate-in fade-in">
          <p className="text-sm text-slate-300">
            {(error as any)?.message || 'No se pudieron obtener los encabezados HTTP. El servidor remoto puede estar bloqueando solicitudes automatizadas.'}
          </p>
          <button
            onClick={() => refetch()}
            className="mt-3 px-3 py-1.5 rounded bg-slate-800 hover:bg-slate-700 text-xs font-medium text-slate-200 transition-colors"
          >
            Reintentar Solicitud
          </button>
        </div>
      )}

      {/* Resultados */}
      {data && !isLoading && (
        <div className="space-y-5 animate-in fade-in slide-in-from-bottom-2 duration-300">
          {/* Calificación y Estado */}
          <div className="rounded-xl border border-slate-800 bg-slate-900/60 p-5 flex flex-col md:flex-row items-start md:items-center justify-between gap-5">
            <div className="flex items-center gap-4">
              <div
                className={`w-16 h-16 rounded-xl border flex flex-col items-center justify-center font-bold font-mono ${getGradeColor(
                  data.securityGrade
                )}`}
              >
                <span className="text-2xl leading-none">{data.securityGrade}</span>
                <span className="text-[10px] uppercase font-sans mt-0.5 opacity-80">Seguridad</span>
              </div>
              <div>
                <div className="flex items-center gap-2">
                  <span className="text-sm font-mono font-semibold text-slate-100">{data.url}</span>
                  <span
                    className={`font-mono text-xs px-2 py-0.5 rounded font-semibold ${
                      data.statusCode >= 200 && data.statusCode < 300
                        ? 'bg-emerald-500/20 text-emerald-400'
                        : data.statusCode >= 300 && data.statusCode < 400
                        ? 'bg-blue-500/20 text-blue-400'
                        : 'bg-red-500/20 text-red-400'
                    }`}
                  >
                    {data.statusCode} {data.statusText}
                  </span>
                </div>
                <div className="text-xs text-slate-400 mt-1 flex items-center gap-2">
                  <span>Latencia: <strong className="text-slate-200 font-mono tabular-nums">{data.durationMs}ms</strong></span>
                  <span aria-hidden="true">·</span>
                  <span>Puntuación: <strong className="text-slate-200 font-mono tabular-nums">{data.securityScore}%</strong></span>
                  <span aria-hidden="true">·</span>
                  <span>{Object.keys(data.headers).length} encabezados recibidos</span>
                </div>
              </div>
            </div>

            <button
              onClick={copyAllHeaders}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded bg-slate-800 hover:bg-slate-700 border border-slate-700 text-xs text-slate-200 transition-colors shrink-0"
            >
              {copied ? <Check className="w-3.5 h-3.5 text-emerald-400" /> : <Copy className="w-3.5 h-3.5" />}
              <span>{copied ? 'Copiado' : 'Copiar Encabezados'}</span>
            </button>
          </div>

          {/* Lista de Auditoría de Seguridad */}
          <div className="rounded-xl border border-slate-800 bg-slate-900/60 p-5 space-y-3">
            <div className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wider text-slate-400 font-mono">
              <ShieldCheck className="w-4 h-4 text-amber-400" />
              <span>Evaluación de Encabezados de Seguridad</span>
            </div>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
              {data.securityAudit.map((audit, idx) => (
                <div
                  key={idx}
                  className={`p-3 rounded-lg border text-xs flex flex-col justify-between ${
                    audit.status === 'pass'
                      ? 'border-emerald-500/20 bg-emerald-950/10'
                      : 'border-slate-800 bg-slate-950/40'
                  }`}
                >
                  <div className="flex items-start justify-between gap-2">
                    <span className="font-semibold text-slate-200">{audit.name}</span>
                    {audit.status === 'pass' ? (
                      <span className="text-[11px] font-mono text-emerald-400 flex items-center gap-1">
                        <CheckCircle2 className="w-3.5 h-3.5" /> Cumple
                      </span>
                    ) : (
                      <span className="text-[11px] font-mono text-amber-400 flex items-center gap-1">
                        <AlertTriangle className="w-3.5 h-3.5" /> Ausente
                      </span>
                    )}
                  </div>
                  <p className="text-slate-400 text-[11px] mt-1.5">{audit.recommendation}</p>
                  {audit.value && (
                    <div className="mt-2 pt-1.5 border-t border-slate-800/60 font-mono text-[11px] text-cyan-300 break-all select-all">
                      {audit.value}
                    </div>
                  )}
                </div>
              ))}
            </div>
          </div>

          {/* Explorador de Encabezados */}
          <div className="rounded-xl border border-slate-800 bg-slate-900/60 overflow-hidden">
            <div className="p-4 border-b border-slate-800 flex flex-col sm:flex-row items-stretch sm:items-center justify-between gap-3 bg-slate-950/40">
              <div className="flex items-center gap-1 p-1 bg-slate-950 rounded-lg border border-slate-800/80">
                <button
                  onClick={() => setActiveTab('all')}
                  className={`px-3 py-1 text-xs font-medium rounded-md transition-colors ${
                    activeTab === 'all'
                      ? 'bg-slate-800 text-white shadow-sm'
                      : 'text-slate-400 hover:text-slate-200'
                  }`}
                >
                  Todos ({Object.keys(data.headers).length})
                </button>
                <button
                  onClick={() => setActiveTab('security')}
                  className={`px-3 py-1 text-xs font-medium rounded-md transition-colors ${
                    activeTab === 'security'
                      ? 'bg-slate-800 text-white shadow-sm'
                      : 'text-slate-400 hover:text-slate-200'
                  }`}
                >
                  Seguridad
                </button>
                <button
                  onClick={() => setActiveTab('caching')}
                  className={`px-3 py-1 text-xs font-medium rounded-md transition-colors ${
                    activeTab === 'caching'
                      ? 'bg-slate-800 text-white shadow-sm'
                      : 'text-slate-400 hover:text-slate-200'
                  }`}
                >
                  Caché y CDN
                </button>
              </div>

              <div className="relative w-full sm:w-64">
                <div className="absolute inset-y-0 left-0 pl-2.5 flex items-center pointer-events-none text-slate-500">
                  <Filter className="w-3.5 h-3.5" />
                </div>
                <input
                  type="text"
                  value={headerFilter}
                  onChange={(e) => setHeaderFilter(e.target.value)}
                  placeholder="Filtrar por clave o valor..."
                  className="w-full pl-8 pr-3 py-1.5 rounded-lg border border-slate-700/80 bg-slate-950 text-xs text-slate-200 placeholder:text-slate-500 focus:outline-none focus:ring-1 focus:ring-amber-500"
                />
              </div>
            </div>

            <div className="divide-y divide-slate-800/60 font-mono text-xs max-h-[500px] overflow-y-auto">
              {getFilteredHeaders().length === 0 ? (
                <div className="py-8 text-center text-slate-500 font-sans text-xs">
                  Ningún encabezado coincide con el filtro actual.
                </div>
              ) : (
                getFilteredHeaders().map(([key, val], idx) => (
                  <div
                    key={idx}
                    className="p-3.5 hover:bg-slate-800/40 transition-colors flex flex-col sm:flex-row sm:items-start justify-between gap-2"
                  >
                    <div className="text-amber-400/90 font-semibold shrink-0 sm:w-56 break-all">
                      {key}
                    </div>
                    <div className="text-slate-200 break-all flex-1 select-all">{val}</div>
                  </div>
                ))
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
