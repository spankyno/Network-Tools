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

async function handleFetch<T>(endpoint: string): Promise<T> {
  const base = getApiBase();
  const url = `${base}${endpoint}`;
  const response = await fetch(url);
  const contentType = response.headers.get('content-type');

  if (!contentType || !contentType.includes('application/json')) {
    const text = await response.text();
    throw new Error(`Error de conexión con el servidor (${response.status}): ${text.slice(0, 80)}`);
  }

  const data = await response.json();
  if (!response.ok) {
    throw new Error(data.error || `La solicitud falló con código ${response.status}`);
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
  if (!ip) {
    try {
      const resp = await fetch('https://ipwho.is/', { signal: AbortSignal.timeout(4000) });
      if (resp.ok) {
        const data = await resp.json();
        if (data.success !== false) {
          return {
            ip: data.ip,
            version: data.type === 'IPv6' ? 'IPv6' : 'IPv4',
            country: data.country || 'Desconocido',
            countryCode: data.country_code || '',
            region: data.region || '',
            regionCode: data.region_code || '',
            city: data.city || 'Desconocida',
            zip: data.postal || '',
            lat: typeof data.latitude === 'number' ? data.latitude : 0,
            lon: typeof data.longitude === 'number' ? data.longitude : 0,
            timezone: data.timezone?.id || 'UTC',
            isp: data.connection?.isp || data.connection?.org || 'Desconocido',
            org: data.connection?.org || '',
            as: data.connection?.asn ? `AS${data.connection.asn} ${data.connection.org || ''}` : '',
            isMobile: false,
            isProxy: Boolean(data.security?.is_proxy || data.security?.is_vpn),
            isHosting: Boolean(data.security?.is_datacenter),
            providerUsed: 'ipwho.is (Client Direct)',
          };
        }
      }
    } catch {
      // fallback to backend API
    }
  }
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
