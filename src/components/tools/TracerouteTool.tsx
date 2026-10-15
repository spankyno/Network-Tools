import React, { useState, useEffect, useRef } from 'react';
import { useQuery } from '@tanstack/react-query';
import { fetchTraceroute } from '../../lib/api';
import { TracerouteResponse, TracerouteProbeResult, ToolId } from '../../types/network';
import { saveHistoryItem } from '../../lib/history';
import { useToast } from '../Toast';
import {
  Route,
  Search,
  RefreshCw,
  Copy,
  Check,
  Server,
  Globe2,
  ChevronDown,
  ChevronUp,
  Terminal,
  Activity,
  ArrowRight,
  ArrowDown,
  Layers,
} from 'lucide-react';

const EXAMPLES = ['wikimedia.org', 'github.com', 'cloudflare.com', '1.1.1.1'];

function getCountryFlag(countryCode?: string): string {
  if (!countryCode || countryCode.length !== 2) return '🌐';
  const codePoints = countryCode
    .toUpperCase()
    .split('')
    .map((char) => 127397 + char.charCodeAt(0));
  return String.fromCodePoint(...codePoints);
}

interface TracerouteToolProps {
  initialQuery?: string;
  onRunQuery?: (tool: ToolId, query: string, extra?: string) => void;
}

