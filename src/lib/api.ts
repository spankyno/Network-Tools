import {
  DnsResponse,
  DnsPropagationResponse,
  DnssecResponse,
  WhoisResponse,
  IpResponse,
  SslResponse,
  CtLogsResponse,
  HttpHeadersResponse,
  HttpVersionsResponse,
  TracerouteResponse,
  PortCheckResponse,
} from '../types/network';

const getApiBase = () => {
  if (import.meta.env.VITE_API_BASE_URL) {
    return import.meta.env.VITE_API_BASE_URL;
  }
  return '';
};

/** Error de la API con el código HTTP, para decidir si tiene sentido reintentar (los 4xx no lo tienen). */
export class ApiError extends Error {
  constructor(message: string, public status: number = 0) {
    super(message);
    this.name = 'ApiError';
  }
}

const DEFAULT_TIMEOUT_MS = 30_000;

async function handleFetch<T>(endpoint: string, signal?: AbortSignal): Promise<T> {
  const url = `${getApiBase()}${endpoint}`;
  // Plazo máximo siempre; si el llamador aporta su propia señal (p. ej. la de React Query) se combinan.
  const timeout = AbortSignal.timeout(DEFAULT_TIMEOUT_MS);
  let response: Response;
  try {
    response = await fetch(url, { signal: signal ? AbortSignal.any([signal, timeout]) : timeout });
  } catch (err: any) {
    if (err?.name === 'TimeoutError') throw new ApiError('La solicitud tardó demasiado en responder. Inténtelo de nuevo.', 504);
    if (err?.name === 'AbortError') throw err; // cancelada por el llamador: no es un fallo
    throw new ApiError('No se pudo conectar con el servidor. Compruebe su conexión.', 0);
  }

  const contentType = response.headers.get('content-type');
  if (!contentType || !contentType.includes('application/json')) {
    const text = await response.text();
    throw new ApiError(`Error de conexión con el servidor (${response.status}): ${text.slice(0, 80)}`, response.status);
  }

  const data = await response.json();
  if (!response.ok) {
    throw new ApiError(data.error || `La solicitud falló con código ${response.status}`, response.status);
  }
  return data as T;
}

export async function fetchDns(name: string, type: string = 'A'): Promise<DnsResponse> {
  return handleFetch<DnsResponse>(`/api/dns?name=${encodeURIComponent(name)}&type=${encodeURIComponent(type)}`);
}

export async function fetchDnsPropagation(name: string, type: string = 'A'): Promise<DnsPropagationResponse> {
  return handleFetch<DnsPropagationResponse>(
    `/api/dns-propagation?name=${encodeURIComponent(name)}&type=${encodeURIComponent(type)}`
  );
}

export async function fetchDnssec(domain: string): Promise<DnssecResponse> {
  return handleFetch<DnssecResponse>(`/api/dnssec?name=${encodeURIComponent(domain)}`);
}

export async function fetchWhois(query: string): Promise<WhoisResponse> {
  return handleFetch<WhoisResponse>(`/api/whois?query=${encodeURIComponent(query)}`);
}

export async function fetchIp(ip?: string): Promise<IpResponse> {
  // Antes, sin IP indicada, el NAVEGADOR consultaba directamente a ipwho.is (tercero), filtrando la IP del usuario
  // sin pasar por el backend y sin que lo recogiera la política de privacidad. Ahora todo pasa por /api/ip.
  const query = ip ? `?ip=${encodeURIComponent(ip)}` : '';
  return handleFetch<IpResponse>(`/api/ip${query}`);
}

export async function fetchSsl(host: string, port: number = 443): Promise<SslResponse> {
  return handleFetch<SslResponse>(`/api/ssl?host=${encodeURIComponent(host)}&port=${port}`);
}

export async function fetchCtLogs(domain: string): Promise<CtLogsResponse> {
  return handleFetch<CtLogsResponse>(`/api/ct-logs?domain=${encodeURIComponent(domain)}`);
}

export async function fetchHeaders(url: string): Promise<HttpHeadersResponse> {
  return handleFetch<HttpHeadersResponse>(`/api/headers?url=${encodeURIComponent(url)}`);
}

export async function fetchHttpVersions(host: string): Promise<HttpVersionsResponse> {
  return handleFetch<HttpVersionsResponse>(`/api/http-versions?host=${encodeURIComponent(host)}`);
}

export async function fetchTraceroute(
  target: string,
  limit: number = 3,
  region: string = 'EU'
): Promise<TracerouteResponse> {
  return handleFetch<TracerouteResponse>(
    `/api/traceroute?target=${encodeURIComponent(target)}&limit=${limit}&region=${encodeURIComponent(region)}`
  );
}

export async function fetchPortCheck(host: string, port?: number): Promise<PortCheckResponse> {
  const portQuery = port ? `&port=${port}` : '';
  return handleFetch<PortCheckResponse>(`/api/port-check?host=${encodeURIComponent(host)}${portQuery}`);
}

export function getSpeedTestEndpoints(preferredServer: 'local' | 'cloudflare' = 'local') {
  const base = getApiBase();
  if (preferredServer === 'cloudflare') {
    return {
      name: 'Cloudflare Global CDN',
      location: 'Anycast Global Edge (speed.cloudflare.com)',
      pingUrl: 'https://speed.cloudflare.com/__down?bytes=0',
      downUrl: (bytes: number) => `https://speed.cloudflare.com/__down?bytes=${bytes}`,
      upUrl: 'https://speed.cloudflare.com/__up',
    };
  }
  return {
    name: 'Servidor Edge / Backend de la App',
    location: 'Nodo Directo de Diagnóstico',
    pingUrl: `${base}/api/speedtest/ping`,
    downUrl: (bytes: number) => `${base}/api/speedtest/download?bytes=${bytes}`,
    upUrl: `${base}/api/speedtest/upload`,
  };
}

