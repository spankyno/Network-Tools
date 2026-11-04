// Genera actividad "humana" contra Upstash Redis (REST) para evitar que la base de datos se archive por inactividad.
// Sin dependencias: requiere Node >= 18 (fetch nativo). Pensado para ejecutarse desde GitHub Actions.
//
// Variables de entorno:
//   UPSTASH_REDIS_REST_URL    (obligatoria) p. ej. https://xxxx.upstash.io
//   UPSTASH_REDIS_REST_TOKEN  (obligatoria)
//   APP_URL                   (opcional)    si se define, hace también 1-3 visitas ligeras a la web en producción
//   JITTER_MAX_SEC            (opcional)    espera aleatoria inicial máxima (por defecto 900 = 15 min)
//   SKIP_PROBABILITY          (opcional)    probabilidad 0-1 de "no hacer nada" en ejecuciones programadas (por defecto 0.15)
//   KEY_PREFIX                (opcional)    prefijo de las claves (por defecto netcheck:keepalive:)
//   DRY_RUN=1                 (opcional)    no envía nada, solo muestra lo que haría

const {
  UPSTASH_REDIS_REST_URL: REST_URL,
  UPSTASH_REDIS_REST_TOKEN: REST_TOKEN,
  APP_URL,
  JITTER_MAX_SEC = '900',
  SKIP_PROBABILITY = '0.15',
  KEY_PREFIX = 'netcheck:keepalive:',
  DRY_RUN,
  GITHUB_EVENT_NAME,
} = process.env;

// ---------- utilidades de aleatoriedad ----------
const rnd = (min, max) => Math.random() * (max - min) + min;
const rndInt = (min, max) => Math.floor(rnd(min, max + 1));
const pick = (arr) => arr[Math.floor(Math.random() * arr.length)];
const hex = (n = 6) => [...Array(n)].map(() => rndInt(0, 15).toString(16)).join('');
const sleep = (ms) => (DRY_RUN ? Promise.resolve() : new Promise((r) => setTimeout(r, ms)));
const log = (...a) => console.log(`[${new Date().toISOString()}]`, ...a);

/** Pausa "de persona": mayoría de pausas cortas, alguna larga (distribución log-normal). */
function thinkTime() {
  const u = Math.random() || 1e-9;
  const v = Math.random();
  const normal = Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
  const sec = Math.exp(Math.log(1.5) + 0.8 * normal); // mediana ≈ 1,5 s
  return Math.min(Math.max(sec, 0.3), 20) * 1000;
}

