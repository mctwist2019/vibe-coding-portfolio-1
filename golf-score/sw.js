/* 오프라인 지원: 네트워크 우선, 실패 시 캐시 */
var CACHE = 'golf-score-v5';
var ASSETS = ['./', './index.html', './styles.css', './games.js', './sync.js', './app.js', './vendor/mqtt.min.js', './icon.svg', './icon-192.png', './icon-512.png', './icon-maskable-512.png', './apple-touch-icon.png', './manifest.webmanifest'];

self.addEventListener('install', function (e) {
  e.waitUntil(caches.open(CACHE).then(function (c) { return c.addAll(ASSETS); }).then(function () { return self.skipWaiting(); }));
});
self.addEventListener('activate', function (e) {
  e.waitUntil(caches.keys().then(function (keys) {
    // 같은 origin(계정의 다른 GitHub Pages 사이트)의 캐시는 건드리지 않고 이 앱의 옛 버전만 삭제
    return Promise.all(keys.filter(function (k) { return k.indexOf('golf-score-') === 0 && k !== CACHE; }).map(function (k) { return caches.delete(k); }));
  }).then(function () { return self.clients.claim(); }));
});
self.addEventListener('fetch', function (e) {
  if (e.request.method !== 'GET') return;
  var isNav = e.request.mode === 'navigate';
  e.respondWith(
    fetch(e.request).then(function (res) {
      if (res && res.ok && res.type === 'basic') {
        var copy = res.clone();
        caches.open(CACHE).then(function (c) { c.put(e.request, copy); });
      }
      return res;
    }).catch(function () {
      // 참여 링크(?join=...)처럼 쿼리가 붙은 페이지 요청도 캐시된 index.html로 응답
      return caches.match(e.request, { ignoreSearch: isNav }).then(function (hit) {
        return hit || (isNav ? caches.match('./index.html') : undefined);
      });
    })
  );
});
