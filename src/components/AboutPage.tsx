import React from 'react';
import {
  Activity,
  Layers,
  Shield,
  Cpu,
  Globe,
  Radio,
  Server,
  Terminal,
  Lock,
  FileText,
  Search,
  ExternalLink,
  CheckCircle2,
  Zap,
  Code2,
  HardDrive,
  EyeOff,
  Sparkles,
  ArrowLeft,
} from 'lucide-react';
import { TOOL_REGISTRY } from '../tools/registry';
import { ToolId } from '../types/network';

interface AboutPageProps {
  onBackToTools: () => void;
  onSelectTool: (tool: ToolId) => void;
}

export const AboutPage: React.FC<AboutPageProps> = ({ onBackToTools, onSelectTool }) => {
  const techStack = [
    {
      category: 'Frontend & UI',
      items: [
        { name: 'React 19 & TypeScript', desc: 'Tipado estricto, hooks reactivos modernos y componentes modulares.' },
        { name: 'Tailwind CSS v4', desc: 'Motor de estilos ultrarrápido con diseño técnico inspirado en Cloudflare y Linear.' },
        { name: 'Lucide React & Motion', desc: 'Iconografía vectorial técnica y micro-interacciones fluidas.' },
        { name: 'PWA & Service Worker', desc: 'Instalable en escritorio/móvil con manifiesto web y funcionamiento offline básico.' },
      ],
    },
    {
      category: 'Estado, Datos & Mapas',
      items: [
        { name: 'TanStack React Query', desc: 'Caché cliente, reintentos automáticos, deduplicación y estados de carga en tiempo real.' },
        { name: 'Leaflet & OpenStreetMap (OSM)', desc: 'Cartografía libre sin coste de API ni tracking, con capas estándar, humanitaria (HOT) y Carto Voyager.' },
        { name: 'Historial Local Persistente', desc: 'Almacenamiento en LocalStorage con capacidad de fijar favoritos y exportar/importar JSON.' },
      ],
    },
    {
      category: 'Backend, Red & Protocolos',
      items: [
        { name: 'Node.js & Express / Cloudflare Workers', desc: 'Rutas seguras para sortear restricciones de CORS del navegador.' },
        { name: 'Sockets TCP Nativos (net.Socket)', desc: 'Comprobador de puertos reales sin servicios de terceros de pago.' },
        { name: 'Inspección TLS Nativa (tls.connect)', desc: 'Análisis profundo de certificados x509, fechas de expiración y cadenas de confianza.' },
        { name: 'DoH (DNS over HTTPS RFC 8484)', desc: 'Consultas DNS encriptadas con failover automático: Cloudflare 1.1.1.1, Google 8.8.8.8 y Quad9.' },
        { name: 'RDAP & WHOIS (RFC 7484)', desc: 'Protocolo moderno de consulta de asignaciones IP y dominios ante RIRs (RIPE, ARIN, LACNIC, APNIC).' },
      ],
    },
    {
      category: 'Infraestructura & Costes',
      items: [
        { name: '100% Free Tier', desc: 'Operación completa en planes gratuitos de Cloudflare Pages, Cloudflare Workers y APIs públicas abiertas.' },
        { name: 'Sin APIs de Pago ni IA innecesaria', desc: 'Diagnósticos deterministas basados en estándares IETF y protocolos de red reales.' },
      ],
    },
  ];

  return (
    <div className="space-y-10 animate-in fade-in duration-300">
      {/* Botón de retorno y Encabezado */}
      <div className="space-y-4">
        <button
          onClick={onBackToTools}
          className="inline-flex items-center gap-2 px-3 py-1.5 rounded-lg border border-slate-800 bg-slate-900/60 hover:bg-slate-800 text-slate-300 hover:text-white text-xs font-medium transition-colors"
        >
          <ArrowLeft className="w-3.5 h-3.5" />
          <span>Volver al Panel de Diagnóstico</span>
        </button>

        <div className="flex flex-col md:flex-row md:items-end justify-between gap-4 pb-6 border-b border-slate-800">
          <div>
            <div className="inline-flex items-center gap-2 px-2.5 py-1 rounded-full bg-cyan-500/10 border border-cyan-500/30 text-cyan-400 text-xs font-mono mb-3">
              <Sparkles className="w-3.5 h-3.5" />
              <span>Network Tools Hub · Documentación y Arquitectura</span>
            </div>
            <h1 className="text-3xl font-extrabold tracking-tight text-slate-100 sm:text-4xl">
              Acerca de la Plataforma
            </h1>
            <p className="text-slate-400 text-sm sm:text-base mt-2 max-w-2xl leading-relaxed">
              Plataforma profesional de diagnóstico y análisis de redes, dominios, infraestructura web y
              seguridad perimetral, diseñada para administradores de sistemas, desarrolladores y especialistas de red.
            </p>
          </div>

          <div className="flex items-center gap-3">
            <span className="px-3 py-1.5 rounded-lg border border-slate-800 bg-slate-900/80 text-xs font-mono text-emerald-400 flex items-center gap-1.5">
              <span className="w-2 h-2 rounded-full bg-emerald-500 animate-pulse"></span>
              100% Libre & Free Tier
            </span>
          </div>
        </div>
      </div>

      {/* Pilares Clave */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-5">
        <div className="rounded-xl border border-slate-800 bg-slate-900/40 p-6 space-y-3">
          <div className="w-10 h-10 rounded-lg bg-cyan-500/10 border border-cyan-500/30 flex items-center justify-center text-cyan-400">
            <Zap className="w-5 h-5" />
          </div>
          <h3 className="text-base font-bold text-slate-100">Rápido y Determinista</h3>
          <p className="text-xs text-slate-400 leading-relaxed">
            Sin intermediarios lentos ni bots generativos innecesarios. Las consultas se resuelven contra
            los resolvers y servidores de origen a nivel de protocolo (DNS, TLS, TCP, RDAP, HTTP).
          </p>
        </div>

        <div className="rounded-xl border border-slate-800 bg-slate-900/40 p-6 space-y-3">
          <div className="w-10 h-10 rounded-lg bg-emerald-500/10 border border-emerald-500/30 flex items-center justify-center text-emerald-400">
            <EyeOff className="w-5 h-5" />
          </div>
          <h3 className="text-base font-bold text-slate-100">Privacidad Rigurosa</h3>
          <p className="text-xs text-slate-400 leading-relaxed">
            Sin cookies de rastreo comercial, sin publicidad y sin perfiles de navegación. El historial
            de consultas se guarda localmente en su dispositivo mediante LocalStorage.
          </p>
        </div>

        <div className="rounded-xl border border-slate-800 bg-slate-900/40 p-6 space-y-3">
          <div className="w-10 h-10 rounded-lg bg-violet-500/10 border border-violet-500/30 flex items-center justify-center text-violet-400">
            <HardDrive className="w-5 h-5" />
          </div>
          <h3 className="text-base font-bold text-slate-100">Despliegue Serverless Gratuito</h3>
          <p className="text-xs text-slate-400 leading-relaxed">
            Construido para operar 24/7 en planes gratuitos de Cloudflare (Pages + Workers),
            aprovechando APIs públicas abiertas y servicios comunitarios como OpenStreetMap y Globalping.
          </p>
        </div>
      </div>

      {/* Catálogo de Funcionalidades y Herramientas */}
      <div className="space-y-6">
        <div>
          <h2 className="text-xl font-bold text-slate-100 flex items-center gap-2">
            <Layers className="w-5 h-5 text-cyan-400" />
            <span>Funcionalidades y Herramientas Integradas ({TOOL_REGISTRY.length})</span>
          </h2>
          <p className="text-xs text-slate-400 mt-1">
            Cada herramienta implementa protocolos estándar con manejo de fallbacks y exportación de datos.
          </p>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {TOOL_REGISTRY.map((tool) => {
            const Icon = tool.icon;
            return (
              <div
                key={tool.id}
                className="rounded-xl border border-slate-800/80 bg-slate-900/60 hover:border-slate-700 p-5 space-y-3 transition-colors flex flex-col justify-between"
              >
                <div className="space-y-2">
                  <div className="flex items-center justify-between">
                    <div className="p-2 rounded-lg bg-slate-800 border border-slate-700/60 text-cyan-400">
                      <Icon className="w-4 h-4" />
                    </div>
                    <span className="text-[10px] font-mono px-2 py-0.5 rounded bg-slate-800 text-slate-400">
                      {tool.shortName}
                    </span>
                  </div>
                  <h4 className="text-sm font-bold text-slate-100">{tool.name}</h4>
                  <p className="text-xs text-slate-400 leading-relaxed">{tool.description}</p>
                </div>

                <div className="pt-3 border-t border-slate-800/80 flex items-center justify-between text-xs">
                  <span className="text-[11px] font-mono text-slate-500">
                    {tool.id === 'ip' ? 'Leaflet + OSM' : tool.id === 'ssl' ? 'tls.connect' : tool.id === 'ports' ? 'net.Socket' : 'RFC / DoH'}
                  </span>
                  <button
                    onClick={() => onSelectTool(tool.id)}
                    className="inline-flex items-center gap-1 text-cyan-400 hover:text-cyan-300 font-medium transition-colors"
                  >
                    <span>Abrir herramienta</span>
                    <ExternalLink className="w-3 h-3" />
                  </button>
                </div>
              </div>
            );
          })}
        </div>
      </div>

      {/* Stack Tecnológico Detallado */}
      <div className="space-y-6">
        <div>
          <h2 className="text-xl font-bold text-slate-100 flex items-center gap-2">
            <Cpu className="w-5 h-5 text-cyan-400" />
            <span>Stack Tecnológico de Producción</span>
          </h2>
          <p className="text-xs text-slate-400 mt-1">
            Componentes y tecnologías seleccionadas para máxima velocidad, accesibilidad y cero costes operativos.
          </p>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
          {techStack.map((category) => (
            <div
              key={category.category}
              className="rounded-xl border border-slate-800 bg-slate-900/50 p-6 space-y-4"
            >
              <h3 className="text-sm font-bold text-slate-200 uppercase tracking-wider font-mono border-b border-slate-800 pb-2">
                {category.category}
              </h3>
              <ul className="space-y-3">
                {category.items.map((item) => (
                  <li key={item.name} className="space-y-0.5">
                    <div className="flex items-center gap-2 text-xs font-semibold text-slate-200">
                      <CheckCircle2 className="w-3.5 h-3.5 text-cyan-400 shrink-0" />
                      <span>{item.name}</span>
                    </div>
                    <p className="text-xs text-slate-400 pl-5 leading-relaxed">{item.desc}</p>
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </div>
      </div>

    </div>
  );
};
