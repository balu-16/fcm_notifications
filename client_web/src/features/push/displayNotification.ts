import type { MessagePayload } from 'firebase/messaging';

const storageKey = 'notifications.displayed';

// Firebase forwards foreground messages to every open tab. Serialize by ID
// and keep a short record so a later tab does not display the same push again.
export async function displayForegroundNotification(
  worker: ServiceWorkerRegistration,
  payload: MessagePayload,
): Promise<void> {
  if (Notification.permission !== 'granted')
    throw new Error('Browser notification permission is not granted.');
  if (!worker.active)
    throw new Error(
      'The notification service worker is not active. Reload and try again.',
    );
  const id =
    payload.data?.notificationId || payload.messageId || crypto.randomUUID();
  const tag = `notification-${id}`;
  const display = async () => {
    let seen: Record<string, number> = {};
    try {
      const parsed: unknown = JSON.parse(
        localStorage.getItem(storageKey) || '{}',
      );
      if (parsed && typeof parsed === 'object' && !Array.isArray(parsed))
        seen = parsed as Record<string, number>;
    } catch {
      /* Storage may be disabled. */
    }
    const now = Date.now();
    if (typeof seen[id] === 'number' && now - seen[id] < 86400000) return;
    if ((await worker.getNotifications({ tag })).length) return;
    try {
      await worker.showNotification(
        payload.notification?.title || 'Notification',
        {
          body: payload.notification?.body || '',
          ...(payload.notification?.image
            ? { image: payload.notification.image }
            : {}),
          tag,
          data: {
            FCM_MSG: {
              data: {
                clickAction:
                  payload.data?.clickAction || payload.fcmOptions?.link || '/',
              },
            },
          },
        },
      );
    } catch {
      throw new Error(
        'The browser could not display the notification. Check browser and system notification settings.',
      );
    }
    try {
      const recent = Object.fromEntries(
        Object.entries(seen)
          .filter(
            ([, time]) => typeof time === 'number' && now - time < 86400000,
          )
          .slice(-499),
      );
      recent[id] = now;
      localStorage.setItem(storageKey, JSON.stringify(recent));
    } catch {
      /* The notification was displayed even if storage is unavailable. */
    }
  };
  if (navigator.locks) await navigator.locks.request(`display-${tag}`, display);
  else await display();
}
