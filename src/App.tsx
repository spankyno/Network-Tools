import React, { useState, useEffect } from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { ToolId, HistoryItem } from './types/network';
import { getHistory } from './lib/history';
import { ToastProvider } from './components/Toast';
import { Header } from './components/Header';
import { HistoryModal } from './components/HistoryModal';
import { ToolGrid } from './components/ToolGrid';
import { OfflineIndicator } from './components/OfflineIndicator';
import { AboutPage } from './components/AboutPage';
import { PrivacyPage } from './components/PrivacyPage';
import { TOOL_REGISTRY, getToolDefinition } from './tools/registry';

// Componentes de las 11 Herramientas
import { DnsLookupTool } from './components/tools/DnsLookupTool';
import { DnsPropagationTool } from './components/tools/DnsPropagationTool';
import { DnssecTool } from './components/tools/DnssecTool';
import { SslCheckerTool } from './components/tools/SslCheckerTool';
import { CtLogsTool } from './components/tools/CtLogsTool';
import { HttpHeadersTool } from './components/tools/HttpHeadersTool';
import { HttpVersionsTool } from './components/tools/HttpVersionsTool';
import { IpLookupTool } from './components/tools/IpLookupTool';
import { TracerouteTool } from './components/tools/TracerouteTool';
import { PortCheckerTool } from './components/tools/PortCheckerTool';
import { WhoisLookupTool } from './components/tools/WhoisLookupTool';

import { ArrowLeft, Activity, ExternalLink } from 'lucide-react';

export type AppView = ToolId | 'home' | 'about' | 'privacy';

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      refetchOnWindowFocus: false,
      retry: 2,
    },
  },
});

