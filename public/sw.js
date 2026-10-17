const CACHE_NAME = 'netcheck-cache-v6';
const MAX_RUNTIME_ENTRIES = 300; // teselas de mapa y fuentes: sin tope la caché crecía indefinidamente
const STATIC_ASSETS = [
  '/',
  '/index.html',
  '/manifest.webmanifest',
  '/theme-init.js',
  '/icon.svg',
];

// Coincidencia exacta o por subdominio real (antes se usaba includes(), que aceptaba "evil-openstreetmap.org.attacker.com")
const ALLOWED_HOSTS = [
  'fonts.googleapis.com',
  'fonts.gstatic.com',
  'tile.openstreetmap.org',
  'tile.openstreetmap.fr',
  'basemaps.cartocdn.com',
];

async function trimCache(cache, max) {
  const keys = await cache.keys();
  if (keys.length > max) {
    await Promise.all(keys.slice(0, keys.length - max).map((k) => cache.delete(k)));
  }
}

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => {
      return cache.addAll(STATIC_ASSETS);
    }).catch(() => {
      // Tolerar fallos en instalación offline
    })
  );
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) => {
      return Promise.all(
        keys.map((key) => {
          if (key !== CACHE_NAME) {
            return caches.delete(key);
          }
        })
      );
    })
  );
  self.clients.claim();
});

self.addEventListener('fetch', (event) => {
  // Ignorar solicitudes que no sean GET
  if (event.request.method !== 'GET') {
    return;
  }

  let url;
  try {
    url = new URL(event.request.url);
  } catch {
    return;
  }

  // Filtrar estrictamente esquemas no soportados por la Cache API (chrome-extension, blob, data, etc.)
  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    return;
  }

  // Nunca interceptar ni almacenar en caché peticiones a la API interna /api/
  if (url.pathname.startsWith('/api/')) {
    return;
  }

  // Para navegación de páginas HTML, estrategia Network-first con fallback a caché
  if (event.request.mode === 'navigate') {
    event.respondWith(
      fetch(event.request).catch(async () => {
        const cache = await caches.open(CACHE_NAME);
        return (await cache.match('/')) || (await cache.match('/index.html')) || Response.error();
      })
    );
    return;
  }

  // Solo cachear recursos de nuestro mismo origen o CDNs reconocidas (Leaflet, fuentes, etc.)
  const isSameOrigin = url.origin === self.location.origin;
  const isAllowedCdn = ALLOWED_HOSTS.some((h) => url.hostname === h || url.hostname.endsWith('.' + h));

  if (!isSameOrigin && !isAllowedCdn) {
    return;
  }

  // Para assets estáticos: Stale-while-revalidate seguro con manejo de errores
  event.respondWith(
    caches.match(event.request).then((cachedResponse) => {
      const fetchPromise = fetch(event.request)
        .then((networkResponse) => {
          // Solo almacenar respuestas exitosas válidas de http/https
          if (
            networkResponse &&
            networkResponse.status === 200 &&
            (networkResponse.type === 'basic' || networkResponse.type === 'cors') &&
            (url.protocol === 'http:' || url.protocol === 'https:')
          ) {
            const responseClone = networkResponse.clone();
            caches.open(CACHE_NAME).then((cache) => {
              cache
                .put(event.request, responseClone)
                .then(() => trimCache(cache, MAX_RUNTIME_ENTRIES))
                .catch(() => {
                  // Silenciar de forma segura cualquier fallo de almacenamiento en caché
                });
            }).catch(() => {});
          }
          return networkResponse;
        })
        // Sin red y sin copia en caché hay que devolver una Response igualmente: respondWith(undefined) lanza
        // "TypeError: Failed to convert value to 'Response'" y rompe la petición (p. ej. las teselas del mapa).
        .catch(() => cachedResponse || Response.error());

      return cachedResponse || fetchPromise;
    })
  );
});
