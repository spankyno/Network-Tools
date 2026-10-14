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

async function handleFetch<T>(url: string): Promise<T> {
  const response = await fetch(url);
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

export async function fetchTraceroute(target: string): Promise<TracerouteResponse> {
  return handleFetch<TracerouteResponse>(`/api/traceroute?target=${encodeURIComponent(target)}`);
}

export async function fetchPortCheck(host: string, port?: number): Promise<PortCheckResponse> {
  const portQuery = port ? `&port=${port}` : '';
  return handleFetch<PortCheckResponse>(`/api/port-check?host=${encodeURIComponent(host)}${portQuery}`);
}
