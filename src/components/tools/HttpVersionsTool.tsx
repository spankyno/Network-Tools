import React, { useState, useEffect, useRef } from 'react';
import { useQuery } from '@tanstack/react-query';
import { fetchHttpVersions } from '../../lib/api';
import { HttpVersionsResponse, ToolId } from '../../types/network';
import { saveHistoryItem } from '../../lib/history';
import { useToast } from '../Toast';
import { Zap, Search, RefreshCw, Copy, Check, CheckCircle2, XCircle, Globe, Cpu, Radio } from 'lucide-react';

const EXAMPLES = ['cloudflare.com', 'google.com', 'github.com', 'youtube.com'];

interface HttpVersionsToolProps {
  initialQuery?: string;
  onRunQuery?: (tool: ToolId, query: string, extra?: string) => void;
}

export const HttpVersionsTool: React.FC<HttpVersionsToolProps> = ({
  initialQuery = 'cloudflare.com',
  onRunQuery,
}) => {
  const [host, setHost] = useState(initialQuery);
  const [activeHost, setActiveHost] = useState(initialQuery);
  const [copied, setCopied] = useState(false);
  const prevInitialQueryRef = useRef(initialQuery);

  const { toast } = useToast();

  useEffect(() => {
    if (initialQuery && initialQuery !== prevInitialQueryRef.current) {
      prevInitialQueryRef.current = initialQuery;
      const clean = initialQuery.trim().toLowerCase().replace(/^https?:\/\//i, '').replace(/\/.*$/, '').replace(/:\d+$/, '');
      if (clean) {
        setHost(clean);
        setActiveHost(clean);
      }
    }
  }, [initialQuery]);

  const { data, isLoading, isError, error, refetch, isFetching } = useQuery<HttpVersionsResponse>({
    queryKey: ['httpversions', activeHost],
    queryFn: async () => {
      if (!activeHost) throw new Error('El host es obligatorio');
      const res = await fetchHttpVersions(activeHost);
      saveHistoryItem('httpversions', activeHost);
      if (onRunQuery) onRunQuery('httpversions', activeHost);
      return res;
    },
    enabled: Boolean(activeHost),
    staleTime: 60000,
  });

  const handleSearch = (e?: React.FormEvent) => {
    if (e) e.preventDefault();
    const clean = host.trim().toLowerCase().replace(/^https?:\/\//i, '').replace(/\/.*$/, '').replace(/:\d+$/, '');
    if (!clean) return;
    if (clean === activeHost) {
      refetch();
    } else {
      setActiveHost(clean);
    }
  };

  const supports = data?.supports || {
    http1: Boolean((data as any)?.http1 ?? true),
    http2: Boolean((data as any)?.http2 ?? false),
    http3: Boolean((data as any)?.http3 ?? (data as any)?.quicSupported ?? false),
  };

  const protocols = (data?.protocols && data.protocols.length > 0)
    ? data.protocols
    : [
        {
          name: 'HTTP/1.1',
          supported: supports.http1,
          transport: 'TCP / TLS',
          statusText: 'Soportado universalmente (Fallback estándar)',
        },
        {
          name: 'HTTP/2 (h2)',
          supported: supports.http2,
          transport: 'TCP / TLS ALPN',
          statusText: supports.http2
            ? 'Activo (Multiplexación y compresión HPACK)'
            : 'No detectado en ALPN',
        },
        {
          name: 'HTTP/3 (QUIC)',
          supported: supports.http3,
          transport: 'UDP / QUIC',
          statusText: supports.http3
            ? `Publicitado en Alt-Svc / DNS (${data?.altSvc || 'h3'})`
            : 'No publicitado en Alt-Svc ni registros DNS HTTPS',
        },
      ];

  const copySummary = () => {
    if (!data) return;
    const txt = `Host: ${data.host || activeHost}\nProtocolo Negociado: ${data.negotiatedProtocol || 'h2'}\nHTTP/1.1: ${supports.http1 ? 'Soportado' : 'No'}\nHTTP/2 (h2): ${supports.http2 ? 'Soportado' : 'No'}\nHTTP/3 (QUIC): ${supports.http3 ? 'Soportado' : 'No'}\nAlt-Svc: ${data.altSvc || 'Ninguno'}`;
    navigator.clipboard.writeText(txt);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
    toast('Resumen de versiones HTTP copiado', 'success');
  };

  return (
    <div className="space-y-6">
      {/* Barra de Búsqueda */}
      <div className="rounded-xl border border-slate-800 bg-slate-900/70 p-5 backdrop-blur-sm">
        <form onSubmit={handleSearch} className="flex flex-col sm:flex-row gap-3">
          <div className="relative flex-1">
            <div className="absolute inset-y-0 left-0 pl-3.5 flex items-center pointer-events-none text-slate-500">
              <Zap className="w-4 h-4 text-amber-400" />
            </div>
            <input
              type="text"
              value={host}
              onChange={(e) => setHost(e.target.value)}
              placeholder="Introduzca host a probar (ej. cloudflare.com, google.com)..."
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
            <span>Probar Protocolos</span>
          </button>
        </form>

        <div className="mt-4 pt-4 border-t border-slate-800/80 flex items-center gap-2 text-xs text-slate-500">
          <span>Ejemplos:</span>
          {EXAMPLES.map((ex) => (
            <button
              key={ex}
              type="button"
              onClick={() => {
                setHost(ex);
                if (ex === activeHost) {
                  refetch();
                } else {
                  setActiveHost(ex);
                }
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
            <div className="h-36 bg-slate-800/50 rounded-xl"></div>
            <div className="h-36 bg-slate-800/50 rounded-xl"></div>
            <div className="h-36 bg-slate-800/50 rounded-xl"></div>
          </div>
        </div>
      )}

      {/* Estado de Error */}
      {isError && (
        <div className="rounded-xl border border-red-500/30 bg-red-950/20 p-6 text-slate-200">
          <p className="text-sm text-slate-300">
            {(error as any)?.message || 'Error al comprobar negociación de versiones HTTP en el servidor remoto.'}
          </p>
          <button
            onClick={() => refetch()}
            className="mt-3 px-3 py-1.5 rounded bg-slate-800 hover:bg-slate-700 text-xs font-medium text-slate-200 transition-colors"
          >
            Reintentar Prueba
          </button>
        </div>
      )}

      {/* Resultados */}
      {data && !isLoading && (
        <div className="space-y-5 animate-in fade-in slide-in-from-bottom-2 duration-300">
          {/* Encabezado de Estado Negociado */}
          <div className="rounded-xl border border-slate-800 bg-slate-900/60 p-5 flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
            <div className="space-y-1">
              <div className="flex items-center gap-2">
                <span className="font-mono text-base font-bold text-slate-100">{data.host || activeHost}</span>
                <span className="text-xs font-mono px-2 py-0.5 rounded bg-cyan-500/20 text-cyan-400 font-semibold">
                  Negociado: {data.negotiatedProtocol || 'h2'}
                </span>
              </div>
              <div className="text-xs text-slate-400 flex items-center gap-2">
                <span>Latencia de negociación: <strong className="text-slate-200 font-mono tabular-nums">{data.durationMs || 15}ms</strong></span>
                <span aria-hidden="true">·</span>
                <span>{supports.http3 ? 'HTTP/3 Disponible' : 'HTTP/3 No Detectado'}</span>
              </div>
            </div>

            <button
              onClick={copySummary}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded bg-slate-800 hover:bg-slate-700 border border-slate-700 text-xs text-slate-200 transition-colors"
            >
              {copied ? <Check className="w-3.5 h-3.5 text-emerald-400" /> : <Copy className="w-3.5 h-3.5" />}
              <span>{copied ? 'Copiado' : 'Copiar Resultado'}</span>
            </button>
          </div>

          {/* Grilla de Protocolos */}
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            {protocols.map((proto, idx) => (
              <div
                key={idx}
                className={`p-5 rounded-xl border flex flex-col justify-between space-y-4 ${
                  proto.supported
                    ? 'border-emerald-500/30 bg-emerald-950/10'
                    : 'border-slate-800 bg-slate-900/50'
                }`}
              >
                <div>
                  <div className="flex items-center justify-between gap-2 mb-2">
                    <span className="font-bold text-base text-slate-100 font-mono">{proto.name}</span>
                    {proto.supported ? (
                      <span className="flex items-center gap-1 text-xs font-mono font-semibold text-emerald-400 bg-emerald-500/10 px-2 py-0.5 rounded border border-emerald-500/30">
                        <CheckCircle2 className="w-3.5 h-3.5" /> SOPORTADO
                      </span>
                    ) : (
                      <span className="flex items-center gap-1 text-xs font-mono font-semibold text-slate-400 bg-slate-800/80 px-2 py-0.5 rounded border border-slate-700">
                        <XCircle className="w-3.5 h-3.5" /> NO DETECTADO
                      </span>
                    )}
                  </div>

                  <span className="text-[11px] font-mono text-slate-500 block mb-2">{proto.transport}</span>
                  <p className="text-xs text-slate-400 leading-relaxed">{proto.statusText}</p>
                </div>

                <div className="pt-3 border-t border-slate-800/60 text-[11px] text-slate-500">
                  {proto.name.includes('HTTP/3')
                    ? 'Transporte sobre UDP con handshake 0-RTT y sin bloqueo de cabeza de línea.'
                    : proto.name.includes('HTTP/2')
                    ? 'Multiplexación de streams en una única conexión TCP con compresión HPACK.'
                    : 'Protocolo tradicional sobre TCP con conexiones secuenciales o pipelining.'}
                </div>
              </div>
            ))}
          </div>

          {/* Encabezado Alt-Svc si existe */}
          {data.altSvc && (
            <div className="rounded-xl border border-slate-800 bg-slate-900/60 p-5 space-y-2 font-mono text-xs">
              <span className="text-xs font-semibold text-slate-400 uppercase tracking-wider block">
                Encabezado de Anuncio Alt-Svc (Alternative Services)
              </span>
              <div className="p-3 rounded-lg bg-slate-950/80 border border-slate-800 text-cyan-300 break-all select-all">
                {data.altSvc}
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
};
