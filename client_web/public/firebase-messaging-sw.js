/* Firebase config is public and comes from the registration URL; Vite cannot inject env into a public service worker. */
const config = Object.fromEntries(
  new URL(self.location.href).searchParams.entries(),
);

// Register before Firebase's listener so relative and localhost development links can be handled safely.
self.addEventListener('notificationclick', (event) => {
  const payload = event.notification.data && event.notification.data.FCM_MSG;
  if (!payload) return;
  event.stopImmediatePropagation();
  event.notification.close();
  const action =
    (payload.data && payload.data.clickAction) ||
    (payload.fcmOptions && payload.fcmOptions.link) ||
    '/';
  let target;
  try {
    if (
      typeof action !== 'string' ||
      action.startsWith('//') ||
      /[\u0000-\u001f\u007f\\]/u.test(action)
    )
      return;
    target = new URL(action, self.location.origin);
    if (
      target.username ||
      target.password ||
      (target.protocol !== 'https:' &&
        !(target.hostname === 'localhost' && target.protocol === 'http:'))
    )
      return;
  } catch {
    return;
  }
  event.waitUntil(
    (async () => {
      if (target.origin === self.location.origin) {
        const windows = await self.clients.matchAll({
          type: 'window',
          includeUncontrolled: true,
        });
        const existing = windows.find(
          (client) => new URL(client.url).origin === target.origin,
        );
        if (existing) {
          await existing.navigate(target.href);
          return existing.focus();
        }
      }
      return self.clients.openWindow(target.href);
    })(),
  );
});

// The Firebase SDK automatically displays notification payloads in the background.
importScripts(
  'https://www.gstatic.com/firebasejs/13.1.0/firebase-app-compat.js',
);
importScripts(
  'https://www.gstatic.com/firebasejs/13.1.0/firebase-messaging-compat.js',
);
firebase.initializeApp(config);
firebase.messaging();
