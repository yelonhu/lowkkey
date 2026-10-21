/* lowkkey 的即开。壳（index.html）、它引用的静态资源和字体在本机留一份：打开先用本机的，
   后台再悄悄更新，下次打开就是新的。账户、事实与 AI 的接口永远走网络，从不缓存。 */
const VERSION = 'v1';
const SHELL = 'lowkkey-shell-' + VERSION,
  ASSETS = 'lowkkey-assets-' + VERSION,
  FONTS = 'lowkkey-fonts-' + VERSION;
const ASSET_LIMIT = 80;
// Everything the worker answers itself: sessions, facts, OAuth, the consent page, discovery, health.
const live = ['/api/', '/v1/', '/mcp', '/oauth/', '/authorize', '/.well-known/', '/healthz', '/__preview/'];
const isLive = path => live.some(prefix => path === prefix.replace(/\/$/, '') || path.startsWith(prefix));

self.addEventListener('install', event => {
  event.waitUntil(
    refreshShell()
      .catch(() => {})
      .then(() => self.skipWaiting()),
  );
});
self.addEventListener('activate', event => {
  event.waitUntil(
    caches
      .keys()
      .then(keys => Promise.all(keys.filter(key => ![SHELL, ASSETS, FONTS].includes(key)).map(key => caches.delete(key))))
      .then(() => self.clients.claim()),
  );
});
self.addEventListener('fetch', event => {
  const { request } = event;
  if (request.method !== 'GET') return;
  const url = new URL(request.url);
  if (url.origin === location.origin) {
    if (isLive(url.pathname)) return;
    if (request.mode === 'navigate') return event.respondWith(shell(request));
    if (url.pathname.startsWith('/assets/')) return event.respondWith(cacheFirst(ASSETS, request));
    if (/\.(png|webmanifest|ico|svg)$/.test(url.pathname))
      return event.respondWith(staleWhileRevalidate(ASSETS, request));
    return;
  }
  if (url.hostname === 'fonts.googleapis.com') return event.respondWith(staleWhileRevalidate(FONTS, request));
  if (url.hostname === 'fonts.gstatic.com') return event.respondWith(cacheFirst(FONTS, request));
});

/** The shell opens from the local copy at once; the network copy replaces it for next time. */
async function shell(request) {
  const cache = await caches.open(SHELL);
  const cached = await cache.match('/');
  const fresh = refreshShell().catch(() => null);
  if (cached) return cached;
  return (await fresh) ?? fetch(request);
}
/** Fetch the current shell, keep it, and warm the hashed assets it references so an older shell never
 *  points at files the server has since replaced. */
async function refreshShell() {
  const response = await fetch('/', { cache: 'no-cache' });
  if (!response.ok || !(response.headers.get('content-type') ?? '').includes('text/html')) return null;
  const copy = response.clone();
  const html = await response.text();
  const cache = await caches.open(SHELL);
  await cache.put('/', copy);
  const assets = [...html.matchAll(/(?:src|href)="(\/assets\/[^"]+)"/g)].map(m => m[1]);
  const store = await caches.open(ASSETS);
  await Promise.all(assets.map(async path => (await store.match(path)) || store.add(path).catch(() => {})));
  return copy;
}
async function cacheFirst(name, request) {
  const cache = await caches.open(name);
  const cached = await cache.match(request);
  if (cached) return cached;
  const response = await fetch(request);
  if (response.ok) {
    await cache.put(request, response.clone());
    void trim(cache);
  }
  return response;
}
async function staleWhileRevalidate(name, request) {
  const cache = await caches.open(name);
  const cached = await cache.match(request);
  const fresh = fetch(request)
    .then(async response => {
      if (response.ok) await cache.put(request, response.clone());
      return response;
    })
    .catch(() => null);
  return cached ?? (await fresh) ?? Response.error();
}
async function trim(cache) {
  const keys = await cache.keys();
  for (const key of keys.slice(0, Math.max(0, keys.length - ASSET_LIMIT))) await cache.delete(key);
}
