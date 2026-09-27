var CACHE = "schedule-app-v2";
var ASSETS = ["./", "./index.html", "./style.css", "./app.js", "./manifest.json"];

self.addEventListener("install", function (event) {
  event.waitUntil(
    caches.open(CACHE).then(function (cache) {
      return cache.addAll(ASSETS);
    })
  );
  self.skipWaiting();
});

self.addEventListener("activate", function (event) {
  event.waitUntil(
    caches.keys().then(function (keys) {
      return Promise.all(
        keys.filter(function (k) { return k !== CACHE; }).map(function (k) { return caches.delete(k); })
      );
    })
  );
  self.clients.claim();
});

self.addEventListener("fetch", function (event) {
  event.respondWith(
    fetch(event.request)
      .then(function (fresh) {
        var copy = fresh.clone();
        caches.open(CACHE).then(function (cache) {
          cache.put(event.request, copy);
        });
        return fresh;
      })
      .catch(function () {
        return caches.match(event.request);
      })
  );
});
