/* DatumPro service worker — chat push notifications.
 *
 * Receives the payload the chat-push Edge Function sends ({ title, body, url,
 * conversationId }), shows a notification, and on click focuses an existing tab
 * for that URL or opens a new one. Kept dependency-free and tiny. */

self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', (event) => event.waitUntil(self.clients.claim()));

self.addEventListener('push', (event) => {
  let payload = {};
  try {
    payload = event.data ? event.data.json() : {};
  } catch {
    payload = { title: 'DatumPro', body: event.data ? event.data.text() : 'New message' };
  }
  const title = payload.title || 'DatumPro';
  const url = payload.url || '/';
  event.waitUntil(
    self.registration.showNotification(title, {
      body: payload.body || '',
      tag: payload.conversationId || undefined, // collapse repeats per conversation
      renotify: true,
      data: { url },
      icon: '/icon-192.png',
      badge: '/badge-72.png',
    }),
  );
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const url = (event.notification.data && event.notification.data.url) || '/';
  event.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((clientList) => {
      for (const client of clientList) {
        // Focus an already-open tab if one is on the same origin.
        if ('focus' in client) {
          const sameOrigin = new URL(client.url).origin === self.location.origin;
          if (sameOrigin) {
            client.focus();
            if ('navigate' in client) client.navigate(url).catch(() => {});
            return;
          }
        }
      }
      return self.clients.openWindow(url);
    }),
  );
});
