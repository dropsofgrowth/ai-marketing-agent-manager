/*
 * Marketing Agent service worker — deliberately minimal.
 *
 * What it does
 * - Precaches a small bilingual offline page (/offline.html) and the app icon.
 * - When the device reports it is offline, page navigations get that page
 *   instead of the browser's error screen.
 *
 * What it deliberately does NOT do
 * - Cache dashboard HTML, RSC payloads, API responses or Server Action calls:
 *   data must always be fresh, and approvals must never be replayed from a cache.
 * - Intercept requests while online: the browser handles them natively, so
 *   HTTP Basic Auth prompts, redirects and streaming behave exactly as without
 *   a service worker. (Hashed /_next/static assets are already cached by the
 *   browser's HTTP cache with immutable headers.)
 *
 * Bump VERSION when the precached files change.
 */
const VERSION = "v1";
const CACHE = `marketing-agent-${VERSION}`;
const OFFLINE_URL = "/offline.html";
const PRECACHE = [OFFLINE_URL, "/icons/icon-192.png"];

self.addEventListener("install", (event) => {
  event.waitUntil(
    (async () => {
      const cache = await caches.open(CACHE);
      await cache.addAll(PRECACHE.map((url) => new Request(url, { cache: "reload" })));
      await self.skipWaiting();
    })(),
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    (async () => {
      const keys = await caches.keys();
      await Promise.all(keys.filter((key) => key.startsWith("marketing-agent-") && key !== CACHE).map((key) => caches.delete(key)));
      await self.clients.claim();
    })(),
  );
});

self.addEventListener("fetch", (event) => {
  const { request } = event;
  if (request.method !== "GET" || request.mode !== "navigate") return;
  if (self.navigator.onLine !== false) return;
  event.respondWith(
    (async () => {
      const cached = await caches.match(OFFLINE_URL);
      return cached ?? Response.error();
    })(),
  );
});
