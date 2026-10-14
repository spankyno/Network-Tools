import React, { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { fetchDnssec } from '../../lib/api';
import { DnssecResponse, ToolId } from '../../types/network';
import { saveHistoryItem } from '../../lib/history';
import { useToast } from '../Toast';
import { ShieldCheck, ShieldAlert, ShieldX, Search, RefreshCw, Copy, Check, Key, Link2, Layers } from 'lucide-react';

const EXAMPLES = ['cloudflare.com', 'ietf.org', 'nic.es', 'icann.org'];

interface DnssecToolProps {
  initialQuery?: string;
  onRunQuery?: (tool: ToolId, query: string, extra?: string) => void;
}

export const DnssecTool: React.FC<DnssecToolProps> = ({
  initialQuery = 'cloudflare.com',
  onRunQuery,
}) => {
  const [domain, setDomain] = useState(initialQuery);
  const [activeDomain, setActiveDomain] = useState(initialQuery);
  const [copied, setCopied] = useState(false);

  const { toast } = useToast();

  const { data, isLoading, isError, error, refetch, isFetching } = useQuery<DnssecResponse>({
    queryKey: ['dnssec', activeDomain],
    queryFn: async () => {
      if (!activeDomain) throw new Error('El dominio es obligatorio');
      const res = await fetchDnssec(activeDomain);
      saveHistoryItem('dnssec', activeDomain);
      if (onRunQuery) onRunQuery('dnssec', activeDomain);
      return res;
    },
    enabled: Boolean(activeDomain),
    staleTime: 60000,
  });

  const handleSearch = (e?: React.FormEvent) => {
    if (e) e.preventDefault();
    const clean = domain.trim().toLowerCase().replace(/^https?:\/\//i, '').replace(/\/.*$/, '');
    if (!clean) return;
    setActiveDomain(clean);
  };

  const copySummary = () => {
    if (!data) return;
    const txt = `Dominio: ${data.domain}\nEstado DNSSEC: ${data.validationStatus}\nMensaje: ${data.statusMessage}\nClaves DNSKEY: ${data.keys.length}\nRegistros DS: ${data.dsRecords.length}`;
    navigator.clipboard.writeText(txt);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
    toast('Resumen DNSSEC copiado al portapapeles', 'success');
  };

  return (
    <div className="space-y-6">
      {/* Barra de Búsqueda */}
      <div className="rounded-xl border border-slate-800 bg-slate-900/70 p-5 backdrop-blur-sm">
        <form onSubmit={handleSearch} className="flex flex-col sm:flex-row gap-3">
          <div className="relative flex-1">
            <div className="absolute inset-y-0 left-0 pl-3.5 flex items-center pointer-events-none text-slate-500">
              <ShieldCheck className="w-4 h-4 text-emerald-400" />
            </div>
            <input
              type="text"
              value={domain}
              onChange={(e) => setDomain(e.target.value)}
              placeholder="Introduzca dominio a auditar (ej. cloudflare.com, ietf.org)..."
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
            <span>Auditar DNSSEC</span>
          </button>
        </form>

        <div className="mt-4 pt-4 border-t border-slate-800/80 flex items-center gap-2 text-xs text-slate-500">
          <span>Ejemplos con DNSSEC:</span>
          {EXAMPLES.map((ex) => (
            <button
              key={ex}
              type="button"
              onClick={() => {
                setDomain(ex);
                setActiveDomain(ex);
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
          <div className="h-20 bg-slate-800/60 rounded-xl"></div>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div className="h-44 bg-slate-800/50 rounded-xl"></div>
            <div className="h-44 bg-slate-800/50 rounded-xl"></div>
          </div>
        </div>
      )}

      {/* Estado de Error */}
      {isError && (
        <div className="rounded-xl border border-red-500/30 bg-red-950/20 p-6 text-slate-200">
          <p className="text-sm text-slate-300">
            {(error as any)?.message || 'No se pudo auditar DNSSEC para este dominio.'}
          </p>
          <button
            onClick={() => refetch()}
            className="mt-3 px-3 py-1.5 rounded bg-slate-800 hover:bg-slate-700 text-xs font-medium text-slate-200 transition-colors"
          >
            Reintentar Auditoría
          </button>
        </div>
      )}

      {/* Resultados DNSSEC */}
      {data && !isLoading && (
        <div className="space-y-5 animate-in fade-in slide-in-from-bottom-2 duration-300">
          {/* Banner de Estado Global */}
          <div className="rounded-xl border border-slate-800 bg-slate-900/60 p-5 flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
            <div className="flex items-center gap-3.5">
              <div
                className={`w-11 h-11 rounded-lg flex items-center justify-center ${
                  data.validationStatus === 'SECURE'
                    ? 'bg-emerald-500/20 text-emerald-400 border border-emerald-500/40'
                    : data.validationStatus === 'BOGUS'
                    ? 'bg-red-500/20 text-red-400 border border-red-500/40'
                    : 'bg-amber-500/20 text-amber-400 border border-amber-500/40'
                }`}
              >
                {data.validationStatus === 'SECURE' ? (
                  <ShieldCheck className="w-6 h-6" />
                ) : data.validationStatus === 'BOGUS' ? (
                  <ShieldX className="w-6 h-6" />
                ) : (
                  <ShieldAlert className="w-6 h-6" />
                )}
              </div>
              <div>
                <div className="flex items-center gap-2">
                  <h3 className="text-base font-bold text-slate-100 font-mono">{data.domain}</h3>
                  <span
                    className={`font-mono text-xs font-semibold px-2 py-0.5 rounded ${
                      data.validationStatus === 'SECURE'
                        ? 'bg-emerald-500/20 text-emerald-400'
                        : data.validationStatus === 'BOGUS'
                        ? 'bg-red-500/20 text-red-400'
                        : 'bg-amber-500/20 text-amber-400'
                    }`}
                  >
                    {data.validationStatus === 'SECURE'
                      ? 'DNSSEC SEGURO'
                      : data.validationStatus === 'BOGUS'
                      ? 'DNSSEC CORRUPTO / INVÁLIDO'
                      : 'DNSSEC NO HABILITADO'}
                  </span>
                </div>
                <p className="text-xs text-slate-400 mt-1">{data.statusMessage}</p>
              </div>
            </div>

            <button
              onClick={copySummary}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded bg-slate-800 hover:bg-slate-700 border border-slate-700 text-xs text-slate-200 transition-colors shrink-0"
            >
              {copied ? <Check className="w-3.5 h-3.5 text-emerald-400" /> : <Copy className="w-3.5 h-3.5" />}
              <span>{copied ? 'Copiado' : 'Copiar Resumen'}</span>
            </button>
          </div>

          {/* Cadena de Confianza */}
          <div className="rounded-xl border border-slate-800 bg-slate-900/60 p-5 space-y-3">
            <div className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wider text-slate-400 font-mono">
              <Layers className="w-4 h-4 text-emerald-400" />
              <span>Cadena de Confianza Criptográfica (Chain of Trust)</span>
            </div>
            <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
              {data.chain.map((c, idx) => (
                <div key={idx} className="p-3.5 rounded-lg bg-slate-950/60 border border-slate-800 space-y-1 text-xs">
                  <span className="text-slate-500 block text-[11px] font-mono">Nivel {idx + 1}</span>
                  <span className="font-semibold text-slate-200 block truncate">{c.level}</span>
                  <span className="font-mono text-xs text-emerald-400">{c.status}</span>
                  {c.algorithm && <span className="block text-slate-500 text-[10px]">{c.algorithm}</span>}
                </div>
              ))}
            </div>
          </div>

          {/* Claves DNSKEY y Registros DS */}
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">
            {/* Claves DNSKEY */}
            <div className="rounded-xl border border-slate-800 bg-slate-900/60 p-5 space-y-3">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wider text-slate-400 font-mono">
                  <Key className="w-4 h-4 text-emerald-400" />
                  <span>Claves DNSKEY ({data.keys.length})</span>
                </div>
              </div>
              {data.keys.length === 0 ? (
                <p className="text-xs text-slate-500 italic py-4">No se detectaron registros DNSKEY en la zona.</p>
              ) : (
                <div className="space-y-2.5 font-mono text-xs">
                  {data.keys.map((k, i) => (
                    <div key={i} className="p-3 rounded-lg bg-slate-950/60 border border-slate-800 space-y-1.5">
                      <div className="flex items-center justify-between gap-2">
                        <span className="text-cyan-400 font-semibold">{k.type}</span>
                        <span className="text-slate-500 text-[11px] tabular-nums">TTL: {k.TTL}s</span>
                      </div>
                      <div className="text-[11px] text-slate-300">
                        <span className="text-slate-500">Algoritmo:</span> {k.algorithm}
                      </div>
                      <div className="text-[10px] text-slate-400 break-all bg-slate-900/80 p-1.5 rounded border border-slate-800/80">
                        {k.publicKey.slice(0, 48)}...
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>

            {/* Registros DS Delegados */}
            <div className="rounded-xl border border-slate-800 bg-slate-900/60 p-5 space-y-3">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wider text-slate-400 font-mono">
                  <Link2 className="w-4 h-4 text-emerald-400" />
                  <span>Registros DS Delegados ({data.dsRecords.length})</span>
                </div>
              </div>
              {data.dsRecords.length === 0 ? (
                <p className="text-xs text-slate-500 italic py-4">No se encontraron registros DS en el TLD padre.</p>
              ) : (
                <div className="space-y-2.5 font-mono text-xs">
                  {data.dsRecords.map((d, i) => (
                    <div key={i} className="p-3 rounded-lg bg-slate-950/60 border border-slate-800 space-y-1.5">
                      <div className="flex items-center justify-between gap-2">
                        <span className="text-slate-200 font-semibold">Key Tag: {d.keyTag}</span>
                        <span className="text-slate-500 text-[11px] tabular-nums">Tipo: {d.digestType}</span>
                      </div>
                      <div className="text-[10px] text-slate-300 break-all bg-slate-900/80 p-1.5 rounded border border-slate-800/80">
                        {d.digest}
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
