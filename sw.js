// sw.js — Service Worker for background push notifications
// Must be served from the same origin as the HTML file.
// Place this file at the ROOT of your web server (e.g. /sw.js)

const SW_VERSION = 'notif-poc-v1';
const CACHE_NAME = 'daily-health-checklist-v1';
const APP_BASE_PATH = '/file-CDN/';
const APP_BASE_URL = `https://thechromosomes.github.io${APP_BASE_PATH}`;
const URLS_TO_CACHE = [
  APP_BASE_PATH,
  `${APP_BASE_PATH}index.html`,
  `${APP_BASE_PATH}manifest.webmanifest`,
  `${APP_BASE_PATH}icon-192.svg`,
  `${APP_BASE_PATH}icon-512.svg`,
];

// ── Install ──────────────────────────────────────────────────────────────────
globalThis.addEventListener('install', (event) => {
  console.log('[SW] Install', SW_VERSION);
  event.waitUntil(caches.open(CACHE_NAME).then((cache) => cache.addAll(URLS_TO_CACHE)));
  // Skip waiting so the new SW activates immediately
  globalThis.skipWaiting();
});

// ── Activate ─────────────────────────────────────────────────────────────────
globalThis.addEventListener('activate', (event) => {
  console.log('[SW] Activate', SW_VERSION);
  event.waitUntil(
    caches
      .keys()
      .then((keys) =>
        Promise.all(keys.filter((key) => key !== CACHE_NAME).map((key) => caches.delete(key)))
      )
      .then(() => globalThis.clients.claim())
  );
});

// ── Fetch (cache-first fallback when offline) ───────────────────────────────
globalThis.addEventListener('fetch', (event) => {
  if (event.request.method !== 'GET') return;

  event.respondWith(
    fetch(event.request)
      .then((networkResponse) => {
        const responseClone = networkResponse.clone();
        caches.open(CACHE_NAME).then((cache) => cache.put(event.request, responseClone));
        return networkResponse;
      })
      .catch(() =>
        caches
          .match(event.request)
          .then((cached) => cached || caches.match(`${APP_BASE_PATH}index.html`) || caches.match(APP_BASE_PATH))
      )
  );
});

// ── Push event (server-sent push via Web Push Protocol) ──────────────────────
// Triggered when a push message arrives from a push server (requires VAPID setup).
globalThis.addEventListener('push', (event) => {
  let data = { title: 'Notification', body: 'You have a new update.', icon: '🔔', tag: 'default' };

  if (event.data) {
    try {
      data = { ...data, ...event.data.json() };
    } catch {
      data.body = event.data.text();
    }
  }

  const options = buildNotificationOptions(data);

  event.waitUntil(
    globalThis.registration.showNotification(data.title, options)
  );
});

// ── Message from main page (in-page triggered notifications) ──────────────────
// The main page posts a message to the SW to show a notification.
// This works even when the tab is in the background.
globalThis.addEventListener('message', (event) => {
  if (event.origin && event.origin !== globalThis.location.origin) return;
  if (event.data?.type !== 'SHOW_NOTIFICATION') return;

  const data = event.data.payload || {};
  const options = buildNotificationOptions(data);

  event.waitUntil(
    globalThis.registration.showNotification(data.title || 'Notification', options)
  );
});

// ── Notification click ────────────────────────────────────────────────────────
globalThis.addEventListener('notificationclick', (event) => {
  event.notification.close();

  const urlToOpen = event.notification.data?.url || APP_BASE_URL;

  event.waitUntil(
    globalThis.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((clientList) => {
      // Focus existing tab if open
      for (const client of clientList) {
        if (client.url === urlToOpen && 'focus' in client) {
          // Notify the page that the notification was clicked
          client.postMessage({ type: 'NOTIFICATION_CLICKED', tag: event.notification.tag });
          return client.focus();
        }
      }
      // Otherwise open a new window
      if (globalThis.clients.openWindow) {
        return globalThis.clients.openWindow(urlToOpen);
      }
    })
  );
});

// ── Notification close ────────────────────────────────────────────────────────
globalThis.addEventListener('notificationclose', (event) => {
  // Broadcast to all open tabs
  globalThis.clients.matchAll({ type: 'window' }).then((clients) => {
    clients.forEach((client) => {
      client.postMessage({ type: 'NOTIFICATION_CLOSED', tag: event.notification.tag });
    });
  });
});

// ── Helper ────────────────────────────────────────────────────────────────────
function buildNotificationOptions(data) {
  return {
    body: data.body || '',
    // icon must be a URL, not an emoji. Use a canvas-generated data URL passed from the page,
    // or a fallback PNG. We store it in data if the page sends it.
    icon: data.iconUrl || data.icon || undefined,
    badge: data.badgeUrl || undefined,
    tag: data.tag || 'default',
    // renotify: show even if same tag exists
    renotify: true,
    // requireInteraction keeps the notification until user acts (desktop only)
    requireInteraction: data.requireInteraction || false,
    // vibrate pattern for mobile
    vibrate: [100, 50, 100],
    // Pass arbitrary data through to notificationclick
    data: {
      url: data.url || APP_BASE_URL,
      tag: data.tag,
      timestamp: Date.now(),
    },
    // Actions (shown as buttons on Android / some desktop)
    actions: data.actions || [],
    // timestamp shown in notification
    timestamp: Date.now(),
    // Silent flag
    silent: data.silent || false,
  };
}
