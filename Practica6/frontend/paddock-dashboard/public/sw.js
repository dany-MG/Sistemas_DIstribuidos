const CACHE_NAME = 'lmu-paddock-telemetry-v1';
const STATIC_FALLBACK_PACK = '/data/sebring_session_pack.json';

const PRECACHE_URLS = [
    '/',
    STATIC_FALLBACK_PACK,
    '/cars/porsche.webp',
];

self.addEventListener('install', (event) => {
    self.skipWaiting();
    event.waitUntil(
        caches.open(CACHE_NAME).then((cache) => {
            return cache.addAll(PRECACHE_URLS).catch(() => {});
        })
    );
});

self.addEventListener('activate', (event) => {
    event.waitUntil(
        caches.keys().then((keys) =>
            Promise.all(
                keys.map((key) => {
                    if (key !== CACHE_NAME) {
                        return caches.delete(key);
                    }
                })
            )
        ).then(() => self.clients.claim())
    );
});

/**
 * Estrategia para el paquete de telemetría (/session-pack o /data/sebring_session_pack.json):
 * 1. Si ya está en CacheStorage del Service Worker, responde inmediatamente en <5ms
 *    y actualiza en segundo plano (Stale-While-Revalidate) sin hacer esperar al usuario.
 * 2. Si no está en caché, intenta descargarlo del servidor con un timeout corto (2.5s);
 *    si Render está dormido (cold start), responde al instante con el paquete estático
 *    de Vercel (/data/sebring_session_pack.json) y despierta a Render en segundo plano.
 */
async function handleSessionPackRequest(request) {
    const cache = await caches.open(CACHE_NAME);
    const cachedResponse = await cache.match(request);

    const networkFetchPromise = (async () => {
        const controller = new AbortController();
        const timer = setTimeout(() => controller.abort(), 3000);
        try {
            const response = await fetch(request, { signal: controller.signal });
            clearTimeout(timer);
            if (response && response.ok) {
                cache.put(request, response.clone());
                return response;
            }
        } catch {
            clearTimeout(timer);
        }
        return null;
    })();

    if (cachedResponse) {
        return cachedResponse;
    }

    const networkResponse = await networkFetchPromise;
    if (networkResponse) {
        return networkResponse;
    }

    // Fallback instantáneo al paquete estático local en caso de cold-start de Render
    const fallbackCached = await cache.match(STATIC_FALLBACK_PACK);
    if (fallbackCached) {
        return fallbackCached;
    }

    const staticResp = await fetch(STATIC_FALLBACK_PACK);
    if (staticResp && staticResp.ok) {
        cache.put(STATIC_FALLBACK_PACK, staticResp.clone());
    }
    return staticResp;
}

self.addEventListener('fetch', (event) => {
    const url = new URL(event.request.url);

    // Interceptamos el paquete de sesión de telemetría
    if (
        url.pathname.endsWith('/session-pack') ||
        url.pathname.endsWith('/sebring_session_pack.json')
    ) {
        event.respondWith(handleSessionPackRequest(event.request));
        return;
    }

    // Cache-First para las imágenes .webp de los autos
    if (url.pathname.startsWith('/cars/') && url.pathname.endsWith('.webp')) {
        event.respondWith(
            caches.open(CACHE_NAME).then(async (cache) => {
                const cached = await cache.match(event.request);
                if (cached) return cached;
                const resp = await fetch(event.request);
                if (resp && resp.ok) {
                    cache.put(event.request, resp.clone());
                }
                return resp;
            })
        );
    }
});
