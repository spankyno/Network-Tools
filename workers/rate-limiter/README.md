# netcheck-rate-limiter (Durable Object)

Limitador distribuido para las Pages Functions. **Opcional**: sin él, las Functions usan un límite en memoria por isolate.

## Despliegue

```bash
cd workers/rate-limiter
npx wrangler deploy          # crea el Worker y aplica la migración v1
```

## Enlazarlo a Pages

Cloudflare Dashboard → *Workers & Pages* → tu proyecto Pages → *Settings* → *Bindings* → **Add** → *Durable Object*:

| Campo | Valor |
| --- | --- |
| Variable name | `RATE_LIMITER` |
| Durable Object namespace | `netcheck-rate-limiter` → `RateLimiter` |

(No añada un `wrangler.toml` en la raíz del repo solo para esto: pasaría a ser la fuente de verdad de la configuración
de Pages y desactivaría los ajustes del panel.)

Vuelva a desplegar Pages. Si el binding falla o no existe, las Functions caen automáticamente a memoria.
