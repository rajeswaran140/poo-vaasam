/**
 * Tamilagaval service worker — PUSH ONLY.
 *
 * Deliberately has NO `fetch` handler: it never intercepts, caches, or alters
 * any request, so it cannot disrupt the live site. It only shows new-song push
 * notifications and routes a click to the right page. Registered lazily — only
 * after a visitor opts into notifications (see push-client.ts), so anyone who
 * doesn't opt in never gets a service worker at all.
 */

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

// Activate immediately so the first opt-in works without a reload.
self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', (event) => event.waitUntil(self.clients.claim()));
