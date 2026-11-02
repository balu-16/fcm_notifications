import { useCallback, useEffect, useRef, useState } from 'react';
import {
  onMessage,
  onRegistered,
  register,
  unregister,
  type Messaging,
  type MessagePayload,
  type Unsubscribe,
} from 'firebase/messaging';
import { api } from '../../lib/api';
import { setupMessaging } from '../../lib/firebase';
import { displayForegroundNotification } from './displayNotification';

type State =
  | 'checking'
  | 'unsupported'
  | 'default'
  | 'denied'
  | 'registering'
  | 'registered'
  | 'disabled'
  | 'failed';
interface Saved {
  id: string;
  owner: string;
}
const STORAGE_KEY = 'notifications.registration';
const DISABLED_KEY = 'notifications.disabled';
function saved(): Saved | undefined {
  try {
    const value = localStorage.getItem(STORAGE_KEY);
    return value ? (JSON.parse(value) as Saved) : undefined;
  } catch {
    return undefined;
  }
}
function save(value?: Saved): void {
  try {
    if (value) localStorage.setItem(STORAGE_KEY, JSON.stringify(value));
    else localStorage.removeItem(STORAGE_KEY);
  } catch {
    /* Browser storage can be unavailable. */
  }
}
function disabled(): boolean {
  try {
    return localStorage.getItem(DISABLED_KEY) === 'true';
  } catch {
    return false;
  }
}
function setDisabled(value: boolean): void {
  try {
    localStorage.setItem(DISABLED_KEY, String(value));
  } catch {
    /* No durable preference available. */
  }
}
async function withTimeout<T>(promise: Promise<T>): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      promise,
      new Promise<never>((_, reject) => {
        timer = setTimeout(() => reject(new Error('Timed out')), 5000);
      }),
    ]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

export function usePush(userId: string) {
  const [state, setState] = useState<State>('checking');
  const [error, setError] = useState('');
  const messaging = useRef<Messaging | undefined>(undefined);
  const worker = useRef<ServiceWorkerRegistration | undefined>(undefined);
  const initializing = useRef<Promise<void> | undefined>(undefined);
  const subscriptions = useRef<Unsubscribe[]>([]);
  const allowed = useRef(false);
  const alive = useRef(true);
  const task = useRef<Promise<void>>(Promise.resolve());
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);

  const initialize = useCallback(async () => {
    if (messaging.current && worker.current && subscriptions.current.length)
      return;
    if (initializing.current) return initializing.current;
    const setupOnce = (async () => {
      const setup = await setupMessaging();
      if (!alive.current || !allowed.current) return;
      messaging.current = setup.messaging;
      worker.current = setup.worker;
      subscriptions.current.push(
        onRegistered(setup.messaging, (id) => {
          task.current = task.current
            .catch(() => undefined)
            .then(async () => {
              if (!allowed.current) return;
              const previous = saved();
              await api.register(id);
              if (!allowed.current) {
                await api.unregister(id).catch(() => undefined);
                return;
              }
              save({ id, owner: userId });
              if (previous && previous.owner === userId && previous.id !== id)
                await api.unregister(previous.id).catch(() => undefined);
              if (timer.current) clearTimeout(timer.current);
              if (alive.current) {
                setError('');
                setState('registered');
              }
            })
            .catch(() => {
              if (alive.current && allowed.current) {
                setError(
                  'Could not register this browser with the server. Try again.',
                );
                setState('failed');
              }
            });
        }),
      );
      subscriptions.current.push(
        onMessage(setup.messaging, (payload: MessagePayload) => {
          if (!allowed.current || Notification.permission !== 'granted') return;
          void displayForegroundNotification(setup.worker, payload)
            .then(() => {
              if (alive.current) setError('');
            })
            .catch((cause: unknown) => {
              if (alive.current)
                setError(
                  cause instanceof Error
                    ? cause.message
                    : 'Could not display the browser notification.',
                );
            });
        }),
      );
    })();
    initializing.current = setupOnce;
    try {
      await setupOnce;
    } finally {
      if (initializing.current === setupOnce) initializing.current = undefined;
    }
  }, [userId]);

  const refresh = useCallback(
    async (prompt = false) => {
      try {
        if (
          !('Notification' in window) ||
          !('serviceWorker' in navigator) ||
          !('PushManager' in window) ||
          !window.isSecureContext
        ) {
          setState('unsupported');
          return;
        }
        const permission = prompt
          ? await Notification.requestPermission()
          : Notification.permission;
        if (permission !== 'granted') {
          allowed.current = false;
          const previous = saved();
          if (previous?.owner === userId) {
            try {
              await api.unregister(previous.id);
              save();
            } catch {
              /* Retry on a later authenticated visit. */
            }
          }
          setState(permission === 'denied' ? 'denied' : 'default');
          return;
        }
        if (prompt) setDisabled(false);
        if (!prompt && disabled()) {
          setState('disabled');
          return;
        }
        allowed.current = true;
        setState('registering');
        setError('');
        await initialize();
        if (!alive.current || !allowed.current) return;
        if (!messaging.current || !worker.current)
          throw new Error('Messaging unavailable');
        if (timer.current) clearTimeout(timer.current);
        timer.current = setTimeout(() => {
          if (alive.current && allowed.current) {
            setError('Registration timed out. Try again.');
            setState('failed');
          }
        }, 15_000);
        await register(messaging.current, {
          vapidKey: import.meta.env.VITE_FIREBASE_VAPID_KEY,
          serviceWorkerRegistration: worker.current,
        });
      } catch (cause) {
        if (timer.current) clearTimeout(timer.current);
        if (alive.current) {
          setState('failed');
          setError(
            cause instanceof Error
              ? cause.message
              : 'Could not register notifications.',
          );
        }
      }
    },
    [initialize, userId],
  );

  const disconnect = useCallback(
    async (explicit: boolean) => {
      allowed.current = false;
      if (timer.current) clearTimeout(timer.current);
      if (explicit) setDisabled(true);
      await task.current.catch(() => undefined);
      const previous = saved();
      let failed = false;
      if (previous?.owner === userId) {
        try {
          await api.unregister(previous.id);
          save();
        } catch {
          failed = true;
        }
      }
      if (explicit && messaging.current)
        try {
          await withTimeout(unregister(messaging.current));
        } catch {
          failed = true;
        }
      if (alive.current && explicit) {
        setState(failed ? 'failed' : 'disabled');
        setError(
          failed
            ? 'Some cleanup could not finish while offline. Retry when you are connected.'
            : '',
        );
      }
    },
    [userId],
  );

  useEffect(() => {
    alive.current = true;
    void refresh();
    const onVisibility = () => {
      if (document.visibilityState === 'visible') void refresh();
    };
    document.addEventListener('visibilitychange', onVisibility);
    return () => {
      alive.current = false;
      allowed.current = false;
      if (timer.current) clearTimeout(timer.current);
      subscriptions.current.forEach((unsubscribe) => unsubscribe());
      subscriptions.current = [];
      messaging.current = undefined;
      worker.current = undefined;
      document.removeEventListener('visibilitychange', onVisibility);
    };
  }, [refresh]);

  return {
    state,
    error,
    enable: () => refresh(true),
    retry: () => (disabled() ? disconnect(true) : refresh()),
    disable: () => disconnect(true),
    disconnectForLogout: () => disconnect(false),
  };
}