export const TracerouteTool: React.FC<TracerouteToolProps> = ({
  initialQuery = 'wikimedia.org',
  onRunQuery,
}) => {
  const [target, setTarget] = useState(initialQuery);
  const [activeTarget, setActiveTarget] = useState(initialQuery);
  const [limit, setLimit] = useState<number>(3);
  const [activeLimit, setActiveLimit] = useState<number>(3);
  const [region, setRegion] = useState<string>('EU');
  const [activeRegion, setActiveRegion] = useState<string>('EU');
  const [copiedProbeId, setCopiedProbeId] = useState<string | null>(null);
  const [expandedProbes, setExpandedProbes] = useState<Record<string, boolean>>({});
  const [viewModes, setViewModes] = useState<Record<string, 'cli' | 'visual'>>({});
  const prevInitialQueryRef = useRef(initialQuery);

  const { toast } = useToast();

  useEffect(() => {
    if (initialQuery && initialQuery !== prevInitialQueryRef.current) {
      prevInitialQueryRef.current = initialQuery;
      const clean = initialQuery.trim().toLowerCase().replace(/^https?:\/\//i, '').replace(/\/.*$/, '').replace(/:\d+$/, '');
      if (clean) {
        setTarget(clean);
        setActiveTarget(clean);
      }
    }
  }, [initialQuery]);

  const { data, isLoading, isError, error, refetch, isFetching } = useQuery<TracerouteResponse>({
    queryKey: ['traceroute', activeTarget, activeLimit, activeRegion],
    queryFn: async () => {
      if (!activeTarget) throw new Error('El host o IP de destino es obligatorio');
      const res = await fetchTraceroute(activeTarget, activeLimit, activeRegion);
      saveHistoryItem('traceroute', activeTarget, `${activeLimit} sondas (${activeRegion})`);
      if (onRunQuery) onRunQuery('traceroute', activeTarget, `${activeLimit} sondas`);
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
    setActiveLimit(limit);
    setActiveRegion(region);
  };

  // Normalizar sondas recibidas
  const probesList: TracerouteProbeResult[] = React.useMemo(() => {
    if (data?.probes && data.probes.length > 0) {
      return data.probes;
    }
    if (data?.hops && data.hops.length > 0) {
      return [
        {
          id: 'single-probe-1',
          probe: {
            city: data.probeLocation || 'Falkenstein',
            country: data.probeCountry || 'DE',
            continent: 'EU',
            asn: 24940,
            network: data.provider || 'Hetzner Online',
          },
          destination: {
            ip: data.target,
            country: 'US',
            org: 'Destino Remoto',
          },
          stats: {
            timeMs: data.hops[data.hops.length - 1]?.rttMs || null,
            totalHops: data.totalHops || data.hops.length,
          },
          rawOutput: data.hops
            .map((h) => `${h.hop}\t${h.hostname || h.ip}\t(${h.ip})\t${h.rttMs !== null ? `${h.rttMs} ms` : '* *'}`)
            .join('\n'),
          hops: data.hops,
        },
      ];
    }
    return [];
  }, [data]);

  const toggleProbe = (probeId: string) => {
    setExpandedProbes((prev) => ({
      ...prev,
      [probeId]: prev[probeId] === undefined ? false : !prev[probeId],
    }));
  };

  const toggleViewMode = (probeId: string) => {
    setViewModes((prev) => ({
      ...prev,
      [probeId]: prev[probeId] === 'visual' ? 'cli' : 'visual',
    }));
  };

  const copyProbeOutput = (probe: TracerouteProbeResult, probeId: string) => {
    const textToCopy = probe.rawOutput || probe.hops.map((h) => `${h.hop} ${h.hostname || h.ip} (${h.ip}) ${h.rttMs ?? '*'}ms`).join('\n');
    navigator.clipboard.writeText(textToCopy);
    setCopiedProbeId(probeId);
    setTimeout(() => setCopiedProbeId(null), 2000);
    toast('Trazado de sonda copiado al portapapeles', 'success');
  };

  return (
    <div className="space-y-6">
      {/* Barra de Búsqueda y Parámetros */}
      <div className="rounded-xl border border-slate-800 bg-slate-900/70 p-5 backdrop-blur-sm">
        <form onSubmit={handleSearch} className="flex flex-col lg:flex-row gap-3">
          {/* Target Host */}
          <div className="relative flex-1">
            <div className="absolute inset-y-0 left-0 pl-3.5 flex items-center pointer-events-none text-slate-500">
              <Route className="w-4 h-4 text-emerald-400" />
            </div>
            <input
              type="text"
              value={target}
              onChange={(e) => setTarget(e.target.value)}
              placeholder="Host o IP a trazar (ej. wikimedia.org)..."
              className="w-full pl-10 pr-4 py-2.5 rounded-lg border border-slate-700/80 bg-slate-950/80 text-sm font-mono text-slate-100 placeholder:text-slate-500 focus:outline-none focus:ring-2 focus:ring-emerald-500 focus:border-transparent transition-all"
            />
          </div>

          <div className="flex items-center gap-2">
            {/* Límite de sondas (como en Globalping.io) */}
            <div className="flex items-center gap-1.5 px-3 py-2 rounded-lg border border-slate-700/80 bg-slate-950/80">
              <Layers className="w-3.5 h-3.5 text-slate-400" />
              <input
                type="number"
                min={1}
                max={5}
                value={limit}
                onChange={(e) => setLimit(Math.min(5, Math.max(1, parseInt(e.target.value, 10) || 1)))}
                title="Cantidad de sondas simultáneas"
                className="w-10 bg-transparent text-center text-sm font-mono font-bold text-slate-100 focus:outline-none"
              />
              <span className="text-[11px] text-slate-400 select-none">sondas</span>
            </div>

            {/* Selector de Región */}
            <select
              value={region}
              onChange={(e) => setRegion(e.target.value)}
              className="px-3 py-2.5 rounded-lg border border-slate-700/80 bg-slate-950/80 text-xs font-mono font-medium text-slate-200 focus:outline-none focus:ring-2 focus:ring-emerald-500 cursor-pointer"
            >
              <option value="EU">🇪🇺 Europa (EU)</option>
              <option value="world">🌐 Mundial (World)</option>
              <option value="NA">🇺🇸 Norteamérica (NA)</option>
              <option value="AS">🌏 Asia (AS)</option>
            </select>

            {/* Botón de Ejecución */}
            <button
              type="submit"
              disabled={isLoading || isFetching}
              className="flex items-center justify-center gap-2 px-5 py-2.5 rounded-lg bg-emerald-500 hover:bg-emerald-400 text-slate-950 text-sm font-bold transition-all disabled:opacity-50 whitespace-nowrap shadow-sm shadow-emerald-500/20"
            >
              {isLoading || isFetching ? (
                <RefreshCw className="w-4 h-4 animate-spin" />
              ) : (
                <Search className="w-4 h-4" />
              )}
              <span>Run Traceroute Test</span>
            </button>
          </div>
        </form>

        <div className="mt-4 pt-4 border-t border-slate-800/80 flex flex-wrap items-center justify-between gap-2 text-xs text-slate-500">
          <div className="flex items-center gap-2">
            <span>Ejemplos:</span>
            {EXAMPLES.map((ex) => (
              <button
                key={ex}
                type="button"
                onClick={() => {
                  setTarget(ex);
                  setActiveTarget(ex);
                  setActiveLimit(limit);
                  setActiveRegion(region);
                }}
                className="text-slate-400 hover:text-emerald-400 transition-colors underline decoration-slate-700 hover:decoration-emerald-400 font-mono"
              >
                {ex}
              </button>
            ))}
          </div>
          <span className="text-[11px] text-slate-400 font-mono">
            Red distribuida comunitaria Globalping · Sondas en tiempo real
          </span>
        </div>
      </div>

      {/* Esqueleto de Carga */}
      {(isLoading || isFetching) && (
        <div className="space-y-4 animate-pulse">
          {[1, 2, 3].slice(0, activeLimit).map((i) => (
            <div key={i} className="rounded-xl border border-slate-800 bg-slate-900/50 p-5 space-y-3">
              <div className="flex items-center justify-between">
                <div className="h-6 w-72 bg-slate-800 rounded"></div>
                <div className="h-6 w-36 bg-slate-800 rounded"></div>
              </div>
              <div className="h-32 bg-slate-950/80 rounded-lg"></div>
            </div>
          ))}
        </div>
      )}

      {/* Estado de Error */}
      {isError && !isLoading && (
        <div className="rounded-xl border border-red-500/30 bg-red-950/20 p-6 text-slate-200 animate-in fade-in">
          <p className="text-sm text-slate-300">
            {(error as any)?.message || 'No se pudo completar el traceroute hacia el destino desde las sondas seleccionadas.'}
          </p>
          <button
            onClick={() => refetch()}
            className="mt-3 px-3 py-1.5 rounded bg-slate-800 hover:bg-slate-700 text-xs font-medium text-slate-200 transition-colors"
          >
            Reintentar Trazado
          </button>
        </div>
      )}

      {/* Lista de Sondas Multi-Probe (diseño idéntico a Globalping) */}
      {!isLoading && !isFetching && probesList.length > 0 && (
        <div className="space-y-5 animate-in fade-in slide-in-from-bottom-2 duration-300">
          {probesList.map((probeItem, idx) => {
            const probeId = probeItem.id || `probe-${idx}`;
            const isExpanded = expandedProbes[probeId] !== false; // Abierto por defecto
            const currentMode = viewModes[probeId] || 'cli'; // CLI por defecto como en la imagen
            const probeFlag = getCountryFlag(probeItem.probe.country);
            const destFlag = getCountryFlag(probeItem.destination?.country);

            return (
              <div
                key={probeId}
                className="rounded-xl border border-slate-800 bg-slate-900/80 shadow-md hover:border-slate-700/80 transition-all overflow-hidden flex flex-col"
              >
                {/* Cabecera de la Sonda con acento verde lateral */}
                <div className="flex items-stretch border-b border-slate-800/80">
                  {/* Línea verde de estado activa */}
                  <div className="w-1.5 bg-emerald-500 self-stretch shrink-0" />

                  <div className="flex-1 p-4 sm:p-5 flex flex-col gap-3">
                    {/* Fila 1: Origen (ASN, Flag, Ubicación, Red) -> Destino (IP, Flag, Org) */}
                    <div className="flex flex-wrap items-center justify-between gap-3 text-xs">
                      {/* Grupo Origen */}
                      <div className="flex flex-wrap items-center gap-2">
                        {/* ASN Pill */}
                        {probeItem.probe.asn && (
                          <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-md bg-emerald-950/70 text-emerald-400 border border-emerald-800/60 font-mono font-semibold">
                            <Globe2 className="w-3.5 h-3.5" />
                            AS{probeItem.probe.asn}
                          </span>
                        )}

                        {/* Bandera + Ciudad, País */}
                        <div className="flex items-center gap-1.5 font-medium text-slate-200 font-sans text-xs bg-slate-800/60 border border-slate-700/70 px-2.5 py-1 rounded-md">
                          <span>{probeFlag}</span>
                          <span>
                            {probeItem.probe.city}, {probeItem.probe.country}
                          </span>
                        </div>

                        {/* Proveedor / Red (Píldora Roja/Marrón) */}
                        <span className="px-2.5 py-1 rounded-md bg-rose-950/60 text-rose-300 border border-rose-800/50 font-medium">
                          {probeItem.probe.network || 'Red Comunitaria'}
                        </span>
                      </div>

                      {/* Flecha separadora */}
                      <ArrowRight className="w-4 h-4 text-slate-600 hidden md:block shrink-0" />

                      {/* Grupo Destino */}
                      <div className="flex flex-wrap items-center gap-2">
                        {/* IP Destino */}
                        <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-md bg-slate-950 border border-slate-700/80 font-mono font-semibold text-slate-200">
                          <Server className="w-3.5 h-3.5 text-slate-400" />
                          {probeItem.destination?.ip || data?.target}
                        </span>

                        {/* Bandera Destino + País */}
                        {probeItem.destination?.country && (
                          <span className="inline-flex items-center gap-1 px-2 py-1 rounded-md bg-slate-800/60 border border-slate-700/70 font-mono text-slate-300">
                            <span>{destFlag}</span>
                            <span>{probeItem.destination.country}</span>
                          </span>
                        )}

                        {/* Organización Destino */}
                        {probeItem.destination?.org && (
                          <span className="px-2.5 py-1 rounded-md bg-slate-800/70 text-slate-200 border border-slate-700 font-medium">
                            {probeItem.destination.org}
                          </span>
                        )}
                      </div>
                    </div>

                    {/* Fila 2: Métricas (Time ms, Hops) y Acciones */}
                    <div className="flex items-center justify-between pt-1">
                      <div className="flex items-center gap-2">
                        <span className="px-3 py-1 rounded-md bg-slate-950 border border-slate-800 text-xs font-mono font-semibold text-slate-200 shadow-sm">
                          Time <strong className="text-emerald-400">{probeItem.stats.timeMs ?? '--'} ms</strong>
                        </span>
                        <span className="px-3 py-1 rounded-md bg-slate-950 border border-slate-800 text-xs font-mono font-semibold text-slate-200 shadow-sm">
                          Hops <strong className="text-cyan-400">{probeItem.stats.totalHops}</strong>
                        </span>
                      </div>

                      <div className="flex items-center gap-2">
                        {/* Alternar Vista CLI / Diagrama */}
                        <button
                          type="button"
                          onClick={() => toggleViewMode(probeId)}
                          className="flex items-center gap-1.5 px-2.5 py-1 rounded bg-slate-800 hover:bg-slate-700 text-slate-300 text-xs font-medium border border-slate-700 transition-colors"
                          title="Alternar entre salida de terminal CLI y diagrama de saltos"
                        >
                          {currentMode === 'cli' ? (
                            <>
                              <Activity className="w-3.5 h-3.5 text-cyan-400" />
                              <span className="hidden sm:inline">Ver Diagrama</span>
                            </>
                          ) : (
                            <>
                              <Terminal className="w-3.5 h-3.5 text-emerald-400" />
                              <span className="hidden sm:inline">Ver Consola CLI</span>
                            </>
                          )}
                        </button>

                        {/* Copiar salida */}
                        <button
                          type="button"
                          onClick={() => copyProbeOutput(probeItem, probeId)}
                          className="flex items-center gap-1 px-2.5 py-1 rounded bg-slate-800 hover:bg-slate-700 text-slate-300 text-xs font-medium border border-slate-700 transition-colors"
                          title="Copiar trazado al portapapeles"
                        >
                          {copiedProbeId === probeId ? (
                            <Check className="w-3.5 h-3.5 text-emerald-400" />
                          ) : (
                            <Copy className="w-3.5 h-3.5" />
                          )}
                        </button>

                        {/* Desplegable */}
                        <button
                          type="button"
                          onClick={() => toggleProbe(probeId)}
                          className="p-1 rounded bg-slate-800 hover:bg-slate-700 text-slate-400 hover:text-slate-100 border border-slate-700 transition-colors"
                          aria-label={isExpanded ? 'Contraer' : 'Expandir'}
                        >
                          {isExpanded ? <ChevronUp className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />}
                        </button>
                      </div>
                    </div>
                  </div>
                </div>

                {/* Contenido Desplegable */}
                {isExpanded && (
                  <div className="p-4 sm:p-5 bg-slate-950/90 font-mono text-xs">
                    {/* Modo 1: Terminal Raw CLI (exacto como en Globalping.io) */}
                    {currentMode === 'cli' ? (
                      <div className="rounded-lg bg-slate-950 border border-slate-800/90 p-4 text-slate-200 overflow-x-auto leading-relaxed shadow-inner">
                        <pre className="font-mono text-xs text-slate-300 whitespace-pre">
                          {probeItem.rawOutput ||
                            `traceroute to ${probeItem.destination?.ip || data?.target}, 20 hops max, 60 byte packets\n` +
                              probeItem.hops
                                .map((h) => {
                                  if (h.loss) {
                                    return `${String(h.hop).padStart(2, ' ')}  * *`;
                                  }
                                  const hostStr = h.hostname ? `${h.hostname} (${h.ip})` : `(${h.ip})`;
                                  return `${String(h.hop).padStart(2, ' ')}  ${hostStr}  ${h.rttMs ?? '*'} ms  ${h.rttMs ? (h.rttMs + 0.05).toFixed(3) : '*'} ms`;
                                })
                                .join('\n')}
                        </pre>
                      </div>
                    ) : (
                      /* Modo 2: Diagrama de Saltos con Barras de Latencia */
                      <div className="space-y-2">
                        <div className="flex items-center justify-between text-slate-400 text-xs font-sans pb-2 border-b border-slate-800 font-medium">
                          <span className="w-16">Salto</span>
                          <span className="flex-1">Dirección IP / Hostname</span>
                          <span className="w-36 text-right">Latencia RTT</span>
                        </div>

                        {probeItem.hops.map((hop, hIdx) => {
                          const maxRtt =
                            probeItem.hops.reduce((max, h) => (h.rttMs && h.rttMs > max ? h.rttMs : max), 1) || 100;

                          return (
                            <div
                              key={hIdx}
                              className="p-2.5 rounded-lg bg-slate-900/60 border border-slate-800/70 hover:border-slate-700 flex items-center justify-between gap-3 transition-colors"
                            >
                              <div className="w-16 flex items-center gap-2">
                                <span className="w-6 h-6 rounded bg-slate-800 flex items-center justify-center font-bold text-slate-300 text-[11px] tabular-nums">
                                  {hop.hop}
                                </span>
                                {hIdx < probeItem.hops.length - 1 && (
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

                                {!hop.loss && hop.rttMs !== null && (
                                  <div className="w-24 bg-slate-800 h-1.5 rounded-full overflow-hidden">
                                    <div
                                      className="bg-emerald-500 h-full rounded-full"
                                      style={{ width: `${Math.min(100, Math.max(8, (hop.rttMs / maxRtt) * 100))}%` }}
                                    ></div>
                                  </div>
                                )}
                              </div>
                            </div>
                          );
                        })}
                      </div>
                    )}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
};
