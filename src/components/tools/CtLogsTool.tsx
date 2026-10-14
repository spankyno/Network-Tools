import React, { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { fetchCtLogs } from '../../lib/api';
import { CtLogsResponse, ToolId } from '../../types/network';
import { saveHistoryItem } from '../../lib/history';
import { useToast } from '../Toast';
import { FileSearch, Search, RefreshCw, Copy, Check, Shield, Layers, Globe, Filter } from 'lucide-react';

const EXAMPLES = ['github.com', 'cloudflare.com', 'tesla.com', 'stripe.com'];

interface CtLogsToolProps {
  initialQuery?: string;
  onRunQuery?: (tool: ToolId, query: string, extra?: string) => void;
}

export const CtLogsTool: React.FC<CtLogsToolProps> = ({
  initialQuery = 'github.com',
  onRunQuery,
}) => {
  const [domain, setDomain] = useState(initialQuery);
  const [activeDomain, setActiveDomain] = useState(initialQuery);
  const [subdomainFilter, setSubdomainFilter] = useState('');
  const [viewTab, setViewTab] = useState<'subdomains' | 'certificates'>('subdomains');
  const [copied, setCopied] = useState(false);

  const { toast } = useToast();

  const { data, isLoading, isError, error, refetch, isFetching } = useQuery<CtLogsResponse>({
    queryKey: ['ctlogs', activeDomain],
    queryFn: async () => {
      if (!activeDomain) throw new Error('El dominio es obligatorio');
      const res = await fetchCtLogs(activeDomain);
      saveHistoryItem('ctlogs', activeDomain);
      if (onRunQuery) onRunQuery('ctlogs', activeDomain);
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

  const copySubdomains = () => {
    if (!data) return;
    navigator.clipboard.writeText(data.subdomains.join('\n'));
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
    toast(`${data.subdomains.length} subdominios copiados`, 'success');
  };

  const filteredSubdomains = data?.subdomains.filter((s) =>
    s.toLowerCase().includes(subdomainFilter.toLowerCase())
  );

  return (
    <div className="space-y-6">
      {/* Barra de Búsqueda */}
      <div className="rounded-xl border border-slate-800 bg-slate-900/70 p-5 backdrop-blur-sm">
        <form onSubmit={handleSearch} className="flex flex-col sm:flex-row gap-3">
          <div className="relative flex-1">
            <div className="absolute inset-y-0 left-0 pl-3.5 flex items-center pointer-events-none text-slate-500">
              <FileSearch className="w-4 h-4 text-cyan-400" />
            </div>
            <input
              type="text"
              value={domain}
              onChange={(e) => setDomain(e.target.value)}
              placeholder="Introduzca dominio a buscar en CT Logs (ej. github.com)..."
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
            <span>Buscar en CT Logs</span>
          </button>
        </form>

        <div className="mt-4 pt-4 border-t border-slate-800/80 flex items-center gap-2 text-xs text-slate-500">
          <span>Ejemplos:</span>
          {EXAMPLES.map((ex) => (
            <button
              key={ex}
              type="button"
              onClick={() => {
                setDomain(ex);
                setActiveDomain(ex);
              }}
              className="text-slate-400 hover:text-cyan-400 transition-colors underline decoration-slate-700 hover:decoration-cyan-400 font-mono"
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
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
            <div className="h-20 bg-slate-800/50 rounded-lg"></div>
            <div className="h-20 bg-slate-800/50 rounded-lg"></div>
            <div className="h-20 bg-slate-800/50 rounded-lg"></div>
          </div>
          <div className="h-64 bg-slate-800/60 rounded-xl"></div>
        </div>
      )}

      {/* Error state */}
      {isError && (
        <div className="rounded-xl border border-red-500/30 bg-red-950/20 p-6 text-slate-200">
          <p className="text-sm text-slate-300">
            {(error as any)?.message || 'Error al consultar logs de Transparencia de Certificados (crt.sh). El servicio externo puede estar saturado.'}
          </p>
          <button
            onClick={() => refetch()}
            className="mt-3 px-3 py-1.5 rounded bg-slate-800 hover:bg-slate-700 text-xs font-medium text-slate-200 transition-colors"
          >
            Reintentar Consulta
          </button>
        </div>
      )}

      {/* Resultados */}
      {data && !isLoading && (
        <div className="space-y-5 animate-in fade-in slide-in-from-bottom-2 duration-300">
          {/* Métricas Principales */}
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
            <div className="p-4 rounded-xl border border-slate-800 bg-slate-900/60 space-y-1">
              <span className="text-xs font-mono text-slate-500">Subdominios Descubiertos</span>
              <div className="text-2xl font-bold font-mono text-cyan-400 tabular-nums">
                {data.discoveredSubdomains}
              </div>
            </div>
            <div className="p-4 rounded-xl border border-slate-800 bg-slate-900/60 space-y-1">
              <span className="text-xs font-mono text-slate-500">Certificados Auditados</span>
              <div className="text-2xl font-bold font-mono text-slate-100 tabular-nums">
                {data.uniqueCertificates}
              </div>
            </div>
            <div className="p-4 rounded-xl border border-slate-800 bg-slate-900/60 space-y-1">
              <span className="text-xs font-mono text-slate-500">Total Entradas en CT Log</span>
              <div className="text-2xl font-bold font-mono text-emerald-400 tabular-nums">
                {data.totalFound}
              </div>
            </div>
          </div>

          {/* Vistas y Filtro */}
          <div className="rounded-xl border border-slate-800 bg-slate-900/60 overflow-hidden">
            <div className="p-4 border-b border-slate-800 flex flex-col sm:flex-row items-stretch sm:items-center justify-between gap-3 bg-slate-950/40">
              <div className="flex items-center gap-1 p-1 bg-slate-950 rounded-lg border border-slate-800">
                <button
                  onClick={() => setViewTab('subdomains')}
                  className={`px-3 py-1 text-xs font-medium rounded-md transition-colors ${
                    viewTab === 'subdomains' ? 'bg-slate-800 text-cyan-400 font-semibold' : 'text-slate-400 hover:text-slate-200'
                  }`}
                >
                  Subdominios ({data.discoveredSubdomains})
                </button>
                <button
                  onClick={() => setViewTab('certificates')}
                  className={`px-3 py-1 text-xs font-medium rounded-md transition-colors ${
                    viewTab === 'certificates' ? 'bg-slate-800 text-cyan-400 font-semibold' : 'text-slate-400 hover:text-slate-200'
                  }`}
                >
                  Certificados ({data.certificates.length})
                </button>
              </div>

              {viewTab === 'subdomains' && (
                <div className="flex items-center gap-2">
                  <div className="relative flex-1 sm:w-56">
                    <input
                      type="text"
                      value={subdomainFilter}
                      onChange={(e) => setSubdomainFilter(e.target.value)}
                      placeholder="Filtrar subdominios..."
                      className="w-full px-3 py-1.5 rounded-lg border border-slate-700/80 bg-slate-950 text-xs font-mono text-slate-200 placeholder:text-slate-500 focus:outline-none focus:ring-1 focus:ring-cyan-500"
                    />
                  </div>
                  <button
                    onClick={copySubdomains}
                    className="flex items-center gap-1.5 px-3 py-1.5 rounded bg-slate-800 hover:bg-slate-700 border border-slate-700 text-xs text-slate-200 transition-colors whitespace-nowrap"
                  >
                    {copied ? <Check className="w-3.5 h-3.5 text-emerald-400" /> : <Copy className="w-3.5 h-3.5" />}
                    <span>Copiar Lista</span>
                  </button>
                </div>
              )}
            </div>

            {/* Contenido según pestaña */}
            {viewTab === 'subdomains' ? (
              <div className="p-4 grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-2 max-h-[500px] overflow-y-auto">
                {filteredSubdomains && filteredSubdomains.length > 0 ? (
                  filteredSubdomains.map((sub, i) => (
                    <div
                      key={i}
                      className="p-2.5 rounded-lg bg-slate-950/60 border border-slate-800 font-mono text-xs text-slate-200 truncate hover:border-slate-700 transition-colors select-all"
                      title={sub}
                    >
                      {sub}
                    </div>
                  ))
                ) : (
                  <div className="col-span-full py-8 text-center text-xs text-slate-500">
                    No se encontraron subdominios con el filtro aplicado.
                  </div>
                )}
              </div>
            ) : (
              <div className="divide-y divide-slate-800/60 max-h-[500px] overflow-y-auto font-mono text-xs">
                {data.certificates.map((cert) => (
                  <div key={cert.id} className="p-4 hover:bg-slate-800/40 transition-colors space-y-1">
                    <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2">
                      <span className="font-semibold text-slate-100">{cert.commonName || 'Certificado Común'}</span>
                      <span className="text-[11px] text-slate-500 tabular-nums">
                        Registro CT: {new Date(cert.loggedAt).toLocaleDateString()}
                      </span>
                    </div>
                    <div className="text-[11px] text-slate-400 truncate">
                      <span className="text-slate-500">Emisor:</span> {cert.issuerName}
                    </div>
                    <div className="text-[10px] text-slate-500 flex items-center gap-3 pt-1">
                      <span>Validez: {new Date(cert.notBefore).toLocaleDateString()} al {new Date(cert.notAfter).toLocaleDateString()}</span>
                      <span>·</span>
                      <span className="truncate">Serie: {cert.serialNumber}</span>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
};
