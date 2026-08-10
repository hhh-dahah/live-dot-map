/* 活点地图 PWA service worker:离线可用;地图数据不经此处(走 File System Access)
   HTML 走「网络优先」(拿最新版,离线回落缓存),静态资源走「缓存优先」 */
const CACHE = 'live-dot-map-v3';
const SHELL = [
  './',
  './app.html',
  './manifest.webmanifest',
  './icons/icon-192.png',
  './icons/icon-512.png'
];

self.addEventListener('install', e => {
  e.waitUntil(caches.open(CACHE).then(c => c.addAll(SHELL)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', e => {
  e.waitUntil(
    caches.keys()
      .then(keys => Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', e => {
  if (e.request.method !== 'GET') return;
  const url = new URL(e.request.url);
  if (url.origin !== location.origin) return;
  const isHtml = e.request.mode === 'navigate' || url.pathname.endsWith('.html') || url.pathname.endsWith('/');
  if (isHtml){
    // 网络优先:有新版本立即生效;断网时回落缓存
    e.respondWith(
      fetch(e.request).then(res => {
        if (res.ok){ const cp = res.clone(); caches.open(CACHE).then(c => c.put(e.request, cp)); }
        return res;
      }).catch(() => caches.match(e.request, { ignoreSearch: true }).then(hit => hit || caches.match('./app.html')))
    );
    return;
  }
  // 静态资源缓存优先
  e.respondWith(
    caches.match(e.request, { ignoreSearch: true }).then(hit => hit || fetch(e.request).then(res => {
      if (res.ok){ const cp = res.clone(); caches.open(CACHE).then(c => c.put(e.request, cp)); }
      return res;
    }))
  );
});
