// 漢字クエスト ｜ オフライン用 Service Worker
var CACHE = "kanji-quest-v2";
var ASSETS = [
  "./",
  "./index.html",
  "./css/style.css",
  "./js/kanji-data.js",
  "./js/app.js",
  "./manifest.webmanifest",
  "./fonts/dotgothic16-sub.woff2",
  "./icons/icon-180.png",
  "./icons/icon-192.png",
  "./icons/icon-512.png",
  "./img/tex_grass.png",
  "./img/tex_dirt.png",
  "./img/tex_stone.png",
  "./img/tex_cobble.png",
  "./img/tex_planks.png",
  "./img/heart_full.png",
  "./img/heart_empty.png",
  "./img/mob_creeper.png",
  "./img/mob_zombie.png",
  "./img/mob_skeleton.png",
  "./img/mob_spider.png",
  "./img/mob_slime.png",
  "./img/mob_enderman.png",
  "./img/mob_pig.png",
  "./img/mob_sheep.png",
  "./img/mob_ghast.png",
  "./img/mob_bee.png",
  "./img/mob_boss.png",
  "./img/mob_weak.png"
];

self.addEventListener("install", function (e) {
  e.waitUntil(
    caches.open(CACHE).then(function (c) { return c.addAll(ASSETS); }).then(function () {
      return self.skipWaiting();
    })
  );
});

self.addEventListener("activate", function (e) {
  e.waitUntil(
    caches.keys().then(function (keys) {
      return Promise.all(keys.map(function (k) { if (k !== CACHE) return caches.delete(k); }));
    }).then(function () { return self.clients.claim(); })
  );
});

self.addEventListener("fetch", function (e) {
  if (e.request.method !== "GET") return;
  e.respondWith(
    caches.match(e.request).then(function (hit) {
      if (hit) return hit;
      return fetch(e.request).then(function (res) {
        return caches.open(CACHE).then(function (c) { c.put(e.request, res.clone()); return res; });
      }).catch(function () { return caches.match("./index.html"); });
    })
  );
});
