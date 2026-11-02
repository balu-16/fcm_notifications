import { useCallback, useEffect, useRef, useState } from 'react';
import { AppState, Platform } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import * as Device from 'expo-device';
import * as Notifications from 'expo-notifications';
import { api } from './api';

type Status =
  | 'checking'
  | 'unsupported'
  | 'default'
  | 'denied'
  | 'registering'
  | 'registered'
  | 'disabled'
  | 'failed';
interface Saved {
  token: string;
  owner: string;
}
const TOKEN_KEY = 'notifications.registration';
const DISABLED_KEY = 'notifications.disabled';
async function getSaved(): Promise<Saved | undefined> {
  try {
    const value = await AsyncStorage.getItem(TOKEN_KEY);
    return value ? (JSON.parse(value) as Saved) : undefined;
  } catch {
    return undefined;
  }
}

export function usePush(userId: string) {
  const [status, setStatus] = useState<Status>('checking');
  const [error, setError] = useState('');
  const [canAskAgain, setCanAskAgain] = useState(true);
  const allowed = useRef(false);
  const alive = useRef(true);
  const task = useRef<Promise<void>>(Promise.resolve());
  const current = useRef<string | undefined>(undefined);
  const processing = useRef(false);

  const registerToken = useCallback(
    (token: string): Promise<void> => {
      if (current.current === token && processing.current) return task.current;
      current.current = token;
      processing.current = true;
      task.current = task.current
        .catch(() => undefined)
        .then(async () => {
          if (!allowed.current) return;
          const previous = await getSaved();
          await api.register(token);
          if (!allowed.current) {
            await api.unregister(token).catch(() => undefined);
            return;
          }
          await AsyncStorage.setItem(
            TOKEN_KEY,
            JSON.stringify({ token, owner: userId }),
          );
          if (previous?.owner === userId && previous.token !== token)
            await api.unregister(previous.token).catch(() => undefined);
          if (alive.current) {
            setError('');
            setStatus('registered');
          }
        })
        .catch(() => {
          if (alive.current && allowed.current) {
            setError(
              'Could not register this device. Check your connection and retry.',
            );
            setStatus('failed');
          }
        })
        .finally(() => {
          processing.current = false;
        });
      return task.current;
    },
    [userId],
  );

  const refresh = useCallback(
    async (prompt = false) => {
      try {
        if (Platform.OS !== 'android' || !Device.isDevice) {
          setStatus('unsupported');
          return;
        }
        // Android 13+ requires a channel before the permission prompt and before obtaining a token.
        await Notifications.setNotificationChannelAsync('default', {
          name: 'Default',
          importance: Notifications.AndroidImportance.HIGH,
        });
        const permission = prompt
          ? await Notifications.requestPermissionsAsync()
          : await Notifications.getPermissionsAsync();
        setCanAskAgain(permission.canAskAgain);
        if (!permission.granted) {
          allowed.current = false;
          const previous = await getSaved();
          if (previous?.owner === userId) {
            try {
              await api.unregister(previous.token);
              await AsyncStorage.removeItem(TOKEN_KEY);
            } catch {
              /* Retry next time the same user is online. */
            }
          }
          setStatus(permission.status === 'denied' ? 'denied' : 'default');
          return;
        }
        if (prompt) await AsyncStorage.setItem(DISABLED_KEY, 'false');
        if (!prompt && (await AsyncStorage.getItem(DISABLED_KEY)) === 'true') {
          setStatus('disabled');
          return;
        }
        allowed.current = true;
        setStatus('registering');
        setError('');
        let timeout: ReturnType<typeof setTimeout> | undefined;
        const result = await Promise.race([
          Notifications.getDevicePushTokenAsync(),
          new Promise<never>((_, reject) => {
            timeout = setTimeout(
              () => reject(new Error('Registration timed out.')),
              20_000,
            );
          }),
        ]).finally(() => {
          if (timeout) clearTimeout(timeout);
        });
        if (result.type !== 'android' || typeof result.data !== 'string')
          throw new Error('Native FCM token is unavailable.');
        if (alive.current && allowed.current) await registerToken(result.data);
      } catch (cause) {
        if (alive.current) {
          setStatus('failed');
          setError(
            cause instanceof Error
              ? cause.message
              : 'Could not enable notifications.',
          );
        }
      }
    },
    [registerToken, userId],
  );

  const disconnect = useCallback(
    async (explicit: boolean) => {
      allowed.current = false;
      if (explicit) await AsyncStorage.setItem(DISABLED_KEY, 'true');
      await task.current.catch(() => undefined);
      const previous = await getSaved();
      let failed = false;
      if (previous?.owner === userId) {
        try {
          await api.unregister(previous.token);
          await AsyncStorage.removeItem(TOKEN_KEY);
        } catch {
          failed = true;
        }
      }
      if (explicit)
        try {
          await Notifications.unregisterForNotificationsAsync();
        } catch {
          failed = true;
        }
      if (alive.current && explicit) {
        setStatus(failed ? 'failed' : 'disabled');
        setError(
          failed ? 'Some cleanup could not finish. Retry when online.' : '',
        );
      }
    },
    [userId],
  );

  useEffect(() => {
    alive.current = true;
    void refresh();
    const state = AppState.addEventListener('change', (value) => {
      if (value === 'active') void refresh();
    });
    // The callback already contains the new token; calling getDevicePushTokenAsync here would recurse.
    const token = Notifications.addPushTokenListener((value) => {
      if (
        allowed.current &&
        value.type === 'android' &&
        typeof value.data === 'string'
      )
        void registerToken(value.data);
    });
    return () => {
      alive.current = false;
      allowed.current = false;
      state.remove();
      token.remove();
    };
  }, [refresh, registerToken]);

  return {
    status,
    error,
    canAskAgain,
    enable: () => refresh(true),
    retry: async () =>
      (await AsyncStorage.getItem(DISABLED_KEY)) === 'true'
        ? disconnect(true)
        : refresh(),
    disable: () => disconnect(true),
    disconnectForLogout: () => disconnect(false),
  };
}
