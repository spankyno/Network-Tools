import type { HitOptions, HitResult, RateStore } from './rate-limit.ts';

/** Subconjunto mínimo de la API de Durable Objects (evita depender de @cloudflare/workers-types). */
export interface DurableObjectNamespaceLike {
  idFromName(name: string): unknown;
  get(id: unknown): { fetch(input: string, init?: RequestInit): Promise<Response> };
}

/** Cliente del Durable Object `RateLimiter` (workers/rate-limiter). Un objeto por clave. */
export class DurableObjectRateStore implements RateStore {
  constructor(private ns: DurableObjectNamespaceLike, private timeoutMs = 800) {}

  async hit(key: string, windowMs: number, cost = 1, opts: HitOptions = {}): Promise<HitResult> {
    const stub = this.ns.get(this.ns.idFromName(key));
    const res = await stub.fetch('https://rate-limiter/hit', {
      method: 'POST',
      body: JSON.stringify({ windowMs, cost, max: opts.max ?? 0, strict: opts.strict === true }),
      signal: AbortSignal.timeout(this.timeoutMs), // el límite va en el camino crítico: no esperar a un DO lento
    });
    if (!res.ok) throw new Error(`RateLimiter DO ${res.status}`);
    const data = (await res.json()) as HitResult;
    return { count: Number(data.count), resetMs: Math.max(0, Number(data.resetMs)), applied: data.applied !== false };
  }
}
