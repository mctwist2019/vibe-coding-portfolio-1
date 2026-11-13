/* 오프라인 지원: 네트워크 우선, 실패 시 캐시 */
var CACHE = 'golf-score-v18';
var ASSETS = ['./', './index.html', './styles.css', './games.js', './analysis.js', './courses.js', './coursemaps.js', './sync.js', './app.js', './vendor/mqtt.min.js', './icon.svg', './icon-192.png', './icon-512.png', './icon-maskable-512.png', './apple-touch-icon.png', './manifest.webmanifest'];

self.addEventListener('install', function (e) {
  e.waitUntil(caches.open(CACHE).then(function (c) { return c.addAll(ASSETS); }).then(function () { return self.skipWaiting(); }));
});
self.addEventListener('activate', function (e) {
  e.waitUntil(caches.keys().then(function (keys) {
    // 같은 origin(계정의 다른 GitHub Pages 사이트)의 캐시는 건드리지 않고 이 앱의 옛 버전만 삭제
    return Promise.all(keys.filter(function (k) { return k.indexOf('golf-score-') === 0 && k !== CACHE; }).map(function (k) { return caches.delete(k); }));
  }).then(function () { return self.clients.claim(); }));
});
// 같은 origin의 다른 서비스 워커가 이 캐시를 지웠더라도 온라인 방문 시 프리캐시를 다시 채움 (install은 SW가 바뀔 때만 다시 돌기 때문)
var precacheChecked = false;
function ensurePrecache() {
  if (precacheChecked) return;
  precacheChecked = true;
  caches.open(CACHE).then(function (c) {
    return c.match('./index.html').then(function (hit) { if (!hit) return c.addAll(ASSETS); });
  }).catch(function () { precacheChecked = false; });
}
self.addEventListener('fetch', function (e) {
  if (e.request.method !== 'GET') return;
  // 코스 폴더(courses/)의 목록과 코스 파일은 늘 네트워크에서 받고 저장해 두지 않는다. 연결이 안 될 때 예전 사본으로 답하면
  // 앱이 그것을 지금 자료로 안다: 고쳐 올린 코스를 받았다고 적거나, 목록에 없는 코스라고 여기고 다시 찾지 않는다
  if (e.request.url.indexOf(self.registration.scope + 'courses/') === 0) return;
  var isNav = e.request.mode === 'navigate';
  e.respondWith(
    fetch(e.request).then(function (res) {
      if (res && res.ok && res.type === 'basic') {
        var copy = res.clone();
        caches.open(CACHE).then(function (c) { c.put(e.request, copy); });
        if (isNav) ensurePrecache();
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
