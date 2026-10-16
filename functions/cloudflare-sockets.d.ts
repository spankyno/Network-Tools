// Tipos mínimos de la API de sockets TCP de Cloudflare Workers (el módulo solo existe en el runtime de Workers).
declare module 'cloudflare:sockets' {
  export function connect(
    address: { hostname: string; port: number },
    options?: { secureTransport?: 'off' | 'on' | 'starttls'; allowHalfOpen?: boolean }
  ): { opened: Promise<unknown>; closed: Promise<void>; close(): Promise<void> };
}