// ---------- cliente Upstash REST ----------
async function redis(...command) {
  if (DRY_RUN) {
    log('DRY_RUN redis →', command.join(' '));
    return null;
  }
  const res = await fetch(REST_URL, {
    method: 'POST',
    headers: { Authorization: `Bearer ${REST_TOKEN}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(command),
    signal: AbortSignal.timeout(15_000),
  });
  const body = await res.json().catch(() => ({}));
  if (!res.ok || body.error) throw new Error(`Upstash ${res.status}: ${body.error || res.statusText}`);
  log('redis', command[0], '→', JSON.stringify(body.result));
  return body.result;
}

// ---------- "perfiles" de sesión: imitan lo que haría la app real ----------
const profiles = {
  // Como el limitador de ritmo de la app: INCRBY + PEXPIRE + PTTL sobre claves con TTL.
  async rateLimiterLike() {
    const key = `${KEY_PREFIX}rl:${pick(['general', 'heavy', 'ports', 'trace'])}:${hex(8)}`;
    const hits = rndInt(1, 5);
    for (let i = 0; i < hits; i++) {
      await redis('INCRBY', key, String(rndInt(1, 3)));
      if (i === 0) await redis('PEXPIRE', key, String(pick([30_000, 60_000, 120_000, 300_000])));
      await sleep(thinkTime());
    }
    await redis('PTTL', key);
    if (Math.random() < 0.5) await redis('DEL', key);
  },
  // Caché de resultados: SET con caducidad + lecturas.
  async cacheLike() {
    const key = `${KEY_PREFIX}cache:${pick(['dns', 'ip', 'whois', 'ssl'])}:${hex(8)}`;
    const payload = JSON.stringify({ t: Date.now(), v: hex(rndInt(8, 64)), n: rndInt(0, 9999) });
    await redis('SET', key, payload, 'EX', String(rndInt(600, 21_600)));
    await sleep(thinkTime());
    await redis('GET', key);
    if (Math.random() < 0.6) {
      await sleep(thinkTime());
      await redis('EXISTS', key);
    }
    if (Math.random() < 0.4) await redis('TTL', key);
  },
  // Contador diario / "latido" con hash.
  async counterLike() {
    const day = new Date().toISOString().slice(0, 10);
    await redis('INCR', `${KEY_PREFIX}visits:${day}`);
    await redis('EXPIRE', `${KEY_PREFIX}visits:${day}`, String(60 * 60 * 24 * 3));
    await sleep(thinkTime());
    await redis('HSET', `${KEY_PREFIX}last`, 'ts', String(Date.now()), 'run', hex(4));
    await redis('EXPIRE', `${KEY_PREFIX}last`, String(60 * 60 * 24 * 7));
    if (Math.random() < 0.5) await redis('HGETALL', `${KEY_PREFIX}last`);
  },
  // Lectura ligera.
  async lightRead() {
    await redis('PING');
    await sleep(thinkTime());
    await redis('DBSIZE');
    if (Math.random() < 0.5) await redis('GET', `${KEY_PREFIX}last`);
  },
};

// ---------- visitas opcionales a la web (solo toca Cloudflare, NO Upstash) ----------
const USER_AGENTS = [
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 14_4) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.4 Safari/605.1.15',
  'Mozilla/5.0 (X11; Linux x86_64; rv:125.0) Gecko/20100101 Firefox/125.0',
  'Mozilla/5.0 (iPhone; CPU iPhone OS 17_4 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.4 Mobile/15E148 Safari/604.1',
];
const DOMAINS = ['example.com', 'wikipedia.org', 'github.com', 'cloudflare.com', 'mozilla.org', 'iana.org'];

async function visitApp() {
  const base = APP_URL.replace(/\/$/, '');
  const ua = pick(USER_AGENTS);
  // Solo rutas ligeras y no protegidas por Turnstile.
  const paths = [
    '/',
    '/api/config',
    '/api/speedtest/ping',
    `/api/dns?name=${pick(DOMAINS)}&type=${pick(['A', 'AAAA', 'MX', 'TXT', 'NS'])}`,
  ];
  const n = rndInt(1, 3);
  const chosen = ['/', ...paths.slice(1).sort(() => Math.random() - 0.5)].slice(0, n);
  for (const p of chosen) {
    try {
      if (DRY_RUN) log('DRY_RUN app →', base + p);
      else {
        const res = await fetch(base + p, { headers: { 'User-Agent': ua, 'Accept-Language': pick(['es-ES,es;q=0.9', 'en-US,en;q=0.9']) }, signal: AbortSignal.timeout(15_000) });
        log('app', p, '→', res.status);
      }
    } catch (e) {
      log('aviso: fallo visitando', p, '-', e.message); // no hace fallar el job
    }
    await sleep(thinkTime());
  }
}

// ---------- ejecución ----------
async function main() {
  if (!DRY_RUN && (!REST_URL || !REST_TOKEN)) throw new Error('Faltan UPSTASH_REDIS_REST_URL / UPSTASH_REDIS_REST_TOKEN');

  // Variabilidad: a veces se salta la ejecución (solo en las programadas, nunca en las manuales).
  if (GITHUB_EVENT_NAME === 'schedule' && Math.random() < Number(SKIP_PROBABILITY)) {
    log('Ejecución omitida al azar (se reintentará en la próxima).');
    return;
  }

  // Jitter temporal: espera inicial aleatoria.
  const waitSec = Math.floor(rnd(0, Number(JITTER_MAX_SEC)));
  log(`Jitter inicial: ${waitSec}s`);
  await sleep(waitSec * 1000);

  // Sesión: 1-3 perfiles distintos, en orden aleatorio; siempre al menos uno con escritura.
  const writers = ['rateLimiterLike', 'cacheLike', 'counterLike'];
  const names = [pick(writers)];
  const extras = Object.keys(profiles).filter((n) => n !== names[0]).sort(() => Math.random() - 0.5).slice(0, rndInt(0, 2));
  names.push(...extras);
  names.sort(() => Math.random() - 0.5);
  log('Perfiles:', names.join(', '));

  for (const name of names) {
    await profiles[name]();
    await sleep(thinkTime() * rnd(1, 3));
  }

  if (APP_URL) await visitApp();
  log('Actividad completada.');
}

main().catch((e) => {
  console.error('ERROR:', e.message);
  process.exit(1);
});
