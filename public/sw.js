/**
 * Tamilagaval service worker — push, plus a single offline fallback page.
 *
 * Registered lazily: by push-client.ts when a visitor opts into notifications,
 * and by the Mastering studio so that admin tool is installable.
 *
 * ⚠️ WHAT THIS DELIBERATELY DOES NOT DO. It caches no HTML, no API response and
 * no audio. The one and only cached file is /offline.html, a static page with
 * nothing account-specific in it. That restraint is a security property, not an
 * oversight: a service worker controls the whole origin including /admin, and
 * anything it cached would outlive sign-out on a shared device. It also means
 * this can never serve a stale admin page or a stale master.
 *
 * The fetch handler exists for two reasons: browsers have historically required
 * one before offering to install an app, and a navigation that fails should say
 * so rather than showing the browser's dinosaur. It intercepts NOTHING else —
 * every non-navigation request, and every navigation that succeeds, passes
 * through untouched.
 */

const OFFLINE_URL = '/offline.html';
const OFFLINE_CACHE = 'tamilagaval-offline-v1';

self.addEventListener('push', (event) => {
  let data = {};
  try {
    data = event.data ? event.data.json() : {};
  } catch (_e) {
    data = { body: event.data ? event.data.text() : '' };
  }
  const title = data.title || 'தமிழகவல்';
  const options = {
    body: data.body || '',
    icon: data.icon || '/icons/icon-192.png',
    badge: '/icons/icon-192.png',
    tag: data.tag || 'tamilagaval-song',
    data: { url: data.url || '/songs' },
  };
  event.waitUntil(self.registration.showNotification(title, options));
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const url = (event.notification.data && event.notification.data.url) || '/songs';
  event.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((list) => {
      for (const client of list) {
        if (client.url.includes(url) && 'focus' in client) return client.focus();
      }
      return self.clients.openWindow(url);
    })
  );
});

/**
 * Serve the offline page ONLY when a navigation could not reach the network.
 *
 * `event.request.mode === 'navigate'` is the guard that keeps this away from
 * everything else: API calls, S3 uploads, audio and images are never touched,
 * so a flaky connection can never turn a failed upload into a silently cached
 * "success". A successful navigation is returned exactly as the network gave
 * it — nothing is stored.
 */
self.addEventListener('fetch', (event) => {
  if (event.request.mode !== 'navigate') return;
  event.respondWith(
    fetch(event.request).catch(async () => {
      const cached = await caches.match(OFFLINE_URL);
      // If even the fallback is missing, let the browser show its own error
      // rather than an empty 200 that looks like the page loaded.
      return cached || Response.error();
    })
  );
});

// Activate immediately so the first opt-in works without a reload.
self.addEventListener('install', (event) => {
  event.waitUntil(
    caches
      .open(OFFLINE_CACHE)
      .then((cache) => cache.add(OFFLINE_URL))
      // A precache failure must not block activation: push notifications are
      // the older, more important job and they need no cache at all.
      .catch(() => undefined)
      .then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) =>
        Promise.all(keys.filter((k) => k !== OFFLINE_CACHE).map((k) => caches.delete(k)))
      )
      .then(() => self.clients.claim())
  );
});