function MainApp() {
  const [activeTool, setActiveTool] = useState<AppView>('home');
  const [currentQuery, setCurrentQuery] = useState<string>('');
  const [currentExtra, setCurrentExtra] = useState<string | undefined>(undefined);
  const [historyItems, setHistoryItems] = useState<HistoryItem[]>([]);
  const [isHistoryOpen, setIsHistoryOpen] = useState(false);
  const [isDark, setIsDark] = useState(true);

  // Sincronizar clase del tema claro/oscuro
  useEffect(() => {
    if (isDark) {
      document.documentElement.classList.add('dark');
      document.documentElement.classList.remove('light');
    } else {
      document.documentElement.classList.remove('dark');
      document.documentElement.classList.add('light');
    }
  }, [isDark]);

  // Cargar historial
  const refreshHistory = () => {
    setHistoryItems(getHistory());
  };

  useEffect(() => {
    refreshHistory();
  }, []);

  const handleSelectTool = (tool: AppView, query?: string) => {
    setActiveTool(tool);
    if (query !== undefined) {
      setCurrentQuery(query);
      setCurrentExtra(undefined);
    }
    window.scrollTo({ top: 0, behavior: 'smooth' });
  };

  const handleSelectFromHistory = (item: HistoryItem) => {
    setActiveTool(item.tool);
    setCurrentQuery(item.query);
    setCurrentExtra(item.extra);
    window.scrollTo({ top: 0, behavior: 'smooth' });
  };

  const handleQueryExecuted = () => {
    refreshHistory();
  };

  const isDiagnosticTool = activeTool !== 'home' && activeTool !== 'about' && activeTool !== 'privacy';
  const currentToolDef = isDiagnosticTool ? getToolDefinition(activeTool as ToolId) : null;
  const ActiveIcon = currentToolDef ? currentToolDef.icon : null;

  return (
    <div className="min-h-screen bg-slate-950 text-slate-100 flex flex-col antialiased selection:bg-cyan-500/20 selection:text-cyan-300">
      {/* Barra Superior de Navegación */}
      <Header
        activeTool={activeTool}
        onSelectTool={handleSelectTool}
        historyCount={historyItems.length}
        onOpenHistory={() => setIsHistoryOpen(true)}
        isDark={isDark}
        onToggleTheme={() => setIsDark(!isDark)}
      />

      {/* Contenedor Principal */}
      <main className="flex-1 max-w-7xl w-full mx-auto px-4 sm:px-6 py-6">
        {activeTool === 'home' && (
          <ToolGrid onSelectTool={handleSelectTool} />
        )}

        {activeTool === 'about' && (
          <AboutPage
            onBackToTools={() => handleSelectTool('home')}
            onSelectTool={(tId) => handleSelectTool(tId)}
          />
        )}

        {activeTool === 'privacy' && (
          <PrivacyPage
            onBackToTools={() => handleSelectTool('home')}
          />
        )}

        {isDiagnosticTool && (
          <div className="space-y-6">
            {/* Barra de Migas de Pan y Selector Rápido */}
            <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-4 pb-4 border-b border-slate-800">
              <div className="flex items-center gap-3">
                <button
                  onClick={() => handleSelectTool('home')}
                  className="p-1.5 rounded-lg border border-slate-800 bg-slate-900/60 hover:bg-slate-800 text-slate-400 hover:text-white transition-colors"
                  title="Volver al panel principal"
                  aria-label="Volver al panel principal"
                >
                  <ArrowLeft className="w-4 h-4" />
                </button>
                <div>
                  <div className="flex items-center gap-2">
                    {ActiveIcon && (
                      <div className="p-1 rounded bg-slate-800/80 text-cyan-400">
                        <ActiveIcon className="w-4 h-4" />
                      </div>
                    )}
                    <h2 className="text-lg font-bold text-slate-100">
                      {currentToolDef?.name}
                    </h2>
                  </div>
                  <p className="text-xs text-slate-400 mt-0.5">
                    {currentToolDef?.description}
                  </p>
                </div>
              </div>

              {/* Selector Rápido de Herramientas Dinámico */}
              <div className="flex items-center gap-1 overflow-x-auto p-1 bg-slate-900/80 rounded-lg border border-slate-800 scrollbar-none">
                {TOOL_REGISTRY.map((tool) => (
                  <button
                    key={tool.id}
                    onClick={() => handleSelectTool(tool.id, currentQuery || undefined)}
                    className={`px-2.5 py-1 text-xs font-medium rounded-md whitespace-nowrap transition-colors ${
                      activeTool === tool.id
                        ? 'bg-slate-800 text-cyan-400 font-semibold shadow-sm'
                        : 'text-slate-400 hover:text-slate-200'
                    }`}
                  >
                    {tool.shortName}
                  </button>
                ))}
              </div>
            </div>

            {/* Vista de la Herramienta Activa */}
            {activeTool === 'dns' && (
              <DnsLookupTool
                initialQuery={currentQuery || 'cloudflare.com'}
                initialType={currentExtra || 'A'}
                onRunQuery={handleQueryExecuted}
              />
            )}
            {activeTool === 'propagation' && (
              <DnsPropagationTool
                initialQuery={currentQuery || 'cloudflare.com'}
                initialType={currentExtra || 'A'}
                onRunQuery={handleQueryExecuted}
              />
            )}
            {activeTool === 'dnssec' && (
              <DnssecTool
                initialQuery={currentQuery || 'cloudflare.com'}
                onRunQuery={handleQueryExecuted}
              />
            )}
            {activeTool === 'ssl' && (
              <SslCheckerTool
                initialQuery={currentQuery || 'github.com'}
                onRunQuery={handleQueryExecuted}
              />
            )}
            {activeTool === 'ctlogs' && (
              <CtLogsTool
                initialQuery={currentQuery || 'github.com'}
                onRunQuery={handleQueryExecuted}
              />
            )}
            {activeTool === 'headers' && (
              <HttpHeadersTool
                initialQuery={currentQuery || 'https://cloudflare.com'}
                onRunQuery={handleQueryExecuted}
              />
            )}
            {activeTool === 'httpversions' && (
              <HttpVersionsTool
                initialQuery={currentQuery || 'cloudflare.com'}
                onRunQuery={handleQueryExecuted}
              />
            )}
            {activeTool === 'ip' && (
              <IpLookupTool
                initialQuery={currentQuery}
                onRunQuery={handleQueryExecuted}
              />
            )}
            {activeTool === 'traceroute' && (
              <TracerouteTool
                initialQuery={currentQuery || '1.1.1.1'}
                onRunQuery={handleQueryExecuted}
              />
            )}
            {activeTool === 'ports' && (
              <PortCheckerTool
                initialQuery={currentQuery || 'github.com'}
                onRunQuery={handleQueryExecuted}
              />
            )}
            {activeTool === 'whois' && (
              <WhoisLookupTool
                initialQuery={currentQuery || 'github.com'}
                onRunQuery={handleQueryExecuted}
              />
            )}
          </div>
        )}
      </main>

      {/* Pie de Página */}
      <footer className="border-t border-slate-800/80 bg-slate-950/90 py-8 text-xs text-slate-400 mt-auto">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 space-y-6">
          <div className="flex flex-col md:flex-row items-center justify-between gap-4 pb-6 border-b border-slate-800/60">
            <div className="flex items-center gap-3">
              <div className="w-7 h-7 rounded-lg bg-cyan-500/10 border border-cyan-500/30 flex items-center justify-center text-cyan-400">
                <Activity className="w-3.5 h-3.5" />
              </div>
              <div className="text-left">
                <span className="font-bold text-slate-200">Network Tools Hub</span>
                <span className="text-slate-500 block text-[11px]">Plataforma profesional de diagnóstico de redes e infraestructura</span>
              </div>
            </div>

            {/* Vínculos de Navegación del Footer */}
            <div className="flex flex-wrap items-center justify-center gap-x-6 gap-y-2 text-xs">
              <button
                onClick={() => handleSelectTool('about')}
                className={`transition-colors hover:text-cyan-400 ${
                  activeTool === 'about' ? 'text-cyan-400 font-semibold' : 'text-slate-300'
                }`}
              >
                Acerca de...
              </button>
              <button
                onClick={() => handleSelectTool('privacy')}
                className={`transition-colors hover:text-cyan-400 ${
                  activeTool === 'privacy' ? 'text-cyan-400 font-semibold' : 'text-slate-300'
                }`}
              >
                Privacidad
              </button>
              <a
                href="https://aitorsanchez.pages.dev"
                target="_blank"
                rel="noopener noreferrer"
                className="text-slate-300 hover:text-cyan-400 transition-colors inline-flex items-center gap-1"
              >
                <span>Blog</span>
                <ExternalLink className="w-3 h-3 text-slate-500" />
              </a>
              <a
                href="https://aitorhub.vercel.app"
                target="_blank"
                rel="noopener noreferrer"
                className="text-slate-300 hover:text-cyan-400 transition-colors inline-flex items-center gap-1"
              >
                <span>Aitor Hub</span>
                <ExternalLink className="w-3 h-3 text-slate-500" />
              </a>
              <a
                href="https://aitorsanchez.pages.dev/contacto"
                target="_blank"
                rel="noopener noreferrer"
                className="text-slate-300 hover:text-cyan-400 transition-colors inline-flex items-center gap-1"
              >
                <span>Contacto</span>
                <ExternalLink className="w-3 h-3 text-slate-500" />
              </a>
            </div>
          </div>

          <div className="flex flex-col sm:flex-row items-center justify-between gap-4 text-[11px] text-slate-500">
            <div>
              <span>Autor: <strong className="text-slate-300 font-medium">Aitor Sánchez Gutiérrez</strong> (c) 2026 Todos los derechos reservados.</span>
            </div>
            <div className="text-center sm:text-right">
              <span>Privacidad: Página estandar de privacidad. (Se recogerá únicamente la ip del usuario para analíticas.)</span>
            </div>
          </div>
        </div>
      </footer>

      {/* Indicador Flotante Offline */}
      <OfflineIndicator />

      {/* Modal de Historial y Favoritos */}
      <HistoryModal
        isOpen={isHistoryOpen}
        onClose={() => setIsHistoryOpen(false)}
        items={historyItems}
        onSelectQuery={handleSelectFromHistory}
        onRefreshHistory={refreshHistory}
      />
    </div>
  );
}

export default function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <ToastProvider>
        <MainApp />
      </ToastProvider>
    </QueryClientProvider>
  );
}
