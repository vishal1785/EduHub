/**
 * service-worker.js
 * ---------------------------------------------------------------------
 * Offline caching for the app shell and content data.
 *
 * WHY THIS IS NOT A SIMPLE "CACHE-FIRST, UPDATE IN THE BACKGROUND"
 * WORKER
 *
 * The app is plain ES modules with no build step, so js/app.js,
 * js/storage.js, js/quiz.js and the rest must ALWAYS be served as one
 * matching set. An earlier version of this file served whatever was in
 * the cache and refreshed each file in the background as it was
 * requested. Those refreshes are per-file and racy, so after an update a
 * browser could end up holding a NEW js/app.js next to an OLD
 * js/storage.js - and the app died with
 * "storage.getActiveQuizzes is not a function".
 *
 * The fix is that the cache is only ever written as a whole, by
 * cache.addAll() during install. Nothing is written per request, so
 * whatever is in a given cache is always one internally consistent
 * snapshot. Requests are served from that snapshot, and anything not in
 * it falls through to the network.
 *
 * Bump CACHE_NAME whenever any cached file changes. The new worker
 * precaches the new set, skipWaiting()/clients.claim() hand control over
 * immediately, and the old cache is deleted on activate.
 * ---------------------------------------------------------------------
 */

const CACHE_NAME = "learn-splash-v13";

// Paths are relative to this file's location, so this works whether the
// app is served from a domain root or a GitHub Pages project subpath.
// tests/run.py checks this list against the files actually on disk, so a
// new module cannot be left out by accident.
const PRECACHE_PATHS = [
  "./",
  "./index.html",
  "./manifest.json",
  "./css/style.css",
  "./js/app.js",
  "./js/storage.js",
  "./js/quiz.js",
  "./js/generators.js",
  "./js/progress.js",
  "./js/ui.js",
  "./data/subjects.json",
  "./data/syllabus.json",
  "./data/questions.json",
  "./data/config.json",
  "./icons/icon.svg",
  "./icons/icon-192.png",
  "./icons/icon-512.png",
];

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches
      .open(CACHE_NAME)
      // addAll is all-or-nothing: either the whole new set lands or the
      // install fails and the old worker stays in charge. That is exactly
      // the guarantee we need to avoid a half-updated app.
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
    caches.open(CACHE_NAME).then((cache) =>
      // ignoreSearch so "css/style.css?v=9" still matches the precached
      // "css/style.css". Without it a versioned URL would miss the cache
      // entirely and the app would stop working offline.
      cache.match(req, { ignoreSearch: true }).then((cached) => {
        // Served straight from this version's snapshot. Deliberately no
        // cache.put() here - see the note at the top of this file.
        if (cached) return cached;
        return fetch(req).catch(() => cached || Response.error());
      })
    )
  );
});

/**
 * Let the page force a clean reinstall ("Update App" in More -> App).
 * Clears every cache and drops this worker, so the next load fetches a
 * fresh, consistent set from the network.
 */
self.addEventListener("message", (event) => {
  if (!event.data || event.data.type !== "RESET_CACHES") return;
  event.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.map((k) => caches.delete(k))))
      .then(() => self.registration.unregister())
      .then(() => {
        if (event.source && event.source.postMessage) {
          event.source.postMessage({ type: "RESET_CACHES_DONE" });
        }
      })
  );
});
