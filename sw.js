/* Guarda Onda en el teléfono para que abra sin internet. La música no pasa por aquí: vive en IndexedDB.
   Con internet siempre se pide la versión más nueva (y se guarda); sin internet se usa la guardada.
   Al cambiar archivos, sube VERSION y APP_VERSION (js/app.js). */
const VERSION = 'onda-12';
const FILES = [
  './', 'index.html', 'app.css', 'manifest.webmanifest',
  'js/db.js', 'js/tags.js', 'js/demo.js', 'js/player.js', 'js/online.js', 'js/lyrics.js', 'js/app.js',
  'icons/icon-192.png', 'icons/icon-512.png', 'icons/icon-maskable-512.png', 'icons/apple-touch-icon.png'
];

self.addEventListener('install', (e) => {
  // cache: 'reload' evita guardar copias viejas de la caché HTTP del servidor.
  e.waitUntil(caches.open(VERSION)
    .then((c) => c.addAll(FILES.map((f) => new Request(f, { cache: 'reload' }))))
    .then(() => self.skipWaiting()));
});

self.addEventListener('activate', (e) => {
  e.waitUntil(caches.keys()
    .then((keys) => Promise.all(keys.filter((k) => k.startsWith('onda-') && k !== VERSION).map((k) => caches.delete(k))))
    .then(() => self.clients.claim()));
});

self.addEventListener('fetch', (e) => {
  const req = e.request;
  if (req.method !== 'GET' || new URL(req.url).origin !== location.origin) return;
  e.respondWith((async () => {
    const cache = await caches.open(VERSION);
    try {
      // (una petición de navegación no se puede copiar con opciones: se pide por su URL)
      const fresh = await fetch(new Request(req.url, { cache: 'no-cache', credentials: 'same-origin' }));
      if (fresh.ok) cache.put(req, fresh.clone());
      return fresh;
    } catch (err) {
      const hit = await cache.match(req, { ignoreSearch: true });
      if (hit) return hit;
      if (req.mode === 'navigate') return (await cache.match('index.html')) || Response.error();
      return Response.error();
    }
  })());
});
