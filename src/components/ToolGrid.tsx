import React, { useState } from 'react';
import { ToolId } from '../types/network';
import { TOOL_REGISTRY, ToolCategory } from '../tools/registry';
import { Search, ArrowRight, Zap, ShieldCheck } from 'lucide-react';

interface ToolGridProps {
  onSelectTool: (tool: ToolId, query?: string) => void;
}

export const ToolGrid: React.FC<ToolGridProps> = ({ onSelectTool }) => {
  const [quickSearch, setQuickSearch] = useState('');
  const [selectedCategory, setSelectedCategory] = useState<ToolCategory | 'all'>('all');

  const handleQuickLaunch = (e: React.FormEvent, tool: ToolId = 'dns') => {
    e.preventDefault();
    const clean = quickSearch.trim().toLowerCase().replace(/^https?:\/\//i, '').replace(/\/.*$/, '');
    onSelectTool(tool, clean || undefined);
  };

  const filteredTools = TOOL_REGISTRY.filter((t) => {
    if (selectedCategory === 'all') return true;
    return t.category === selectedCategory;
  });

  return (
    <div className="space-y-10 py-4">
      {/* Sección Hero */}
      <div className="text-center max-w-3xl mx-auto space-y-4">
        <h1 className="text-3xl sm:text-4xl lg:text-5xl font-bold tracking-tight text-slate-100 text-balance">
          Diagnósticos de Red Profesionales en una Sola Interfaz
        </h1>
        <p className="text-sm sm:text-base text-slate-400 leading-relaxed max-w-2xl mx-auto">
          Resolución DoH, propagación mundial, validación DNSSEC, inspección TLS/SSL, geolocalización IP con mapas interactivos, traceroute visual y comprobación de puertos TCP.
        </p>

        {/* Buscador Rápido Unificado */}
        <form
          onSubmit={(e) => handleQuickLaunch(e, 'dns')}
          className="pt-2 max-w-xl mx-auto flex flex-col sm:flex-row items-center gap-2"
        >
          <div className="relative w-full">
            <div className="absolute inset-y-0 left-0 pl-3.5 flex items-center pointer-events-none text-slate-500">
              <Search className="w-4 h-4 text-cyan-400" />
            </div>
            <input
              type="text"
              value={quickSearch}
              onChange={(e) => setQuickSearch(e.target.value)}
              placeholder="Introduzca dominio o IP (ej. cloudflare.com, 1.1.1.1)..."
              className="w-full pl-10 pr-4 py-2.5 rounded-lg border border-slate-700/80 bg-slate-900/90 text-sm font-mono text-slate-100 placeholder:text-slate-500 focus:outline-none focus:ring-2 focus:ring-cyan-500 transition-all shadow-lg"
            />
          </div>
          <button
            type="submit"
            className="w-full sm:w-auto px-5 py-2.5 rounded-lg bg-cyan-500 hover:bg-cyan-400 text-slate-950 font-semibold text-sm transition-colors whitespace-nowrap shadow-sm shadow-cyan-500/20"
          >
            Iniciar Diagnóstico
          </button>
        </form>

        <div className="text-xs text-slate-500 flex items-center justify-center gap-3 pt-1">
          <span>Consultas de ejemplo:</span>
          {['cloudflare.com', 'github.com', '1.1.1.1'].map((target) => (
            <button
              key={target}
              type="button"
              onClick={() => onSelectTool('dns', target)}
              className="text-slate-400 hover:text-cyan-400 transition-colors font-mono underline decoration-slate-800 hover:decoration-cyan-400"
            >
              {target}
            </button>
          ))}
        </div>
      </div>

      {/* Selector de Categorías */}
      <div className="flex items-center justify-center gap-1.5 flex-wrap p-1 max-w-2xl mx-auto bg-slate-900/80 rounded-xl border border-slate-800">
        <button
          onClick={() => setSelectedCategory('all')}
          className={`px-3.5 py-1.5 text-xs font-medium rounded-lg transition-colors ${
            selectedCategory === 'all'
              ? 'bg-slate-800 text-cyan-400 font-bold shadow-sm'
              : 'text-slate-400 hover:text-slate-200'
          }`}
        >
          Todas ({TOOL_REGISTRY.length})
        </button>
        <button
          onClick={() => setSelectedCategory('dns')}
          className={`px-3.5 py-1.5 text-xs font-medium rounded-lg transition-colors ${
            selectedCategory === 'dns'
              ? 'bg-slate-800 text-cyan-400 font-bold shadow-sm'
              : 'text-slate-400 hover:text-slate-200'
          }`}
        >
          DNS y Dominios
        </button>
        <button
          onClick={() => setSelectedCategory('security')}
          className={`px-3.5 py-1.5 text-xs font-medium rounded-lg transition-colors ${
            selectedCategory === 'security'
              ? 'bg-slate-800 text-cyan-400 font-bold shadow-sm'
              : 'text-slate-400 hover:text-slate-200'
          }`}
        >
          Seguridad y TLS
        </button>
        <button
          onClick={() => setSelectedCategory('network')}
          className={`px-3.5 py-1.5 text-xs font-medium rounded-lg transition-colors ${
            selectedCategory === 'network'
              ? 'bg-slate-800 text-cyan-400 font-bold shadow-sm'
              : 'text-slate-400 hover:text-slate-200'
          }`}
        >
          Red e IP
        </button>
        <button
          onClick={() => setSelectedCategory('web')}
          className={`px-3.5 py-1.5 text-xs font-medium rounded-lg transition-colors ${
            selectedCategory === 'web'
              ? 'bg-slate-800 text-cyan-400 font-bold shadow-sm'
              : 'text-slate-400 hover:text-slate-200'
          }`}
        >
          Protocolos Web
        </button>
      </div>

      {/* Grilla de Herramientas Dinámica desde TOOL_REGISTRY */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-5">
        {filteredTools.map((tool) => {
          const IconComp = tool.icon;
          return (
            <div
              key={tool.id}
              onClick={() => onSelectTool(tool.id, quickSearch.trim() || undefined)}
              className="group rounded-xl border border-slate-800 bg-slate-900/50 hover:bg-slate-900/90 hover:border-slate-700 transition-all duration-200 p-5 cursor-pointer flex flex-col justify-between shadow-sm hover:shadow-md animate-in fade-in"
            >
              <div>
                <div className="flex items-center justify-between gap-3 mb-3">
                  <div className="w-10 h-10 rounded-lg bg-slate-800/80 border border-slate-700/60 flex items-center justify-center group-hover:scale-105 transition-transform text-cyan-400">
                    <IconComp className="w-5 h-5" />
                  </div>
                  <span className="text-[11px] font-mono font-medium text-slate-400">
                    {tool.badge}
                  </span>
                </div>

                <h3 className="text-base font-semibold text-slate-100 group-hover:text-cyan-400 transition-colors">
                  {tool.name}
                </h3>
                <p className="text-xs text-slate-500 font-mono mt-0.5">{tool.subtitle}</p>

                <p className="text-xs text-slate-400 mt-2.5 leading-relaxed line-clamp-3">
                  {tool.description}
                </p>
              </div>

              <div className="mt-5 pt-3.5 border-t border-slate-800/60 flex items-center justify-between">
                <div className="flex items-center gap-2 text-[11px] text-slate-500 font-mono truncate">
                  {tool.tags.join(' · ')}
                </div>
                <div className="text-slate-500 group-hover:text-cyan-400 group-hover:translate-x-0.5 transition-all">
                  <ArrowRight className="w-4 h-4" />
                </div>
              </div>
            </div>
          );
        })}
      </div>

      {/* Información de Arquitectura y Hoja de Ruta */}
      <div className="rounded-xl border border-slate-800/80 bg-slate-900/30 p-6 space-y-4">
        <div className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wider text-slate-400 font-mono">
          <Zap className="w-4 h-4 text-cyan-400" />
          <span>Arquitectura y Próximas Capacidades</span>
        </div>
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4 text-xs text-slate-400">
          <div className="p-3 rounded-lg bg-slate-950/40 border border-slate-800/60 space-y-1">
            <span className="text-slate-200 font-semibold block">v1.1 · Enlaces Compartibles</span>
            <p className="text-[11px] leading-relaxed text-slate-400">
              Permalinks únicos para auditorías compartidas, exportación PDF de reportes y sincronización en la nube.
            </p>
          </div>
          <div className="p-3 rounded-lg bg-slate-950/40 border border-slate-800/60 space-y-1">
            <span className="text-slate-200 font-semibold block">v1.2 · Monitoreo y MTR</span>
            <p className="text-[11px] leading-relaxed text-slate-400">
              MTR continuo en tiempo real, tablas de enrutamiento BGP y validación criptográfica RPKI.
            </p>
          </div>
          <div className="p-3 rounded-lg bg-slate-950/40 border border-slate-800/60 space-y-1">
            <span className="text-slate-200 font-semibold block">v2.0 · Alertas Automatizadas</span>
            <p className="text-[11px] leading-relaxed text-slate-400">
              Alertas de expiración SSL/TLS programadas, webhooks de cambio DNS y API REST pública sin cuotas.
            </p>
          </div>
        </div>
      </div>
    </div>
  );
};
