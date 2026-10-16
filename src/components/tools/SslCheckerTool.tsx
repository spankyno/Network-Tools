import React, { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { fetchSsl } from '../../lib/api';
import { SslResponse, ToolId } from '../../types/network';
import { saveHistoryItem } from '../../lib/history';
import { useToast } from '../Toast';
import { Shield, Search, RefreshCw, Copy, Check, CheckCircle2, AlertTriangle, XCircle, Lock, KeyRound, Layers, Link2 } from 'lucide-react';
import { LimitedNotice } from '../LimitedNotice';

const EXAMPLES = ['github.com', 'cloudflare.com', 'google.com', 'wikipedia.org'];

interface SslCheckerToolProps {
  initialQuery?: string;
  onRunQuery?: (tool: ToolId, query: string, extra?: string) => void;
}

export const SslCheckerTool: React.FC<SslCheckerToolProps> = ({
  initialQuery = 'github.com',
  onRunQuery,
}) => {
  const [host, setHost] = useState(initialQuery);
  const [port, setPort] = useState('443');
  const [activeQuery, setActiveQuery] = useState({ host: initialQuery, port: 443 });
  const [copied, setCopied] = useState(false);

  const { toast } = useToast();

  const { data, isLoading, isError, error, refetch, isFetching } = useQuery<SslResponse>({
    queryKey: ['ssl', activeQuery.host, activeQuery.port],
    queryFn: async () => {
      if (!activeQuery.host) throw new Error('El nombre de host es obligatorio');
      const res = await fetchSsl(activeQuery.host, activeQuery.port);
      saveHistoryItem('ssl', activeQuery.host, String(activeQuery.port));
      if (onRunQuery) onRunQuery('ssl', activeQuery.host, String(activeQuery.port));
      return res;
    },
    enabled: Boolean(activeQuery.host),
    staleTime: 60000,
  });

  const handleSearch = (e?: React.FormEvent) => {
    if (e) e.preventDefault();
    const clean = host.trim().toLowerCase().replace(/^https?:\/\//i, '').replace(/\/.*$/, '').replace(/:\d+$/, '');
    if (!clean) return;
    const p = parseInt(port, 10) || 443;
    setActiveQuery({ host: clean, port: p });
  };

  const copyReport = () => {
    if (!data) return;
    const txt = `Host: ${data.host}:${data.port}\nEmisor: ${data.issuer.commonName} (${data.issuer.organization})\nSujeto: ${data.subject.commonName}\nVálido desde: ${data.validFrom}\nVálido hasta: ${data.validTo}\nDías restantes: ${data.daysRemaining}\nProtocolo: ${data.protocol}\nCifrado: ${data.cipher?.name || 'N/A'}`;
    navigator.clipboard.writeText(txt);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
    toast('Reporte SSL copiado al portapapeles', 'success');
  };

  const formatDate = (dateStr: string) => {
    try {
      return new Date(dateStr).toLocaleDateString('es-ES', {
        year: 'numeric',
        month: 'short',
        day: 'numeric',
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
              <Shield className="w-4 h-4 text-emerald-400" />
            </div>
            <input
              type="text"
              value={host}
              onChange={(e) => setHost(e.target.value)}
              placeholder="Introduzca host (ej. github.com, cloudflare.com)..."
              className="w-full pl-10 pr-4 py-2.5 rounded-lg border border-slate-700/80 bg-slate-950/80 text-sm font-mono text-slate-100 placeholder:text-slate-500 focus:outline-none focus:ring-2 focus:ring-emerald-500 focus:border-transparent transition-all"
            />
          </div>
          <div className="w-24">
            <input
              type="number"
              value={port}
              onChange={(e) => setPort(e.target.value)}
              placeholder="Puerto"
              className="w-full px-3 py-2.5 rounded-lg border border-slate-700/80 bg-slate-950/80 text-sm font-mono text-slate-100 placeholder:text-slate-500 focus:outline-none focus:ring-2 focus:ring-emerald-500 text-center"
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
            <span>Inspeccionar SSL</span>
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
                setActiveQuery({ host: ex, port: 443 });
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
          <div className="h-6 w-52 bg-slate-800 rounded"></div>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            <div className="h-28 bg-slate-800/50 rounded-lg"></div>
            <div className="h-28 bg-slate-800/50 rounded-lg"></div>
            <div className="h-28 bg-slate-800/50 rounded-lg"></div>
          </div>
        </div>
      )}

      {/* Error */}
      {isError && (
        <div className="rounded-xl border border-red-500/30 bg-red-950/20 p-6 text-slate-200 animate-in fade-in">
          <p className="text-sm text-slate-300">
            {(error as any)?.message || 'No se pudo establecer la conexión TLS segura con el host en el puerto indicado.'}
          </p>
          <button
            onClick={() => refetch()}
            className="mt-3 px-3 py-1.5 rounded bg-slate-800 hover:bg-slate-700 text-xs font-medium text-slate-200 transition-colors"
          >
            Reintentar Handshake
          </button>
        </div>
      )}

      {/* Resultados */}
      {data && !isLoading && (
        <div className="space-y-5 animate-in fade-in slide-in-from-bottom-2 duration-300">
          <LimitedNotice message={data.notice} />
          {/* Encabezado */}
          <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4 p-5 rounded-xl border border-slate-800 bg-slate-900/60">
            <div className="flex items-center gap-3">
              <div
                className={`w-10 h-10 rounded-lg flex items-center justify-center ${
                  data.isExpired
                    ? 'bg-red-500/20 text-red-400 border border-red-500/40'
                    : data.daysRemaining < 30
                    ? 'bg-amber-500/20 text-amber-400 border border-amber-500/40'
                    : 'bg-emerald-500/20 text-emerald-400 border border-emerald-500/40'
                }`}
              >
                {data.isExpired ? (
                  <XCircle className="w-5 h-5" />
                ) : data.daysRemaining < 30 ? (
                  <AlertTriangle className="w-5 h-5" />
                ) : (
                  <CheckCircle2 className="w-5 h-5" />
                )}
              </div>
              <div>
                <div className="flex items-center gap-2">
                  <h3 className="text-sm font-semibold text-slate-100 font-mono">
                    {data.subject.commonName || data.host}
                  </h3>
                  <span
                    className={`text-xs font-mono font-semibold ${
                      data.isExpired
                        ? 'text-red-400'
                        : data.daysRemaining < 15
                        ? 'text-red-400'
                        : data.daysRemaining < 30
                        ? 'text-amber-400'
                        : 'text-emerald-400'
                    }`}
                  >
                    {data.isExpired
                      ? 'EXPIRADO'
                      : data.daysRemaining < 15
                      ? 'EXPIRACIÓN CRÍTICA'
                      : data.daysRemaining < 30
                      ? 'EXPIRA PRONTO'
                      : 'VÁLIDO Y DE CONFIANZA'}
                  </span>
                </div>
                <div className="text-xs text-slate-400 mt-0.5 flex items-center gap-2">
                  <span>Emitido por {data.issuer.commonName || data.issuer.organization}</span>
                  <span aria-hidden="true">·</span>
                  <span className="font-mono tabular-nums text-slate-200">
                    {data.daysRemaining > 0 ? `${data.daysRemaining} días restantes` : 'Expirado'}
                  </span>
                </div>
              </div>
            </div>

            <button
              onClick={copyReport}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded bg-slate-800 hover:bg-slate-700 border border-slate-700 text-xs text-slate-200 transition-colors"
            >
              {copied ? <Check className="w-3.5 h-3.5 text-emerald-400" /> : <Copy className="w-3.5 h-3.5" />}
              <span>{copied ? 'Copiado' : 'Copiar Reporte'}</span>
            </button>
          </div>

          {/* Grilla de Detalles */}
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            {/* Validez */}
            <div className="rounded-xl border border-slate-800 bg-slate-900/60 p-5 space-y-3">
              <div className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wider text-slate-400 font-mono">
                <Lock className="w-4 h-4 text-emerald-400" />
                <span>Período de Validez</span>
              </div>
              <div className="space-y-2 text-xs">
                <div>
                  <span className="text-slate-500 block">Válido Desde</span>
                  <span className="text-slate-200 font-mono tabular-nums">{formatDate(data.validFrom)}</span>
                </div>
                <div>
                  <span className="text-slate-500 block">Válido Hasta</span>
                  <span className="text-slate-100 font-mono tabular-nums font-semibold">
                    {formatDate(data.validTo)}
                  </span>
                </div>
                <div>
                  <span className="text-slate-500 block">Tiempo Restante</span>
                  <span className="text-emerald-400 font-mono tabular-nums font-bold text-sm">
                    {data.daysRemaining} días
                  </span>
                </div>
              </div>
            </div>

            {/* Criptografía */}
            <div className="rounded-xl border border-slate-800 bg-slate-900/60 p-5 space-y-3">
              <div className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wider text-slate-400 font-mono">
                <KeyRound className="w-4 h-4 text-emerald-400" />
                <span>Cifrado y Protocolo</span>
              </div>
              <div className="space-y-2 text-xs">
                <div>
                  <span className="text-slate-500 block">Protocolo TLS Negociado</span>
                  <span className="text-slate-200 font-mono font-semibold">{data.protocol}</span>
                </div>
                <div>
                  <span className="text-slate-500 block">Suite de Cifrado</span>
                  <span className="text-slate-200 font-mono text-[11px] break-all">
                    {data.cipher?.name || 'AES Estándar'}
                  </span>
                </div>
                <div>
                  <span className="text-slate-500 block">Latencia Handshake</span>
                  <span className="text-slate-200 font-mono tabular-nums">{data.durationMs}ms</span>
                </div>
              </div>
            </div>

            {/* Autoridad Emisora */}
            <div className="rounded-xl border border-slate-800 bg-slate-900/60 p-5 space-y-3">
              <div className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wider text-slate-400 font-mono">
                <Shield className="w-4 h-4 text-emerald-400" />
                <span>Autoridad Certificadora (CA)</span>
              </div>
              <div className="space-y-2 text-xs">
                <div>
                  <span className="text-slate-500 block">Nombre Común (CN)</span>
                  <span className="text-slate-200 font-medium">{data.issuer.commonName || 'N/A'}</span>
                </div>
                <div>
                  <span className="text-slate-500 block">Organización (O)</span>
                  <span className="text-slate-300">{data.issuer.organization || 'N/A'}</span>
                </div>
                <div>
                  <span className="text-slate-500 block">País</span>
                  <span className="text-slate-300 font-mono">{data.issuer.country || 'N/A'}</span>
                </div>
              </div>
            </div>
          </div>

          {/* Cadena de Certificados */}
          <div className="rounded-xl border border-slate-800 bg-slate-900/60 p-5 space-y-3">
            <div className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wider text-slate-400 font-mono">
              <Layers className="w-4 h-4 text-emerald-400" />
              <span>Cadena de Confianza ({data.chain.length} Certificados)</span>
            </div>
            <div className="space-y-2 font-mono text-xs">
              {data.chain.map((c, i) => (
                <div
                  key={i}
                  className="p-3 rounded-lg bg-slate-950/60 border border-slate-800/80 flex flex-col sm:flex-row sm:items-center justify-between gap-2"
                >
                  <div className="flex items-center gap-2.5">
                    <span className="text-[10px] px-1.5 py-0.5 rounded bg-slate-800 text-slate-400">
                      {i === 0 ? 'Hoja / Servidor' : i === data.chain.length - 1 ? 'Raíz CA' : 'Intermedio'}
                    </span>
                    <span className="text-slate-200 font-medium truncate max-w-md">{c.subject}</span>
                  </div>
                  <div className="text-slate-500 text-[11px] sm:text-right">
                    <span>Válido hasta {formatDate(c.validTo)}</span>
                  </div>
                </div>
              ))}
            </div>
          </div>

          {/* Nombres Alternativos (SANs) */}
          {data.subjectAltNames && data.subjectAltNames.length > 0 && (
            <div className="rounded-xl border border-slate-800 bg-slate-900/60 p-5 space-y-3">
              <div className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wider text-slate-400 font-mono">
                <Link2 className="w-4 h-4 text-emerald-400" />
                <span>Nombres Alternativos del Sujeto ({data.subjectAltNames.length} SANs)</span>
              </div>
              <div className="flex flex-wrap gap-1.5 max-h-48 overflow-y-auto">
                {data.subjectAltNames.map((san, idx) => (
                  <span
                    key={idx}
                    className="px-2.5 py-1 rounded bg-slate-800/80 border border-slate-700/60 text-slate-300 font-mono text-xs"
                  >
                    {san}
                  </span>
                ))}
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
};
