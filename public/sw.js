/* YachtPics Broker Portal — service worker (#35)
 *
 * Strategy:
 *  - Navigations: network-first, fall back to a cached offline page when the
 *    network is unavailable. Authenticated HTML is never cached, so brokers
 *    never see a stale dashboard or a logged-out shell.
 *  - Static build assets (/_next/static, /icons, fonts): stale-while-revalidate.
 *  - Supabase, Stripe, and /api requests: passed straight through to the
 *    network (never cached) to avoid stale data and stale auth tokens.
 *
 * Bump CACHE_VERSION whenever the precache list or strategy changes.
 */
const CACHE_VERSION = "v5";
const PRECACHE = `yachtpics-precache-${CACHE_VERSION}`;
const RUNTIME = `yachtpics-runtime-${CACHE_VERSION}`;
const OFFLINE_URL = "/offline";

const PRECACHE_URLS = [
  OFFLINE_URL,
  "/icons/icon-192.png",
  "/icons/icon-512.png",
  "/icons/icon-maskable-512.png",
];

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches
      .open(PRECACHE)
      // Cache each URL individually so one missing/invalid asset never blocks
      // the whole install (which would prevent the SW from ever activating).
      .then((cache) => Promise.all(PRECACHE_URLS.map((u) => cache.add(u).catch(() => {}))))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) =>
        Promise.all(
          keys
            .filter((key) => key !== PRECACHE && key !== RUNTIME)
            .map((key) => caches.delete(key))
        )
      )
      .then(() => self.clients.claim())
  );
});

// Allow the page to tell a waiting worker to activate immediately.
self.addEventListener("message", (event) => {
  if (event.data === "SKIP_WAITING") self.skipWaiting();
});

function isStaticAsset(url) {
  return (
    url.pathname.startsWith("/_next/static/") ||
    url.pathname.startsWith("/icons/") ||
    /\.(?:css|js|woff2?|ttf|otf|png|jpg|jpeg|gif|svg|webp|ico)$/.test(
      url.pathname
    )
  );
}

self.addEventListener("fetch", (event) => {
  const { request } = event;

  // Only handle same-origin GET requests. Everything else (Supabase, Stripe,
  // POST/PUT, etc.) goes straight to the network untouched.
  if (request.method !== "GET") return;

  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;

  // Never cache API routes — they are dynamic / auth-bound.
  if (url.pathname.startsWith("/api/")) return;

  // Navigations: network-first with offline fallback. We intentionally do NOT
  // cache the response, so authenticated pages are always re-fetched fresh.
  if (request.mode === "navigate") {
    event.respondWith(
      // `cache: "no-store"` is deliberate: a plain fetch() here still honours the
      // HTTP cache, which could hand back a stale admin page (a gallery missing
      // from the list, or photos missing inside it because the signed URLs were
      // baked into old HTML). Authenticated pages must always come from the
      // network — that's what a hard-refresh was working around.
      fetch(request, { cache: "no-store" }).catch(() =>
        caches.match(OFFLINE_URL, { ignoreSearch: true }).then(
          (cached) =>
            cached ||
            new Response("You are offline.", {
              status: 503,
              headers: { "Content-Type": "text/plain" },
            })
        )
      )
    );
    return;
  }

  // Static assets: stale-while-revalidate.
  if (isStaticAsset(url)) {
    event.respondWith(
      caches.open(RUNTIME).then(async (cache) => {
        const cached = await cache.match(request);
        const network = fetch(request)
          .then((response) => {
            if (response && response.status === 200 && response.type === "basic") {
              cache.put(request, response.clone());
            }
            return response;
          })
          .catch(() => cached);
        return cached || network;
      })
    );
  }
});

/* ---- Push notifications ---- */
self.addEventListener("push", (event) => {
  let data = {};
  try {
    data = event.data ? event.data.json() : {};
  } catch {
    data = { body: event.data ? event.data.text() : "" };
  }
  const title = data.title || "YachtPics Portal";
  const options = {
    body: data.body || "",
    icon: "/icons/icon-192.png",
    badge: "/icons/icon-192.png",
    tag: data.tag,
    data: { url: data.url || "/dashboard" },
  };
  event.waitUntil(self.registration.showNotification(title, options));
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const target = (event.notification.data && event.notification.data.url) || "/dashboard";
  event.waitUntil(
    self.clients
      .matchAll({ type: "window", includeUncontrolled: true })
      .then((clientList) => {
        for (const client of clientList) {
          if (client.url.includes(target) && "focus" in client) return client.focus();
        }
        if (self.clients.openWindow) return self.clients.openWindow(target);
      })
  );
});
