// Abstracción de almacén para límites de ritmo y cuotas. Pura (sin APIs de Node/Cloudflare):
//   MemoryRateStore  → por proceso (por defecto)
//   RedisRateStore   → server/rate-store.ts (Node, varias instancias)
//   DurableObjectRateStore → shared/rate-limit-do.ts (Cloudflare, varias ubicaciones)
// FallbackRateStore degrada a memoria si el almacén externo falla: se prefiere un límite
// por instancia a dejar la API sin protección (o caída) por un fallo de Redis.

export interface HitResult {
  /** Contador de la ventana tras esta operación. */
  count: number;
  /** Milisegundos hasta que se reinicia la ventana. */
  resetMs: number;
  /** false si en modo `strict` la operación se rechazó y NO se contabilizó. */
  applied: boolean;
}

export interface HitOptions {
  /** Techo de la ventana; necesario con `strict`. */
  max?: number;
  /**
   * Solo suma si cur + cost <= max (cuotas de bytes: una petición rechazada no gasta presupuesto).
   * Sin `strict` siempre suma (límite de ritmo: martillear también cuenta).
   */
  strict?: boolean;
}

export interface RateStore {
  /** Ventana fija: la primera operación sobre una clave abre una ventana de `windowMs`. */
  hit(key: string, windowMs: number, cost?: number, opts?: HitOptions): Promise<HitResult>;
}

export class MemoryRateStore implements RateStore {
  private m = new Map<string, { count: number; reset: number }>();

  constructor(private maxKeys = 10_000) {}

  async hit(key: string, windowMs: number, cost = 1, opts: HitOptions = {}): Promise<HitResult> {
    const now = Date.now();
    if (this.m.size >= this.maxKeys) {
      for (const [k, v] of this.m) if (v.reset <= now) this.m.delete(k);
      if (this.m.size >= this.maxKeys) this.m.clear(); // último recurso: evitar crecimiento sin límite
    }
    let e = this.m.get(key);
    if (!e || e.reset <= now) {
      e = { count: 0, reset: now + windowMs };
      this.m.set(key, e);
    }
    if (opts.strict && opts.max !== undefined && e.count + cost > opts.max) {
      return { count: e.count, resetMs: e.reset - now, applied: false };
    }
    e.count += cost;
    return { count: e.count, resetMs: e.reset - now, applied: true };
  }
}

export class FallbackRateStore implements RateStore {
  private lastLog = 0;

  constructor(
    private primary: RateStore,
    private fallback: RateStore = new MemoryRateStore(),
    private onError: (err: unknown) => void = (err) => console.error('[rate-limit] almacén externo no disponible; usando memoria local:', err)
  ) {}

  async hit(key: string, windowMs: number, cost?: number, opts?: HitOptions): Promise<HitResult> {
    try {
      return await this.primary.hit(key, windowMs, cost, opts);
    } catch (err) {
      const now = Date.now();
      if (now - this.lastLog > 30_000) {
        this.lastLog = now; // evita inundar los logs si el almacén está caído
        this.onError(err);
      }
      return this.fallback.hit(key, windowMs, cost, opts);
    }
  }
}

export interface LimitDecision {
  allowed: boolean;
  remaining: number;
  retryAfterSec: number;
}

/** Límite de ritmo: `max` operaciones por ventana y clave. */
export async function takeFrom(store: RateStore, key: string, windowMs: number, max: number): Promise<LimitDecision> {
  const r = await store.hit(key, windowMs, 1);
  return {
    allowed: r.count <= max,
    remaining: Math.max(0, max - r.count),
    retryAfterSec: Math.max(1, Math.ceil(r.resetMs / 1000)),
  };
}
