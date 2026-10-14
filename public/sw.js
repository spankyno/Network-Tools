const CACHE_NAME = 'netcheck-cache-v2';
const STATIC_ASSETS = [
  '/',
  '/index.html',
  '/manifest.webmanifest',
  '/icon.svg',
];

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

  // Filtrar esquemas no soportados por la Cache API (chrome-extension, blob, data, etc.)
  if (!event.request.url.startsWith('http://') && !event.request.url.startsWith('https://')) {
    return;
  }

  let url;
  try {
    url = new URL(event.request.url);
  } catch {
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
  const isAllowedCdn =
    url.hostname.includes('unpkg.com') ||
    url.hostname.includes('fonts.googleapis.com') ||
    url.hostname.includes('fonts.gstatic.com') ||
    url.hostname.includes('openstreetmap.org') ||
    url.hostname.includes('basemaps.cartocdn.com');

  if (!isSameOrigin && !isAllowedCdn) {
    return;
  }

  // Para assets estáticos: Stale-while-revalidate seguro con manejo de errores
  event.respondWith(
    caches.match(event.request).then((cachedResponse) => {
      const fetchPromise = fetch(event.request)
        .then((networkResponse) => {
          // Solo almacenar respuestas exitosas válidas
          if (
            networkResponse &&
            networkResponse.status === 200 &&
            (networkResponse.type === 'basic' || networkResponse.type === 'cors')
          ) {
            const responseClone = networkResponse.clone();
            caches.open(CACHE_NAME).then((cache) => {
              cache.put(event.request, responseClone).catch(() => {
                // Silenciar de forma segura cualquier fallo de almacenamiento en caché
              });
            }).catch(() => {});
          }
          return networkResponse;
        })
        .catch(() => cachedResponse);

      return cachedResponse || fetchPromise;
    })
  );
});
