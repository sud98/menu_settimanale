// Come in GE WoodArt: prima prova la rete (così le modifiche al sito si vedono subito),
// se non c'è connessione usa la copia salvata.
// I dati di Supabase non passano da qui: arrivano sempre dal database.
const CACHE = 'menu-di-casa-v2';

const FILES = [
  './',
  './index.html',
  './css/style.css',
  './js/app.js',
  './js/engine.js',
  './js/store.js',
  './js/ai.js',
  './js/seed.js',
  './js/config.js',
  './manifest.json',
  './icon-192.png',
  './icon-512.png',
];

self.addEventListener('install', event => {
  event.waitUntil(caches.open(CACHE).then(cache => cache.addAll(FILES.map(f => new Request(f, { cache: 'reload' })))));
  self.skipWaiting();
});

self.addEventListener('activate', event => {
  event.waitUntil(caches.keys().then(keys => Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k)))));
  self.clients.claim();
});

self.addEventListener('fetch', event => {
  const req = event.request;
  if (req.method !== 'GET' || new URL(req.url).origin !== self.location.origin) return;

  // "no-cache": chiede sempre a GitHub se il file è cambiato
  event.respondWith(
    fetch(new Request(req.url, { cache: 'no-cache' }))
      .then(res => {
        if (res.ok) {
          const copy = res.clone();
          caches.open(CACHE).then(cache => cache.put(req.url.split('#')[0], copy));
        }
        return res;
      })
      .catch(() => caches.match(req, { ignoreSearch: true }).then(r => r || caches.match('./index.html'))),
  );
});
