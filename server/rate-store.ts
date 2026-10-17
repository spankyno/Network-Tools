import { FallbackRateStore, MemoryRateStore, type HitOptions, type HitResult, type RateStore } from '../shared/rate-limit.ts';

// Atómico en el servidor Redis: ventana fija con TTL autorreparable.
//  - strict=1: no suma si superaría el máximo (cuotas de bytes)
//  - si la clave existe sin TTL (p. ej. caída entre INCR y EXPIRE en implementaciones ingenuas) se le asigna
const HIT_LUA = `
local cur = tonumber(redis.call('GET', KEYS[1]) or '0')
local cost = tonumber(ARGV[2])
local max = tonumber(ARGV[3])
if ARGV[4] == '1' and cur + cost > max then
  local t = redis.call('PTTL', KEYS[1])
  if t < 0 then t = tonumber(ARGV[1]) end
  return {cur, t, 0}
end
local c = redis.call('INCRBY', KEYS[1], cost)
local ttl = redis.call('PTTL', KEYS[1])
if ttl < 0 then
  redis.call('PEXPIRE', KEYS[1], ARGV[1])
  ttl = tonumber(ARGV[1])
end
return {c, ttl, 1}
`;

/** Subconjunto de ioredis que usamos (facilita los tests sin depender de la librería). */
export interface RedisLike {
  eval(script: string, numKeys: number, ...args: Array<string | number>): Promise<unknown>;
  quit?(): Promise<unknown>;
}

export class RedisRateStore implements RateStore {
  constructor(private redis: RedisLike, private prefix = 'netcheck:rl:') {}

  async hit(key: string, windowMs: number, cost = 1, opts: HitOptions = {}): Promise<HitResult> {
    const res = (await this.redis.eval(
      HIT_LUA,
      1,
      this.prefix + key,
      windowMs,
      cost,
      opts.max ?? 0,
      opts.strict ? '1' : '0'
    )) as [number, number, number];
    if (!Array.isArray(res) || res.length < 3) throw new Error('Respuesta inesperada de Redis');
    return { count: Number(res[0]), resetMs: Math.max(0, Number(res[1])), applied: Number(res[2]) === 1 };
  }
}

/**
 * REDIS_URL definida → Redis con fallback a memoria si falla. Sin ella → memoria por proceso.
 * Redis es opcional: ioredis solo se carga si se usa.
 */
export async function createRateStore(
  env: NodeJS.ProcessEnv = process.env
): Promise<{ store: RateStore; kind: 'redis' | 'memory'; connected: boolean; close: () => Promise<void> }> {
  const url = env.REDIS_URL?.trim();
  if (!url) return { store: new MemoryRateStore(), kind: 'memory', connected: false, close: async () => undefined };

  const { default: Redis } = await import('ioredis');
  const client = new Redis(url, {
    maxRetriesPerRequest: 1, // fallar rápido y caer a memoria en vez de encolar peticiones
    enableOfflineQueue: false,
    connectTimeout: 3000,
    commandTimeout: 1000, // el rate limit está en el camino crítico de cada petición
    lazyConnect: false,
  });
  let lastError = '';
  client.on('error', (e: Error) => {
    lastError = e.message; // los errores se tratan por operación en FallbackRateStore; aquí solo se recuerda el último
  });

  // Con enableOfflineQueue=false, las operaciones antes de conectar fallan (y caerían a memoria sin avisar).
  // Se espera a 'ready' un tiempo acotado para que el arranque sea honesto y las primeras peticiones ya usen Redis.
  const connected = await new Promise<boolean>((resolve) => {
    if (client.status === 'ready') return resolve(true);
    const timer = setTimeout(() => resolve(false), 3000);
    client.once('ready', () => {
      clearTimeout(timer);
      resolve(true);
    });
  });
  if (!connected) {
    console.warn(
      `[rate-limit] Redis no respondió en 3 s (${lastError || 'sin detalle'}). Se usa memoria local y se reintentará conectar en segundo plano.`
    );
  }

  return {
    store: new FallbackRateStore(new RedisRateStore(client as unknown as RedisLike)),
    kind: 'redis',
    connected,
    close: async () => {
      await client.quit().catch(() => undefined);
    },
  };
}
