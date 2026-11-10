// bondi service worker: makes the web app installable and shows the last loaded app when
// offline. Pages always come from the network first, so a new deploy is picked up at once.
// Clips and code are left to the browser cache (video needs range requests).
const CACHE = 'bondi-shell-v1';
self.addEventListener('install', (e) => { e.waitUntil(caches.open(CACHE).then((c) => c.add('/')).then(() => self.skipWaiting())); });
self.addEventListener('activate', (e) => {
  e.waitUntil(caches.keys().then((ks) => Promise.all(ks.filter((k) => k !== CACHE).map((k) => caches.delete(k)))).then(() => self.clients.claim()));
});
self.addEventListener('fetch', (e) => {
  if (e.request.mode !== 'navigate') return;
  e.respondWith(fetch(e.request).then((r) => {
    if (r.ok && new URL(e.request.url).pathname === '/') { const copy = r.clone(); caches.open(CACHE).then((c) => c.put('/', copy)); }
    return r;
  }).catch(() => caches.match('/')));
});
