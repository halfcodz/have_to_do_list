/* 좋됨감지앱 service worker
 * 배포할 때마다 VERSION 문자열만 올리면 캐시가 갱신된다.
 * - HTML / manifest : network-first  (배포 즉시 최신 반영, 오프라인이면 캐시)
 * - 이미지 / 아이콘 : cache-first    (빠르게, 없으면 네트워크)
 * - push           : Cloudflare Worker가 보낸 알림 표시
 */
var VERSION = "2026-09-05e";
var CACHE = "jotdoem-" + VERSION;

var PRECACHE = [
  "./",
  "./index.html",
  "./manifest.webmanifest",
  "./worry.png",
  "./doubt.png",
  "./anxiety.png",
  "./punch-2.png",
  "./assets/icon-192.png",
  "./assets/icon-512.png",
  "./assets/icon-maskable-512.png",
  "./assets/apple-touch-icon.png"
];

// 새 SW는 곧바로 활성화하지 않고 대기한다. 페이지가 "업데이트" 버튼으로 승인하면
// SKIP_WAITING 메시지를 받아 활성화 → controllerchange → 페이지가 새로고침.
self.addEventListener("install", function(e){
  e.waitUntil(
    caches.open(CACHE).then(function(c){ return c.addAll(PRECACHE); })
  );
});

self.addEventListener("message", function(e){
  if(e.data && e.data.type === "SKIP_WAITING") self.skipWaiting();
});

self.addEventListener("activate", function(e){
  e.waitUntil(
    caches.keys().then(function(keys){
      return Promise.all(keys.map(function(k){
        if(k !== CACHE) return caches.delete(k);
      }));
    }).then(function(){ return self.clients.claim(); })
  );
});

function isHtmlish(req, url){
  return req.mode === "navigate" ||
         url.pathname.endsWith("/") ||
         url.pathname.endsWith("/index.html") ||
         url.pathname.endsWith("/manifest.webmanifest");
}

self.addEventListener("fetch", function(e){
  var req = e.request;
  if(req.method !== "GET") return;

  var url = new URL(req.url);
  if(url.origin !== self.location.origin) return;

  if(isHtmlish(req, url)){
    e.respondWith(
      fetch(req).then(function(res){
        var copy = res.clone();
        caches.open(CACHE).then(function(c){ c.put(req, copy); }).catch(function(){});
        return res;
      }).catch(function(){
        return caches.match(req).then(function(hit){ return hit || caches.match("./index.html"); });
      })
    );
    return;
  }

  e.respondWith(
    caches.match(req).then(function(hit){
      return hit || fetch(req).then(function(res){
        var copy = res.clone();
        caches.open(CACHE).then(function(c){ c.put(req, copy); }).catch(function(){});
        return res;
      });
    })
  );
});

/* ---------- push notifications ---------- */
self.addEventListener("push", function(e){
  var data = {};
  try{ data = e.data ? e.data.json() : {}; }catch(_){ data = {}; }
  var title = data.title || "좋됨감지앱";
  var opts = {
    body: data.body || "",
    tag: data.tag || "jotdoem",
    renotify: true,
    icon: "assets/icon-192.png",
    badge: "assets/icon-192.png",
    data: { url: data.url || "./" }
  };
  e.waitUntil(self.registration.showNotification(title, opts));
});

self.addEventListener("notificationclick", function(e){
  e.notification.close();
  var target = (e.notification.data && e.notification.data.url) || "./";
  e.waitUntil(
    self.clients.matchAll({ type: "window", includeUncontrolled: true }).then(function(list){
      for(var i=0;i<list.length;i++){
        if("focus" in list[i]) return list[i].focus();
      }
      return self.clients.openWindow(target);
    })
  );
});
