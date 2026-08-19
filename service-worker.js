/**
 * service-worker.js
 * ---------------------------------------------------------------------
 * Minimal offline-first caching. Precaches the app shell and content
 * data on install, then serves cache-first with a network fallback
 * (and updates the cache in the background when the network works).
 *
 * Bump CACHE_NAME whenever any cached file changes so old clients pick
 * up the new version instead of serving stale files forever.
 * ---------------------------------------------------------------------
 */

const CACHE_NAME = "class7-practice-v1";

// Paths are relative to this file's location, so this works whether the
// app is served from a domain root or a GitHub Pages project subpath.
const PRECACHE_PATHS = [
  "./",
  "./index.html",
  "./manifest.json",
  "./css/style.css",
  "./js/app.js",
  "./js/storage.js",
  "./js/quiz.js",
  "./js/progress.js",
  "./js/ui.js",
  "./data/subjects.json",
  "./data/syllabus.json",
  "./data/questions.json",
  "./data/config.json",
  "./icons/icon-192.png",
  "./icons/icon-512.png",
];

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches
      .open(CACHE_NAME)
      .then((cache) => cache.addAll(PRECACHE_PATHS.map((p) => new URL(p, self.location).href)))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE_NAME).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener("fetch", (event) => {
  const req = event.request;
  if (req.method !== "GET") return;

  // Only handle same-origin requests; let everything else pass through untouched.
  if (new URL(req.url).origin !== self.location.origin) return;

  event.respondWith(
    caches.match(req).then((cached) => {
      const networkFetch = fetch(req)
        .then((res) => {
          if (res && res.status === 200) {
            const clone = res.clone();
            caches.open(CACHE_NAME).then((cache) => cache.put(req, clone));
          }
          return res;
        })
        .catch(() => cached);
      return cached || networkFetch;
    })
  );
});
