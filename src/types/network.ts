export type ToolId =
  | 'dns'
  | 'propagation'
  | 'dnssec'
  | 'ssl'
  | 'ctlogs'
  | 'headers'
  | 'httpversions'
  | 'ip'
  | 'traceroute'
  | 'ports'
  | 'whois'
  | 'speedtest';

export interface HistoryItem {
  id: string;
  tool: ToolId;
  query: string;
  extra?: string; // e.g. tipo de registro o puerto
  timestamp: number;
  isPinned?: boolean; // ⭐ Fijado como favorito
}

// 1. DNS Types
export interface DnsRecord {
  name: string;
  type: string;
  typeCode?: number;
  TTL: number;
  data: string;
}

export interface DnsResponse {
  query: { name: string; type: string };
  status: string;
  statusCode: number;
  durationMs: number;
  truncated?: boolean;
  recursionDesired?: boolean;
  recursionAvailable?: boolean;
  records: DnsRecord[];
  authority?: DnsRecord[];
  providerUsed?: string;
  fallbacksAttempted?: string[];
  raw?: any;
  fallback?: boolean;
}

// 2. DNS Propagation Types
export interface ResolverResult {
  resolver: string;
  ip: string;
  location: string;
  country: string;
  status: string;
  durationMs: number;
  records: string[];
  success: boolean;
  matchesMajority?: boolean;
  error?: string;
}

export interface DnsPropagationResponse {
  query: { name: string; type: string };
  propagationPercent: number;
  majorityRecords: string[];
  resolvers: ResolverResult[];
}

// 3. DNSSEC Types
export interface DnssecKey {
  name: string;
  flags: number;
  type: string;
  protocol: string;
  algorithm: string;
  algorithmCode: number;
  publicKey: string;
  TTL: number;
}

export interface DnssecDs {
  name: string;
  keyTag: string;
  algorithm: string;
  digestType: string;
  digest: string;
  TTL: number;
}

export interface DnssecChainItem {
  level: string;
  status: string;
  algorithm?: string;
}

export interface DnssecResponse {
  domain: string;
  isSecure: boolean;
  validationStatus: 'SECURE' | 'INSECURE' | 'BOGUS';
  statusMessage: string;
  authenticatedData: boolean;
  durationMs: number;
  keys: DnssecKey[];
  dsRecords: DnssecDs[];
  rrsigCount: number;
  chain: DnssecChainItem[];
}

// 4. Whois / RDAP Types
export interface WhoisResponse {
  query: string;
  isIp: boolean;
  handle: string;
  name: string;
  registrar: string;
  registrant: string;
  creationDate: string;
  updatedDate: string;
  expirationDate: string;
  nameservers: string[];
  status: string[];
  dnssec: boolean;
  raw: any;
}

// 5. IP Geolocation Types
export interface IpResponse {
  ip: string;
  version: 'IPv4' | 'IPv6';
  country: string;
  countryCode: string;
  region: string;
  regionCode: string;
  city: string;
  zip: string;
  lat: number;
  lon: number;
  timezone: string;
  isp: string;
  org: string;
  as: string;
  isMobile: boolean;
  isProxy: boolean;
  isHosting: boolean;
  providerUsed?: string;
  fallbacksAttempted?: string[];
  durationMs?: number;
}

// 6. SSL / TLS Types
export interface CertChainItem {
  subject: string;
  issuer: string;
  validFrom: string;
  validTo: string;
  fingerprint256: string;
  serialNumber: string;
}

export interface SslResponse {
  host: string;
  port: number;
  authorized: boolean;
  authorizationError: string | null;
  protocol: string;
  cipher: { name: string; version: string } | null;
  durationMs: number;
  subject: {
    commonName: string;
    organization: string;
    organizationalUnit: string;
    country: string;
    state: string;
    locality: string;
  };
  issuer: {
    commonName: string;
    organization: string;
    country: string;
  };
  validFrom: string;
  validTo: string;
  daysRemaining: number;
  isExpired: boolean;
  expiryStatus: 'VALID' | 'EXPIRING_SOON' | 'CRITICAL' | 'EXPIRED';
  serialNumber: string;
  fingerprint256: string;
  fingerprint: string;
  subjectAltNames: string[];
  chain: CertChainItem[];
  /** true cuando el backend no pudo inspeccionar el TLS en vivo (despliegue Edge): datos parciales. */
  limited?: boolean;
  notice?: string;
}

