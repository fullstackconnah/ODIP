const VERSION = __SW_VERSION__
const PRECACHE = __SW_PRECACHE__
const CACHE = `bunya-shell-${VERSION}`
self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(PRECACHE.map((u) => new Request(u, { cache: 'reload' })))).then(() => self.skipWaiting()))
})
self.addEventListener('activate', (e) => {
  e.waitUntil(caches.keys()
    .then((keys) => Promise.all(keys.filter((k) => k.startsWith('bunya-shell-') && k !== CACHE).map((k) => caches.delete(k))))
    .then(() => self.clients.claim()))
})
self.addEventListener('fetch', (e) => {
  const req = e.request
  if (req.method !== 'GET') return
  const url = new URL(req.url)
  // Data stays in app code (tenant, view-as, token): never the API, the landing page or other origins.
  if (url.origin !== self.location.origin || url.pathname.startsWith('/api/') || url.pathname.startsWith('/welcome')) return
  if (req.mode === 'navigate') {
    const shell = () => caches.match('/index.html', { cacheName: CACHE }).then((r) => r ?? Response.error())
    // The tunnel up with the origin down answers 502-504: that is offline too, so fall back to the cached shell.
    e.respondWith(fetch(req).then((r) => (r.status >= 502 && r.status <= 504 ? shell() : r), shell))
    return
  }
  if (url.pathname.startsWith('/assets/') || PRECACHE.includes(url.pathname)) {
    e.respondWith(caches.open(CACHE).then(async (c) => {
      const hit = await c.match(req)
      if (hit) return hit
      const res = await fetch(req)
      if (res.ok && url.pathname.startsWith('/assets/')) c.put(req, res.clone()) // hashed names, safe to keep
      return res
    }))
  }
})
// shortcut: navigations have no timeout, so a captive or very weak signal waits for the browser timeout; add a ~4 s race if workers report slow opens.
