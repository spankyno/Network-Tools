import React from 'react';
import { Shield, Lock, Eye, Database, ArrowLeft, CheckCircle2, Globe, Server } from 'lucide-react';

interface PrivacyPageProps {
  onBackToTools: () => void;
}

export const PrivacyPage: React.FC<PrivacyPageProps> = ({ onBackToTools }) => {
  return (
    <div className="space-y-8 animate-in fade-in duration-300 max-w-4xl mx-auto">
      {/* Botón de retorno */}
      <div>
        <button
          onClick={onBackToTools}
          className="inline-flex items-center gap-2 px-3 py-1.5 rounded-lg border border-slate-800 bg-slate-900/60 hover:bg-slate-800 text-slate-300 hover:text-white text-xs font-medium transition-colors"
        >
          <ArrowLeft className="w-3.5 h-3.5" />
          <span>Volver al Panel Principal</span>
        </button>
      </div>

      {/* Encabezado */}
      <div className="pb-6 border-b border-slate-800 space-y-3">
        <div className="inline-flex items-center gap-2 px-2.5 py-1 rounded-full bg-cyan-500/10 border border-cyan-500/30 text-cyan-400 text-xs font-mono">
          <Shield className="w-3.5 h-3.5" />
          <span>Política de Privacidad y Tratamiento de Datos</span>
        </div>
        <h1 className="text-3xl font-extrabold text-slate-100 tracking-tight sm:text-4xl">
          Política de Privacidad
        </h1>
        <p className="text-sm text-slate-400 leading-relaxed">
          Última actualización: 2026. En Network Tools Hub nos comprometemos a mantener la máxima transparencia
          y respeto hacia la privacidad de los usuarios técnicos que utilizan nuestra plataforma de diagnóstico.
        </p>
      </div>

      {/* Aviso Fundamental */}
      <div className="rounded-xl border border-cyan-500/30 bg-cyan-950/20 p-5 text-sm text-cyan-200/90 leading-relaxed flex items-start gap-3">
        <CheckCircle2 className="w-5 h-5 text-cyan-400 shrink-0 mt-0.5" />
        <div>
          <strong className="text-cyan-100 font-semibold block mb-1">
            Principio de Recogida Mínima de Datos
          </strong>
          <span>
            Se recogerá únicamente la dirección IP del usuario para analíticas técnicas agregadas y control de
            tasa de uso (rate limiting), con el fin de proteger la estabilidad del servicio y prevenir abusos
            automatizados. No se recogen nombres, correos electrónicos, identificadores biométricos ni contraseñas.
          </span>
        </div>
      </div>

      {/* Artículos de Privacidad */}
      <div className="space-y-6 text-xs sm:text-sm text-slate-300 leading-relaxed">
        {/* 1. Información que se recopila */}
        <div className="rounded-xl border border-slate-800 bg-slate-900/40 p-6 space-y-3">
          <h2 className="text-base font-bold text-slate-100 flex items-center gap-2">
            <Eye className="w-4 h-4 text-cyan-400" />
            <span>1. Datos que se recopilan y finalidad</span>
          </h2>
          <p className="text-slate-400 leading-relaxed">
            Nuestra infraestructura registra exclusivamente:
          </p>
          <ul className="list-disc pl-5 space-y-1.5 text-slate-300">
            <li>
              <strong>Dirección IP del visitante:</strong> Empleada de forma técnica temporal para generar métricas
              analíticas agregadas (país de procedencia, volumen de peticiones por minuto) y aplicar cortafuegos
              de peticiones excesivas (protección DoS/abuso en Cloudflare).
            </li>
            <li>
              <strong>Cabecera User-Agent:</strong> Utilizada únicamente para compatibilidad del navegador y soporte de
              instalación PWA.
            </li>
          </ul>
        </div>

        {/* 2. Historial de Consultas */}
        <div className="rounded-xl border border-slate-800 bg-slate-900/40 p-6 space-y-3">
          <h2 className="text-base font-bold text-slate-100 flex items-center gap-2">
            <Database className="w-4 h-4 text-cyan-400" />
            <span>2. Almacenamiento Local de Consultas (LocalStorage)</span>
          </h2>
          <p className="text-slate-400 leading-relaxed">
            El historial de diagnósticos (búsquedas DNS, dominios consultados en Whois o IPs investigadas)
            se almacena <strong>única y exclusivamente en la memoria local de su propio navegador web (LocalStorage)</strong>.
          </p>
          <p className="text-slate-400 leading-relaxed">
            Dichos datos jamás son transmitidos ni almacenados en bases de datos externas de la plataforma. Usted tiene el
            control absoluto para fijar favoritos, exportar su historial a un archivo JSON o borrarlo completamente
            en cualquier momento con un solo clic en la sección de Historial.
          </p>
        </div>

        {/* 3. Ausencia de Cookies Comerciales y Rastreadores */}
        <div className="rounded-xl border border-slate-800 bg-slate-900/40 p-6 space-y-3">
          <h2 className="text-base font-bold text-slate-100 flex items-center gap-2">
            <Lock className="w-4 h-4 text-cyan-400" />
            <span>3. Cero Publicidad y Cero Rastreo Publicitario</span>
          </h2>
          <p className="text-slate-400 leading-relaxed">
            Esta aplicación:
          </p>
          <ul className="list-disc pl-5 space-y-1 text-slate-300">
            <li>No utiliza cookies de seguimiento comercial ni redes publicitarias (sin Google AdSense, Meta Pixel, etc.).</li>
            <li>No vende ni cede datos a corredores de datos (data brokers).</li>
            <li>No envía sus consultas a motores de inteligencia artificial para entrenamiento de modelos.</li>
          </ul>
        </div>

        {/* 4. Proveedores de Terceros */}
        <div className="rounded-xl border border-slate-800 bg-slate-900/40 p-6 space-y-3">
          <h2 className="text-base font-bold text-slate-100 flex items-center gap-2">
            <Globe className="w-4 h-4 text-cyan-400" />
            <span>4. Servicios de Consulta de Terceros</span>
          </h2>
          <p className="text-slate-400 leading-relaxed">
            Cuando usted solicita un diagnóstico de red, la petición se envía a los resolvers públicos
            correspondientes para obtener las respuestas autoritativas (como los servicios DoH de Cloudflare 1.1.1.1,
            Google 8.8.8.8, registros crt.sh de Sectigo, sondas comunitarias Globalping o mosaicos OpenStreetMap).
            Estos servicios se rigen por sus respectivas políticas de privacidad técnicas.
          </p>
        </div>

        {/* 5. Contacto y Derechos */}
        <div className="rounded-xl border border-slate-800 bg-slate-900/40 p-6 space-y-3">
          <h2 className="text-base font-bold text-slate-100 flex items-center gap-2">
            <Server className="w-4 h-4 text-cyan-400" />
            <span>5. Contacto sobre Privacidad</span>
          </h2>
          <p className="text-slate-400 leading-relaxed">
            Para cualquier consulta sobre la privacidad o el funcionamiento del servicio, puede ponerse en contacto
            a través de la página oficial de contacto:{' '}
            <a
              href="https://aitorsanchez.pages.dev/contacto"
              target="_blank"
              rel="noopener noreferrer"
              className="text-cyan-400 hover:underline font-mono"
            >
              https://aitorsanchez.pages.dev/contacto
            </a>
          </p>
        </div>
      </div>
    </div>
  );
};