// 7. Certificate Transparency (CT Logs) Types
export interface CtLogCertificate {
  id: number;
  loggedAt: string;
  notBefore: string;
  notAfter: string;
  commonName: string;
  issuerName: string;
  serialNumber: string;
  subdomains: string[];
}

export interface CtLogsResponse {
  domain: string;
  totalFound: number;
  uniqueCertificates: number;
  discoveredSubdomains: number;
  subdomains: string[];
  certificates: CtLogCertificate[];
  durationMs: number;
}

// 8. HTTP Headers & Security Types
export interface SecurityAuditItem {
  name: string;
  header: string;
  present: boolean;
  value: string | null;
  score: number;
  maxScore: number;
  status: 'pass' | 'warning' | 'missing';
  recommendation: string;
}

export interface HttpHeadersResponse {
  url: string;
  finalUrl: string;
  statusCode: number;
  statusText: string;
  durationMs: number;
  headers: Record<string, string>;
  securityScore: number;
  securityGrade: 'A+' | 'A' | 'B' | 'C' | 'D' | 'F';
  securityAudit: SecurityAuditItem[];
}

// 9. HTTP/2 & HTTP/3 Support Types
export interface ProtocolSupportItem {
  name: string;
  supported: boolean;
  transport: string;
  statusText: string;
}

export interface HttpVersionsResponse {
  host: string;
  durationMs: number;
  negotiatedProtocol: string;
  supports: {
    http1: boolean;
    http2: boolean;
    http3: boolean;
  };
  protocols: ProtocolSupportItem[];
  altSvc: string | null;
}

// 10. Traceroute Types
export interface TracerouteHop {
  hop: number;
  ip: string;
  hostname: string | null;
  rttMs: number | null;
  loss: boolean;
}

export interface TracerouteProbeResult {
  id?: string;
  probe: {
    city: string;
    country: string;
    continent: string;
    region?: string;
    asn?: number;
    network?: string;
  };
  destination?: {
    ip: string;
    country?: string;
    org?: string;
    asn?: number;
  };
  stats: {
    timeMs: number | null;
    totalHops: number;
  };
  rawOutput?: string;
  hops: TracerouteHop[];
}

export interface TracerouteResponse {
  target: string;
  provider: string;
  probeLocation?: string;
  probeCountry?: string;
  totalHops?: number;
  durationMs: number;
  hops: TracerouteHop[];
  note?: string;
  probes?: TracerouteProbeResult[];
}

// 11. Port Check Types
export interface PortCheckResult {
  port: number;
  service: string;
  protocol: string;
  open: boolean;
  durationMs: number;
  status: 'OPEN' | 'CLOSED' | 'FILTERED';
}

export interface PortCheckResponse {
  host: string;
  results: PortCheckResult[];
  summary?: {
    total: number;
    open: number;
    closed: number;
    filtered: number;
  };
  /** Aviso cuando el backend no pudo sondear algunos puertos por restricciones de la plataforma (Edge). */
  notice?: string;
}

// 12. Speed Test Types
export interface SpeedTestPingData {
  current: number;
  min: number;
  avg: number;
  max: number;
  jitter: number;
}

export interface SpeedTestThroughputData {
  currentMbps: number;
  avgMbps: number;
  peakMbps: number;
  transferredBytes: number;
}

export interface SpeedTestPoint {
  timeMs: number;
  phase: 'ping' | 'download' | 'upload';
  mbps: number;
  pingMs?: number;
}

export interface SpeedTestResult {
  ping: SpeedTestPingData;
  download: SpeedTestThroughputData;
  upload: SpeedTestThroughputData;
  bufferbloat: {
    idlePing: number;
    loadedPing: number;
    difference: number;
    grade: 'A+' | 'A' | 'B' | 'C' | 'D' | 'F';
  };
  server: {
    name: string;
    location: string;
    endpoint: string;
  };
  isp?: string;
  ip?: string;
  timestamp: number;
}

