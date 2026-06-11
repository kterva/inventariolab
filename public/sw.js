self.addEventListener('install', (e) => {
  self.skipWaiting();
});

self.addEventListener('activate', (e) => {
  e.waitUntil(self.clients.claim());
});

self.addEventListener('fetch', (e) => {
  // Service worker mínimo para que el navegador reconozca la PWA.
  // No cachea nada por ahora, solo deja pasar las peticiones.
  e.respondWith(fetch(e.request).catch(() => new Response('Offline')));
});
