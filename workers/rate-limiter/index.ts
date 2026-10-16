// Worker independiente que aloja el Durable Object `RateLimiter`.
// Pages Functions no puede definir clases de Durable Object; se despliega aparte y Pages lo enlaza
// con un binding (ver workers/rate-limiter/README.md).
//
// Cada clave (p. ej. "heavy|203.0.113.7") es UN Durable Object: procesa las peticiones de una en una,
// así el contador es estrictamente consistente en todas las ubicaciones del mundo (Workers KV no sirve:
// es eventualmente consistente y no tiene operaciones atómicas).

interface HitBody {
  windowMs: number;
  cost: number;
  max: number;
  strict: boolean;
}

const clamp = (n: unknown, lo: number, hi: number, dflt: number) =>
  typeof n === 'number' && Number.isFinite(n) ? Math.min(hi, Math.max(lo, n)) : dflt;

export class RateLimiter {
  // Una ventana por objeto. Si el objeto se descarta por inactividad, la siguiente petición abre una ventana
  // nueva: en el peor caso un límite algo más permisivo tras un periodo sin tráfico, nunca más restrictivo.
  private count = 0;
  private reset = 0;

  constructor(_state?: unknown, _env?: unknown) {}

  async fetch(request: Request): Promise<Response> {
    if (request.method !== 'POST') return new Response('Method Not Allowed', { status: 405 });
    let raw: Partial<HitBody>;
    try {
      raw = (await request.json()) as Partial<HitBody>;
    } catch {
      return new Response('Bad Request', { status: 400 });
    }
    const body: HitBody = {
      windowMs: clamp(raw.windowMs, 1, 3_600_000, 60_000),
      cost: clamp(raw.cost, 0, 1e12, 1),
      max: clamp(raw.max, 0, 1e12, 0),
      strict: raw.strict === true,
    };

    const now = Date.now();
    if (this.reset <= now) {
      this.count = 0;
      this.reset = now + body.windowMs;
    }
    let applied = true;
    if (body.strict && this.count + body.cost > body.max) applied = false;
    else this.count += body.cost;

    return Response.json({ count: this.count, resetMs: this.reset - now, applied });
  }
}

export default {
  async fetch(): Promise<Response> {
    return new Response('netcheck-rate-limiter: solo accesible mediante binding', { status: 404 });
  },
};
