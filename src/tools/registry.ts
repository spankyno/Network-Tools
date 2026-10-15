import React from 'react';
import { ToolId } from '../types/network';
import {
  Globe,
  Radio,
  ShieldCheck,
  Shield,
  FileSearch,
  Terminal,
  Zap,
  MapPin,
  Route,
  Server,
  FileText,
  Gauge,
} from 'lucide-react';

export type ToolCategory = 'dns' | 'security' | 'network' | 'web';

export interface ToolDefinition {
  id: ToolId;
  name: string;
  shortName: string;
  subtitle: string;
  description: string;
  category: ToolCategory;
  categoryLabel: string;
  badge: string;
  tags: string[];
  icon: React.ComponentType<{ className?: string }>;
  defaultQuery: string;
  defaultExtra?: string;
  placeholder: string;
}

export const TOOL_REGISTRY: ToolDefinition[] = [
  // Categoría: DNS
  {
    id: 'dns',
    name: 'Búsqueda DNS',
    shortName: 'DNS',
    subtitle: 'Resolutor DoH Multirregistro',
    description: 'Resuelve registros autoritativos A, AAAA, MX, TXT, NS, CNAME, SOA y CAA con medición de latencia DoH y tiempo de vida (TTL).',
    category: 'dns',
    categoryLabel: 'DNS y Dominios',
    badge: 'Esencial',
    tags: ['A / AAAA', 'MX / TXT', 'DoH Cloudflare/Google'],
    icon: Globe,
    defaultQuery: 'cloudflare.com',
    defaultExtra: 'A',
    placeholder: 'Introduzca dominio (ej. cloudflare.com, github.com)...',
  },
  {
    id: 'propagation',
    name: 'Propagación DNS',
    shortName: 'Propagación',
    subtitle: 'Consenso Multirresolutor Mundial',
    description: 'Comprueba la consistencia y caché DNS en 8 resolutores globales simultáneos (Norteamérica, Europa, Asia, Sudamérica, Oceanía).',
    category: 'dns',
    categoryLabel: 'DNS y Dominios',
    badge: 'Mundial',
    tags: ['8 Resolutores', '% Consenso', 'Latencia RTT'],
    icon: Radio,
    defaultQuery: 'cloudflare.com',
    defaultExtra: 'A',
    placeholder: 'Introduzca dominio para verificar propagación global...',
  },
  {
    id: 'dnssec',
    name: 'Validador DNSSEC',
    shortName: 'DNSSEC',
    subtitle: 'Auditoría Criptográfica de Zona',
    description: 'Valida firmas RRSIG, pares de claves DNSKEY (KSK y ZSK), registros DS delegados en el TLD y la cadena de confianza hacia la raíz.',
    category: 'dns',
    categoryLabel: 'DNS y Dominios',
    badge: 'Criptografía',
    tags: ['DNSKEY / DS', 'Firma RRSIG', 'Cadena Raíz'],
    icon: ShieldCheck,
    defaultQuery: 'cloudflare.com',
    placeholder: 'Introduzca dominio con DNSSEC (ej. cloudflare.com, ietf.org)...',
  },

  // Categoría: Seguridad TLS / SSL
  {
    id: 'ssl',
    name: 'Inspección SSL / TLS',
    shortName: 'SSL / TLS',
    subtitle: 'Cadena de Confianza y Expiración',
    description: 'Inspecciona certificados TLS mediante conexión nativa: días restantes, autoridad emisora, suite de cifrado y cadena completa.',
    category: 'security',
    categoryLabel: 'Seguridad y Cifrado',
    badge: 'Seguridad',
    tags: ['Días restantes', 'TLSv1.3', 'Cadena Certificados'],
    icon: Shield,
    defaultQuery: 'github.com',
    defaultExtra: '443',
    placeholder: 'Introduzca host (ej. github.com, cloudflare.com)...',
  },
  {
    id: 'ctlogs',
    name: 'Logs de Transparencia (CT)',
    shortName: 'Logs CT',
    subtitle: 'Descubrimiento de Subdominios y Emisiones',
    description: 'Busca en registros públicos de Transparencia de Certificados (crt.sh) para auditar certificados emitidos históricamente y subdominios.',
    category: 'security',
    categoryLabel: 'Seguridad y Cifrado',
    badge: 'OSINT',
    tags: ['crt.sh', 'Subdominios', 'Histórico CA'],
    icon: FileSearch,
    defaultQuery: 'github.com',
    placeholder: 'Introduzca dominio para buscar en CT Logs...',
  },

  // Categoría: Web & Protocolos
  {
    id: 'headers',
    name: 'Encabezados HTTP',
    shortName: 'Encabezados',
    subtitle: 'Auditoría de Seguridad (A+ a F)',
    description: 'Analiza encabezados de respuesta del servidor y calcula calificación de seguridad para HSTS, CSP, X-Frame-Options y permisos.',
    category: 'web',
    categoryLabel: 'Protocolos Web',
    badge: 'Auditoría',
    tags: ['Calificación A+', 'HSTS / CSP', 'Caché CDN'],
    icon: Terminal,
    defaultQuery: 'https://cloudflare.com',
    placeholder: 'Introduzca URL (ej. https://cloudflare.com)...',
  },
  {
    id: 'httpversions',
    name: 'Soporte HTTP/2 y HTTP/3',
    shortName: 'HTTP/2 & HTTP/3',
    subtitle: 'Negociación ALPN y QUIC',
    description: 'Verifica compatibilidad con HTTP/1.1, negociación ALPN para HTTP/2 (h2) y transporte sobre UDP/QUIC publicitado en Alt-Svc.',
    category: 'web',
    categoryLabel: 'Protocolos Web',
    badge: 'Transporte',
    tags: ['ALPN TLS (h2)', 'QUIC / UDP', 'Alt-Svc'],
    icon: Zap,
    defaultQuery: 'cloudflare.com',
    placeholder: 'Introduzca host (ej. cloudflare.com, google.com)...',
  },

  // Categoría: Red e IP
  {
    id: 'ip',
    name: 'Geolocalización IP y ASN',
    shortName: 'Geolocalización',
    subtitle: 'Inteligencia IP y Mapa Interactivo',
    description: 'Localiza coordenadas geográficas, proveedor ISP, número de sistema autónomo (ASN) y heurísticas de VPN/proxy con mapa Leaflet.',
    category: 'network',
    categoryLabel: 'Red e Infraestructura',
    badge: 'Ubicación',
    tags: ['Mapa Leaflet', 'ASN / ISP', 'Filtro VPN'],
    icon: MapPin,
    defaultQuery: '',
    placeholder: 'Introduzca IP o dominio (o vacío para autodetectar su IP)...',
  },
  {
    id: 'traceroute',
    name: 'Traceroute Visual',
    shortName: 'Traceroute',
    subtitle: 'Traza de Saltos y Latencia RTT',
    description: 'Rastrea el camino de red hasta el destino mediante sondas distribuidas de Globalping, midiendo latencia y pérdida en cada salto.',
    category: 'network',
    categoryLabel: 'Red e Infraestructura',
    badge: 'Diagnóstico',
    tags: ['Saltos de Red', 'Latencia RTT', 'Globalping'],
    icon: Route,
    defaultQuery: '1.1.1.1',
    placeholder: 'Introduzca host o IP de destino (ej. 1.1.1.1, google.com)...',
  },
  {
    id: 'ports',
    name: 'Escáner de Puertos TCP',
    shortName: 'Puertos TCP',
    subtitle: 'Verificación de Servicios y Conectividad',
    description: 'Prueba accesibilidad TCP en suite de servicios comunes (HTTP, HTTPS, SSH, FTP, SMTP, MySQL, Postgres, RDP) o puerto personalizado.',
    category: 'network',
    categoryLabel: 'Red e Infraestructura',
    badge: 'Sonda TCP',
    tags: ['Abierto/Cerrado', 'Latencia Socket', 'Puertos 1-65535'],
    icon: Server,
    defaultQuery: 'github.com',
    placeholder: 'Introduzca host o IP para escanear puertos...',
  },
  {
    id: 'whois',
    name: 'Registro Whois / RDAP',
    shortName: 'Whois / RDAP',
    subtitle: 'Propiedad de Dominio y Servidores DNS',
    description: 'Consulta datos oficiales de registro RDAP: registrador patrocinador, fechas de creación/expiración, estado EPP y servidores DNS.',
    category: 'dns',
    categoryLabel: 'DNS y Dominios',
    badge: 'Registro',
    tags: ['Registrador IANA', 'Fecha Expiración', 'Nameservers'],
    icon: FileText,
    defaultQuery: 'github.com',
    placeholder: 'Introduzca dominio o IP (ej. github.com, 1.1.1.1)...',
  },
  {
    id: 'speedtest',
    name: 'Test de Velocidad',
    shortName: 'Velocidad',
    subtitle: 'Ancho de Banda, Ping y Bufferbloat',
    description: 'Mide la velocidad real de descarga y subida en Mbps, latencia RTT, jitter y calidad de conexión para streaming y juegos.',
    category: 'network',
    categoryLabel: 'Red e Infraestructura',
    badge: 'Velocidad',
    tags: ['Mbps Bajada / Subida', 'Ping / Jitter', 'Bufferbloat'],
    icon: Gauge,
    defaultQuery: '',
    placeholder: 'Haga clic en Iniciar Test para medir...',
  },
];

export function getToolDefinition(id: ToolId): ToolDefinition {
  const tool = TOOL_REGISTRY.find((t) => t.id === id);
  if (!tool) {
    return TOOL_REGISTRY[0];
  }
  return tool;
}
