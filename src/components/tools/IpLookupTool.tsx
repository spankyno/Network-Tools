import React, { useState, useEffect, useRef, useCallback } from 'react';
import { useQuery } from '@tanstack/react-query';
import { fetchIp } from '../../lib/api';
import { IpResponse, ToolId } from '../../types/network';
import { saveHistoryItem } from '../../lib/history';
import { useToast } from '../Toast';
import {
  MapPin,
  Search,
  RefreshCw,
  Copy,
  Globe,
  Wifi,
  Navigation,
  Check,
  Layers,
  Maximize2,
  AlertCircle,
  ExternalLink,
} from 'lucide-react';
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';

const EXAMPLES = ['1.1.1.1', '8.8.8.8', '208.67.222.222', '140.82.121.4'];

interface IpLookupToolProps {
  initialQuery?: string;
  onRunQuery?: (tool: ToolId, query: string, extra?: string) => void;
}

type MapLayerType = 'osm' | 'hot' | 'carto';

export const IpLookupTool: React.FC<IpLookupToolProps> = ({
  initialQuery = '',
  onRunQuery,
}) => {
  const [ipInput, setIpInput] = useState(initialQuery);
  const [activeQuery, setActiveQuery] = useState(initialQuery);
  const [copied, setCopied] = useState(false);
  const [activeLayer, setActiveLayer] = useState<MapLayerType>('osm');

  const mapContainerRef = useRef<HTMLDivElement | null>(null);
  const mapInstanceRef = useRef<L.Map | null>(null);
  const markerRef = useRef<L.Marker | null>(null);
  const tileLayerRef = useRef<L.TileLayer | null>(null);

  const { toast } = useToast();

  // Sincronizar initialQuery SOLO cuando cambia desde el exterior (ej. clic en historial),
  // evitando que re-renders de componentes padres reinicien búsquedas locales del usuario.
  const prevInitialQueryRef = useRef(initialQuery);
  useEffect(() => {
    if (initialQuery !== undefined && initialQuery !== prevInitialQueryRef.current) {
      prevInitialQueryRef.current = initialQuery;
      setIpInput(initialQuery);
      setActiveQuery(initialQuery);
    }
  }, [initialQuery]);

  const { data, isLoading, isError, error, refetch, isFetching } = useQuery<IpResponse>({
    queryKey: ['ip', activeQuery],
    queryFn: async () => {
      const res = await fetchIp(activeQuery);
      saveHistoryItem('ip', res.ip);
      if (onRunQuery) onRunQuery('ip', res.ip);
      return res;
    },
    staleTime: 60000,
    // Mantener datos anteriores durante la nueva búsqueda para que el mapa no se desmonte del DOM
    placeholderData: (previousData) => previousData,
  });

  const handleSearch = (e?: React.FormEvent) => {
    if (e) e.preventDefault();
    const query = ipInput.trim();
    if (query === activeQuery) {
      refetch();
    } else {
      setActiveQuery(query);
    }
  };

  const handleMyIp = () => {
    setIpInput('');
    if (activeQuery === '') {
      refetch();
    } else {
      setActiveQuery('');
    }
  };

  const copyDetails = () => {
    if (!data) return;
    const txt = `Dirección IP: ${data.ip} (${data.version})\nUbicación: ${data.city}, ${data.region}, ${data.country} (${data.countryCode})\nISP: ${data.isp}\nOrganización: ${data.org}\nASN: ${data.as}\nCoordenadas: ${data.lat}, ${data.lon}`;
    navigator.clipboard.writeText(txt);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
    toast('Geolocalización copiada al portapapeles', 'success');
  };

  // Configuración de capas OpenStreetMap
  const getTileConfig = (layer: MapLayerType) => {
    switch (layer) {
      case 'hot':
        return {
          url: 'https://{s}.tile.openstreetmap.fr/hot/{z}/{x}/{y}.png',
          attribution:
            '&copy; <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noreferrer">OpenStreetMap</a> contributors, Tiles style by Humanitarian OpenStreetMap Team',
          maxZoom: 19,
        };
      case 'carto':
        return {
          url: 'https://{s}.basemaps.cartocdn.com/rastertiles/voyager/{z}/{x}/{y}{r}.png',
          attribution:
            '&copy; <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noreferrer">OpenStreetMap</a> contributors &copy; <a href="https://carto.com/attributions" target="_blank" rel="noreferrer">CARTO</a>',
          maxZoom: 19,
        };
      case 'osm':
      default:
        return {
          url: 'https://tile.openstreetmap.org/{z}/{x}/{y}.png',
          attribution:
            '&copy; <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noreferrer">OpenStreetMap</a> contributors',
          maxZoom: 19,
        };
    }
  };

  // Cambiar capa de tiles dinámicamente sin recrear el mapa
  const handleLayerChange = (layer: MapLayerType) => {
    setActiveLayer(layer);
    if (!mapInstanceRef.current) return;

    if (tileLayerRef.current) {
      mapInstanceRef.current.removeLayer(tileLayerRef.current);
    }

    const config = getTileConfig(layer);
    const newTileLayer = L.tileLayer(config.url, {
      maxZoom: config.maxZoom,
      attribution: config.attribution,
    }).addTo(mapInstanceRef.current);

    tileLayerRef.current = newTileLayer;
  };

  // Inicializar o actualizar el mapa Leaflet con capa OpenStreetMap pura
  const renderMap = useCallback(() => {
    if (!data || !mapContainerRef.current) return;

    const rawLat = typeof data.lat === 'number' ? data.lat : parseFloat(String(data.lat || 0));
    const rawLon = typeof data.lon === 'number' ? data.lon : parseFloat(String(data.lon || 0));
    const lat = !isNaN(rawLat) ? rawLat : 0;
    const lon = !isNaN(rawLon) ? rawLon : 0;

    const isZeroCoords = Math.abs(lat) < 0.0001 && Math.abs(lon) < 0.0001;

    // Pin de localización nítido en SVG para Leaflet con anchor exacto en la punta inferior
    const customPinIcon = L.divIcon({
      className: 'custom-osm-pin',
      html: `
        <div style="position: relative; width: 32px; height: 36px;">
          <!-- Sombra base -->
          <div style="position: absolute; bottom: 0; left: 50%; transform: translateX(-50%); width: 14px; height: 6px; background: rgba(0,0,0,0.35); border-radius: 50%; filter: blur(1.5px);"></div>
          <!-- Marcador Pin SVG -->
          <svg width="32" height="36" viewBox="0 0 32 36" fill="none" xmlns="http://www.w3.org/2000/svg">
            <path d="M16 0C7.16344 0 0 7.16344 0 16C0 26.5 16 36 16 36C16 36 32 26.5 32 16C32 7.16344 24.8366 0 16 0Z" fill="#ef4444"/>
            <path d="M16 1C7.71573 1 1 7.71573 1 16C1 25.8 16 34.8 16 34.8C16 34.8 31 25.8 31 16C31 7.71573 24.2843 1 16 1Z" stroke="#ffffff" stroke-width="2"/>
            <circle cx="16" cy="15" r="6" fill="#ffffff"/>
            <circle cx="16" cy="15" r="3" fill="#ef4444"/>
          </svg>
        </div>
      `,
      iconSize: [32, 36],
      iconAnchor: [16, 36],
      popupAnchor: [0, -36],
    });

    const popupHtml = `
      <div style="padding: 4px 2px; min-width: 170px;">
        <div style="font-weight: 700; font-size: 13px; color: #f8fafc; margin-bottom: 3px;">
          ${data.city || 'Ubicación'}${data.country ? `, ${data.country}` : ''}
        </div>
        <div style="font-family: monospace; font-size: 12px; color: #38bdf8; margin-bottom: 2px;">
          ${data.ip} (${data.version || 'IPv4'})
        </div>
        <div style="font-size: 11px; color: #94a3b8;">
          ${data.isp || data.org || ''}
        </div>
        <div style="font-family: monospace; font-size: 10px; color: #64748b; margin-top: 4px; border-top: 1px solid #334155; padding-top: 3px;">
          ${!isZeroCoords ? `${lat.toFixed(4)}, ${lon.toFixed(4)}` : 'Ubicación regional'}
        </div>
      </div>
    `;

    try {
      // 1. Verificar si el mapa existente sigue vinculado al contenedor actual del DOM
      if (mapInstanceRef.current) {
        try {
          const currentContainer = mapInstanceRef.current.getContainer();
          if (
            !mapContainerRef.current ||
            currentContainer !== mapContainerRef.current ||
            !document.body.contains(currentContainer)
          ) {
            mapInstanceRef.current.remove();
            mapInstanceRef.current = null;
            tileLayerRef.current = null;
            markerRef.current = null;
          }
        } catch {
          mapInstanceRef.current = null;
        }
      }

      // 2. Limpiar residuos de id de Leaflet en el contenedor si el mapa es nulo
      if (!mapInstanceRef.current && mapContainerRef.current) {
        if ((mapContainerRef.current as any)._leaflet_id) {
          delete (mapContainerRef.current as any)._leaflet_id;
        }
      }

      // 3. Crear mapa si no existe
      if (!mapInstanceRef.current && mapContainerRef.current) {
        const map = L.map(mapContainerRef.current, {
          center: [lat, lon],
          zoom: isZeroCoords ? 3 : 12,
          zoomControl: false,
          attributionControl: true,
          scrollWheelZoom: true,
        });

        // Controles de zoom
        L.control.zoom({ position: 'topleft' }).addTo(map);

        // Capa base seleccionada
        const config = getTileConfig(activeLayer);
        const tileLayer = L.tileLayer(config.url, {
          maxZoom: config.maxZoom,
          attribution: config.attribution,
        }).addTo(map);

        tileLayerRef.current = tileLayer;

        // Marcador del host
        const marker = L.marker([lat, lon], { icon: customPinIcon }).addTo(map);
        marker.bindPopup(popupHtml).openPopup();

        mapInstanceRef.current = map;
        markerRef.current = marker;
      } else if (mapInstanceRef.current) {
        // 4. Si el mapa ya existe y está activo, actualizar coordenadas suavemente
        const map = mapInstanceRef.current;
        const targetZoom = isZeroCoords ? 3 : 12;

        map.setView([lat, lon], targetZoom, { animate: true });

        if (markerRef.current) {
          markerRef.current.setLatLng([lat, lon]);
          markerRef.current.setIcon(customPinIcon);
          markerRef.current.setPopupContent(popupHtml).openPopup();
        } else {
          const marker = L.marker([lat, lon], { icon: customPinIcon }).addTo(map);
          marker.bindPopup(popupHtml).openPopup();
          markerRef.current = marker;
        }
      }

      // 5. InvalidateSize diferido para garantizar renderizado perfecto de tiles
      setTimeout(() => {
        if (mapInstanceRef.current) {
          mapInstanceRef.current.invalidateSize();
        }
      }, 50);

      setTimeout(() => {
        if (mapInstanceRef.current) {
          mapInstanceRef.current.invalidateSize();
        }
      }, 250);
    } catch (err) {
      console.error('Error al inicializar o actualizar mapa Leaflet OSM:', err);
    }
  }, [data, activeLayer]);

  useEffect(() => {
    renderMap();
  }, [renderMap]);

  // ResizeObserver para invalidar tamaño cuando el contenedor o ventana cambian de dimensión
  useEffect(() => {
    if (!mapContainerRef.current) return;

    const observer = new ResizeObserver(() => {
      if (mapInstanceRef.current) {
        mapInstanceRef.current.invalidateSize();
      }
    });

    observer.observe(mapContainerRef.current);

    return () => {
      observer.disconnect();
    };
  }, []);

  // Limpieza al desmontar componente
  useEffect(() => {
    return () => {
      if (mapInstanceRef.current) {
        try {
          mapInstanceRef.current.remove();
        } catch {
          // ignore
        }
        mapInstanceRef.current = null;
        tileLayerRef.current = null;
        markerRef.current = null;
      }
    };
  }, []);

  const handleCenterMap = () => {
    if (mapInstanceRef.current && data) {
      const rawLat = typeof data.lat === 'number' ? data.lat : parseFloat(String(data.lat || 0));
      const rawLon = typeof data.lon === 'number' ? data.lon : parseFloat(String(data.lon || 0));
      const lat = !isNaN(rawLat) ? rawLat : 0;
      const lon = !isNaN(rawLon) ? rawLon : 0;
      const isZeroCoords = Math.abs(lat) < 0.0001 && Math.abs(lon) < 0.0001;
      mapInstanceRef.current.setView([lat, lon], isZeroCoords ? 3 : 12, { animate: true });
      markerRef.current?.openPopup();
      mapInstanceRef.current.invalidateSize();
    }
  };

  return (
    <div className="space-y-6">
      {/* Barra de Búsqueda */}
      <div className="rounded-xl border border-slate-800 bg-slate-900/70 p-5 backdrop-blur-sm">
        <form onSubmit={handleSearch} className="flex flex-col sm:flex-row gap-3">
          <div className="relative flex-1">
            <div className="absolute inset-y-0 left-0 pl-3.5 flex items-center pointer-events-none text-slate-500">
              <MapPin className="w-4 h-4 text-violet-400" />
            </div>
            <input
              type="text"
              value={ipInput}
              onChange={(e) => setIpInput(e.target.value)}
              placeholder="Introduzca IP o dominio (ej. 1.1.1.1 o deje vacío para su IP pública)..."
              className="w-full pl-10 pr-4 py-2.5 rounded-lg border border-slate-700/80 bg-slate-950/80 text-sm font-mono text-slate-100 placeholder:text-slate-500 focus:outline-none focus:ring-2 focus:ring-violet-500 focus:border-transparent transition-all"
            />
          </div>
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={handleMyIp}
              className="px-4 py-2.5 rounded-lg border border-slate-700 bg-slate-800/80 hover:bg-slate-700 text-slate-200 text-sm font-medium transition-colors whitespace-nowrap flex items-center gap-1.5"
            >
              <Navigation className="w-3.5 h-3.5 text-violet-400" />
              <span>Mi IP</span>
            </button>
            <button
              type="submit"
              disabled={isFetching}
              className="flex items-center justify-center gap-2 px-6 py-2.5 rounded-lg bg-violet-600 hover:bg-violet-500 text-white text-sm font-semibold transition-colors disabled:opacity-50 whitespace-nowrap shadow-sm shadow-violet-500/20"
            >
              {isFetching ? (
                <RefreshCw className="w-4 h-4 animate-spin" />
              ) : (
                <Search className="w-4 h-4" />
              )}
              <span>Localizar IP</span>
            </button>
          </div>
        </form>

        <div className="mt-4 pt-4 border-t border-slate-800/80 flex items-center gap-2 text-xs text-slate-500 flex-wrap">
          <span>Ejemplos rápidos:</span>
          {EXAMPLES.map((ex) => (
            <button
              key={ex}
              type="button"
              onClick={() => {
                setIpInput(ex);
                if (ex === activeQuery) {
                  refetch();
                } else {
                  setActiveQuery(ex);
                }
              }}
              className="text-slate-400 hover:text-violet-400 transition-colors underline decoration-slate-700 hover:decoration-violet-400 font-mono"
            >
              {ex}
            </button>
          ))}
        </div>
      </div>

      {/* Esqueleto de Carga Inicial (solo si aún no hay datos en absoluto) */}
      {isLoading && !data && (
        <div className="rounded-xl border border-slate-800 bg-slate-900/40 p-6 space-y-4 animate-pulse">
          <div className="h-6 w-48 bg-slate-800 rounded"></div>
          <div className="grid grid-cols-1 lg:grid-cols-12 gap-5">
            <div className="lg:col-span-5 space-y-4">
              <div className="h-40 bg-slate-800/50 rounded-xl"></div>
              <div className="h-36 bg-slate-800/50 rounded-xl"></div>
            </div>
            <div className="lg:col-span-7 h-[460px] bg-slate-800/60 rounded-xl"></div>
          </div>
        </div>
      )}

      {/* Estado de Error */}
      {isError && !data && (
        <div className="rounded-xl border border-red-500/30 bg-red-950/20 p-6 text-slate-200 animate-in fade-in">
          <div className="flex items-center gap-2 text-red-400 font-semibold mb-2">
            <AlertCircle className="w-5 h-5" />
            <span>Error en la geolocalización</span>
          </div>
          <p className="text-sm text-slate-300">
            {(error as any)?.message || 'No se pudo geolocalizar la IP. Compruebe la conectividad o formato de la dirección.'}
          </p>
          <button
            onClick={() => refetch()}
            className="mt-3 px-3 py-1.5 rounded bg-slate-800 hover:bg-slate-700 text-xs font-medium text-slate-200 transition-colors"
          >
            Reintentar Búsqueda
          </button>
        </div>
      )}

      {/* Resultados y Mapa Leaflet con Capa OSM (Se mantiene montado durante búsquedas) */}
      {data && (
        <div className="space-y-5 animate-in fade-in slide-in-from-bottom-2 duration-300">
          {/* Barra de Metadatos */}
          <div className="flex flex-wrap items-center justify-between gap-4 text-xs text-slate-400 px-1">
            <div className="flex items-center gap-2 font-mono flex-wrap">
              <span className="text-sm font-semibold text-slate-100">{data.ip}</span>
              <span aria-hidden="true">·</span>
              <span className="text-violet-400 font-bold">{data.version}</span>
              <span aria-hidden="true">·</span>
              <span className="text-slate-300">
                {data.city}, {data.region}, {data.country} ({data.countryCode})
              </span>
              {data.providerUsed && (
                <>
                  <span aria-hidden="true">·</span>
                  <span className="text-slate-500">Proveedor: {data.providerUsed}</span>
                </>
              )}
            </div>
            <button
              onClick={copyDetails}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded bg-slate-800 hover:bg-slate-700 border border-slate-700 text-xs text-slate-200 transition-colors"
            >
              {copied ? <Check className="w-3.5 h-3.5 text-emerald-400" /> : <Copy className="w-3.5 h-3.5" />}
              <span>{copied ? 'Copiado' : 'Copiar Datos'}</span>
            </button>
          </div>

          <div className="grid grid-cols-1 lg:grid-cols-12 gap-5">
            {/* Columna de Datos */}
            <div className="lg:col-span-5 space-y-4">
              {/* Tarjeta Geográfica */}
              <div className="rounded-xl border border-slate-800 bg-slate-900/60 p-5 space-y-3">
                <div className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wider text-slate-400 font-mono">
                  <Globe className="w-4 h-4 text-violet-400" />
                  <span>Ubicación Geográfica</span>
                </div>
                <div className="grid grid-cols-2 gap-3 text-xs">
                  <div>
                    <span className="text-slate-500 block mb-0.5">País</span>
                    <span className="text-slate-200 font-medium">
                      {data.country} ({data.countryCode})
                    </span>
                  </div>
                  <div>
                    <span className="text-slate-500 block mb-0.5">Región / Estado</span>
                    <span className="text-slate-200 font-medium">{data.region || 'N/A'}</span>
                  </div>
                  <div>
                    <span className="text-slate-500 block mb-0.5">Ciudad</span>
                    <span className="text-slate-200 font-medium">{data.city || 'N/A'}</span>
                  </div>
                  <div>
                    <span className="text-slate-500 block mb-0.5">Código Postal</span>
                    <span className="text-slate-200 font-mono">{data.zip || 'N/A'}</span>
                  </div>
                  <div>
                    <span className="text-slate-500 block mb-0.5">Latitud / Longitud</span>
                    <span className="text-slate-200 font-mono tabular-nums">
                      {(() => {
                        const rawLat = typeof data.lat === 'number' ? data.lat : parseFloat(String(data.lat || 0));
                        const rawLon = typeof data.lon === 'number' ? data.lon : parseFloat(String(data.lon || 0));
                        if (!isNaN(rawLat) && !isNaN(rawLon) && (rawLat !== 0 || rawLon !== 0)) {
                          return `${rawLat.toFixed(4)}, ${rawLon.toFixed(4)}`;
                        }
                        return 'Ubicación regional';
                      })()}
                    </span>
                  </div>
                  <div>
                    <span className="text-slate-500 block mb-0.5">Zona Horaria</span>
                    <span className="text-slate-200 font-mono">{data.timezone}</span>
                  </div>
                </div>
              </div>

              {/* Tarjeta de ISP y Red */}
              <div className="rounded-xl border border-slate-800 bg-slate-900/60 p-5 space-y-3">
                <div className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wider text-slate-400 font-mono">
                  <Wifi className="w-4 h-4 text-violet-400" />
                  <span>Red y Sistema Autónomo (ASN)</span>
                </div>
                <div className="space-y-2 text-xs">
                  <div>
                    <span className="text-slate-500 block mb-0.5">Proveedor de Internet (ISP)</span>
                    <span className="text-slate-100 font-medium">{data.isp || 'Desconocido'}</span>
                  </div>
                  <div>
                    <span className="text-slate-500 block mb-0.5">Organización</span>
                    <span className="text-slate-300 font-medium">{data.org || data.isp}</span>
                  </div>
                  <div>
                    <span className="text-slate-500 block mb-0.5">Sistema Autónomo (ASN)</span>
                    <span className="text-slate-200 font-mono text-[11px] break-all">{data.as || 'N/A'}</span>
                  </div>
                </div>
              </div>

              {/* Heurística de Infraestructura */}
              <div className="rounded-xl border border-slate-800 bg-slate-900/60 p-4">
                <div className="text-xs font-semibold uppercase tracking-wider text-slate-400 font-mono mb-3">
                  Heurística de Infraestructura
                </div>
                <div className="grid grid-cols-3 gap-2 text-center text-xs">
                  <div className="p-2.5 rounded bg-slate-950/60 border border-slate-800/80">
                    <span className="text-slate-500 block text-[10px] mb-1">Datacenter</span>
                    <span className={`font-mono font-semibold ${data.isHosting ? 'text-cyan-400' : 'text-slate-400'}`}>
                      {data.isHosting ? 'SÍ' : 'NO'}
                    </span>
                  </div>
                  <div className="p-2.5 rounded bg-slate-950/60 border border-slate-800/80">
                    <span className="text-slate-500 block text-[10px] mb-1">VPN / Proxy</span>
                    <span className={`font-mono font-semibold ${data.isProxy ? 'text-amber-400' : 'text-slate-400'}`}>
                      {data.isProxy ? 'DETECTADA' : 'LIMPIA'}
                    </span>
                  </div>
                  <div className="p-2.5 rounded bg-slate-950/60 border border-slate-800/80">
                    <span className="text-slate-500 block text-[10px] mb-1">Red Móvil</span>
                    <span className={`font-mono font-semibold ${data.isMobile ? 'text-indigo-400' : 'text-slate-400'}`}>
                      {data.isMobile ? 'SÍ' : 'NO'}
                    </span>
                  </div>
                </div>
              </div>
            </div>

            {/* Columna del Mapa Leaflet con Capa OpenStreetMap */}
            <div className="lg:col-span-7">
              <div className="rounded-xl border border-slate-800 bg-slate-900/60 p-4 flex flex-col h-[520px]">
                {/* Cabecera del Mapa con Selector de Capa OpenStreetMap */}
                <div className="flex flex-wrap items-center justify-between gap-3 text-xs text-slate-400 mb-3">
                  <div className="flex items-center gap-2">
                    <MapPin className="w-3.5 h-3.5 text-red-500" />
                    <span className="font-semibold text-slate-200">Mapa Leaflet con OpenStreetMap (OSM)</span>
                  </div>

                  <div className="flex items-center gap-1.5">
                    {/* Selector de capas OSM */}
                    <div className="flex items-center gap-1 p-0.5 bg-slate-950 rounded-lg border border-slate-800">
                      <button
                        type="button"
                        onClick={() => handleLayerChange('osm')}
                        className={`px-2 py-0.5 rounded text-[11px] font-mono transition-colors ${
                          activeLayer === 'osm'
                            ? 'bg-slate-800 text-cyan-400 font-bold'
                            : 'text-slate-400 hover:text-white'
                        }`}
                        title="OpenStreetMap Estándar"
                      >
                        OSM Estándar
                      </button>
                      <button
                        type="button"
                        onClick={() => handleLayerChange('hot')}
                        className={`px-2 py-0.5 rounded text-[11px] font-mono transition-colors ${
                          activeLayer === 'hot'
                            ? 'bg-slate-800 text-cyan-400 font-bold'
                            : 'text-slate-400 hover:text-white'
                        }`}
                        title="OpenStreetMap Humanitario"
                      >
                        OSM Humanitario
                      </button>
                      <button
                        type="button"
                        onClick={() => handleLayerChange('carto')}
                        className={`px-2 py-0.5 rounded text-[11px] font-mono transition-colors ${
                          activeLayer === 'carto'
                            ? 'bg-slate-800 text-cyan-400 font-bold'
                            : 'text-slate-400 hover:text-white'
                        }`}
                        title="CARTO Voyager con base OSM"
                      >
                        Voyager
                      </button>
                    </div>

                    <button
                      type="button"
                      onClick={handleCenterMap}
                      className="px-2.5 py-1 rounded bg-slate-800 hover:bg-slate-700 text-slate-200 border border-slate-700 text-[11px] font-mono transition-colors flex items-center gap-1"
                      title="Centrar en las coordenadas del host"
                    >
                      <Maximize2 className="w-3 h-3 text-cyan-400" />
                      <span>Centrar</span>
                    </button>
                  </div>
                </div>

                {/* Contenedor del Mapa Leaflet */}
                <div className="relative w-full flex-1 rounded-lg overflow-hidden border border-slate-800 bg-slate-950 shadow-inner">
                  {/* Badge de carga flotante cuando se realiza una búsqueda secundaria */}
                  {isFetching && (
                    <div className="absolute top-3 left-3 z-[600] px-3 py-1.5 rounded-lg bg-slate-950/85 backdrop-blur-md border border-slate-700/80 text-xs font-mono text-cyan-300 flex items-center gap-2 shadow-lg">
                      <RefreshCw className="w-3.5 h-3.5 animate-spin text-cyan-400" />
                      <span>Actualizando mapa...</span>
                    </div>
                  )}

                  <div
                    ref={mapContainerRef}
                    className="w-full h-full min-h-[440px]"
                    style={{ zIndex: 1 }}
                  ></div>

                  {/* Badge inferior con coordenadas */}
                  <div className="absolute bottom-2 left-2 z-[500] px-2 py-1 rounded bg-slate-900/90 backdrop-blur-sm border border-slate-800 text-[10px] font-mono text-slate-300 pointer-events-none shadow">
                    {(() => {
                      const rawLat = typeof data.lat === 'number' ? data.lat : parseFloat(String(data.lat || 0));
                      const rawLon = typeof data.lon === 'number' ? data.lon : parseFloat(String(data.lon || 0));
                      if (!isNaN(rawLat) && !isNaN(rawLon) && (rawLat !== 0 || rawLon !== 0)) {
                        return `Coordenadas: ${rawLat.toFixed(4)}, ${rawLon.toFixed(4)}`;
                      }
                      return 'Ubicación regional aproximada';
                    })()}
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
