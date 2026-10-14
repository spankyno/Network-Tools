import React from 'react';
import { Activity, Clock, Moon, Sun, Wifi, WifiOff } from 'lucide-react';
import { ToolId } from '../types/network';
import { TOOL_REGISTRY } from '../tools/registry';
import { PWAInstallButton } from './PWAInstallButton';
import { useOnlineStatus } from '../hooks/useOnlineStatus';

interface HeaderProps {
  activeTool: ToolId | 'home' | 'about' | 'privacy';
  onSelectTool: (tool: ToolId | 'home' | 'about' | 'privacy') => void;
  historyCount: number;
  onOpenHistory: () => void;
  isDark: boolean;
  onToggleTheme: () => void;
}

export const Header: React.FC<HeaderProps> = ({
  activeTool,
  onSelectTool,
  historyCount,
  onOpenHistory,
  isDark,
  onToggleTheme,
}) => {
  const isOnline = useOnlineStatus();

  // Herramientas prioritarias para la barra de navegación superior (4-5 enlaces directos)
  const navTools: ToolId[] = ['dns', 'propagation', 'dnssec', 'ssl', 'ip', 'ports'];

  return (
    <header className="sticky top-0 z-40 w-full border-b border-slate-800/80 bg-slate-950/85 backdrop-blur-md transition-colors">
      <div className="max-w-7xl mx-auto flex items-center justify-between gap-8 px-4 sm:px-6 h-16">
        {/* Zona 1: Logotipo / Marca */}
        <button
          onClick={() => onSelectTool('home')}
          className="flex items-center gap-2.5 text-left group focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cyan-500 rounded-md py-1"
        >
          <div className="w-8 h-8 rounded-lg bg-cyan-500/10 border border-cyan-500/30 flex items-center justify-center text-cyan-400 group-hover:border-cyan-400/60 transition-colors">
            <Activity className="w-4 h-4" />
          </div>
          <div className="flex flex-col">
            <span className="text-base font-bold tracking-tight text-slate-100 group-hover:text-white transition-colors whitespace-nowrap">
              Network Tools Hub
            </span>
          </div>
        </button>

        {/* Zona 2: Enlaces de Navegación Directa (Texto conciso, sin pills) */}
        <nav className="hidden lg:flex items-center gap-6 text-xs uppercase tracking-wider font-medium text-slate-400">
          {navTools.map((tId) => {
            const tool = TOOL_REGISTRY.find((t) => t.id === tId);
            if (!tool) return null;
            return (
              <button
                key={tId}
                onClick={() => onSelectTool(tId)}
                className={`transition-colors whitespace-nowrap ${
                  activeTool === tId ? 'text-cyan-400 font-semibold' : 'hover:text-slate-200'
                }`}
              >
                {tool.shortName}
              </button>
            );
          })}
          <button
            onClick={() => onSelectTool('home')}
            className={`transition-colors whitespace-nowrap text-cyan-400/80 hover:text-cyan-300 font-semibold`}
          >
            + Más Herramientas
          </button>
          <button
            onClick={() => onSelectTool('about')}
            className={`transition-colors whitespace-nowrap ${
              activeTool === 'about' ? 'text-cyan-400 font-semibold' : 'hover:text-slate-200'
            }`}
          >
            Acerca de
          </button>
        </nav>

        {/* Zona 3: Acciones Primarias (PWA Install + Historial + Tema) */}
        <div className="flex items-center gap-2 sm:gap-3 shrink-0">
          {/* Indicador de Conexión en línea */}
          <div
            className={`hidden sm:flex items-center gap-1.5 px-2 py-1 rounded text-[11px] font-mono ${
              isOnline ? 'text-emerald-400/80' : 'text-amber-400/90'
            }`}
            title={isOnline ? 'Conexión a internet activa' : 'Trabajando sin conexión'}
          >
            {isOnline ? <Wifi className="w-3.5 h-3.5" /> : <WifiOff className="w-3.5 h-3.5 text-amber-400" />}
            <span className="text-[10px]">{isOnline ? 'Online' : 'Offline'}</span>
          </div>

          <PWAInstallButton />

          {/* Botón de Historial */}
          <button
            onClick={onOpenHistory}
            className="flex items-center gap-2 px-3 py-1.5 rounded-lg border border-slate-800 bg-slate-900/60 hover:bg-slate-800/80 text-slate-300 hover:text-white transition-all text-xs font-medium whitespace-nowrap"
            title="Historial de consultas y favoritos"
          >
            <Clock className="w-3.5 h-3.5 text-cyan-400" />
            <span className="hidden sm:inline">Historial</span>
            {historyCount > 0 && (
              <span className="font-mono text-[10px] bg-cyan-500/20 text-cyan-300 px-1.5 py-0.2 rounded font-semibold tabular-nums">
                {historyCount}
              </span>
            )}
          </button>

          {/* Selector de Modo Claro/Oscuro */}
          <button
            onClick={onToggleTheme}
            className="p-2 rounded-lg border border-slate-800 bg-slate-900/60 hover:bg-slate-800/80 text-slate-300 hover:text-white transition-colors"
            title={isDark ? 'Cambiar a modo claro' : 'Cambiar a modo oscuro'}
            aria-label="Alternar tema"
          >
            {isDark ? <Sun className="w-4 h-4 text-amber-400" /> : <Moon className="w-4 h-4 text-slate-400" />}
          </button>
        </div>
      </div>
    </header>
  );
};
