import './src/auth';
import { useCallback, useEffect, useState } from 'react';
import {
  ActivityIndicator,
  Linking,
  Pressable,
  ScrollView,
  Text,
  View,
} from 'react-native';
import { StatusBar } from 'expo-status-bar';
import * as Notifications from 'expo-notifications';
import { api, onUnauthorized, type Me } from './src/api';
import { clearSession, configureAuth, idToken } from './src/auth';
import { AuthView } from './src/AuthView';
import { styles } from './src/styles';
import { usePush } from './src/usePush';

Notifications.setNotificationHandler({
  // On Android, playing sound also allows the high-importance foreground banner to appear.
  handleNotification: async () => ({
    shouldShowBanner: true,
    shouldShowList: true,
    shouldPlaySound: true,
    shouldSetBadge: false,
  }),
});

export default function App() {
  const [user, setUser] = useState<Me | null>();
  const [startupError, setStartupError] = useState('');
  const [lastTap, setLastTap] = useState<Record<string, unknown>>();
  const loadUser = useCallback(async () => {
    setUser(await api.me());
  }, []);
  const start = useCallback(async () => {
    setStartupError('');
    try {
      configureAuth();
      if (await idToken()) await loadUser();
      else setUser(null);
    } catch (error) {
      await clearSession().catch(() => undefined);
      setStartupError(
        error instanceof Error
          ? error.message
          : 'Could not restore your session.',
      );
      setUser(null);
    }
  }, [loadUser]);
  useEffect(() => {
    onUnauthorized(() => {
      void clearSession().catch(() => undefined);
      setUser(null);
    });
    void start();
    const handle = (response: Notifications.NotificationResponse) => {
      setLastTap(response.notification.request.content.data);
      Notifications.clearLastNotificationResponse();
    };
    const previous = Notifications.getLastNotificationResponse();
    if (previous) handle(previous);
    const listener =
      Notifications.addNotificationResponseReceivedListener(handle);
    return () => {
      listener.remove();
      onUnauthorized(() => undefined);
    };
  }, [start]);
  return (
    <View style={styles.page}>
      <StatusBar style="dark" />
      <ScrollView
        contentContainerStyle={styles.content}
        keyboardShouldPersistTaps="handled"
      >
        <View style={styles.brand}>
          <Text style={styles.brandText}>N</Text>
        </View>
        {user === undefined ? (
          <ActivityIndicator size="large" color="#1d3650" />
        ) : user === null ? (
          <>
            {!!startupError && (
              <Text accessibilityRole="alert" style={styles.error}>
                {startupError}
              </Text>
            )}
            <AuthView onSignedIn={loadUser} />
          </>
        ) : (
          <Dashboard
            key={user.id}
            user={user}
            lastTap={lastTap}
            onSignedOut={() => setUser(null)}
          />
        )}
      </ScrollView>
    </View>
  );
}

function Dashboard({
  user,
  lastTap,
  onSignedOut,
}: {
  user: Me;
  lastTap?: Record<string, unknown>;
  onSignedOut: () => void;
}) {
  const push = usePush(user.id);
  const [busy, setBusy] = useState(false);
  async function logout() {
    setBusy(true);
    try {
      await push.disconnectForLogout();
    } catch {
      /* Do not trap users in a session while offline. */
    }
    try {
      await clearSession();
    } catch {
      /* Local UI still signs out. */
    } finally {
      onSignedOut();
    }
  }
  return (
    <>
      <View>
        <Text style={styles.eyebrow}>YOUR WORKSPACE</Text>
        <Text style={styles.title}>Hello World</Text>
        <Text style={styles.muted}>
          {user.email} · {user.role}
        </Text>
      </View>
      <View style={styles.card}>
        <Text style={styles.eyebrow}>THIS DEVICE</Text>
        <Text style={styles.heading}>Notifications</Text>
        <Text style={styles.status}>{push.status.toUpperCase()}</Text>
        {push.status === 'unsupported' && (
          <Text style={styles.muted}>
            This project supports push on a physical Android device using a
            development build. iOS is unsupported.
          </Text>
        )}
        {push.status === 'default' && (
          <Text style={styles.muted}>
            Enable notifications to receive updates on this device.
          </Text>
        )}
        {push.status === 'denied' && (
          <Text style={styles.muted}>
            Notifications are blocked.{' '}
            {push.canAskAgain
              ? 'You can try again.'
              : 'Enable them in Android app settings.'}
          </Text>
        )}
        {push.status === 'registered' && (
          <Text style={styles.muted}>
            This device is registered to receive notifications.
          </Text>
        )}
        {push.status === 'disabled' && (
          <Text style={styles.muted}>
            Notifications are disabled on this device.
          </Text>
        )}
        {(push.status === 'checking' || push.status === 'registering') && (
          <Text style={styles.muted}>Checking notification settings…</Text>
        )}
        {!!push.error && (
          <Text accessibilityRole="alert" style={styles.error}>
            {push.error}
          </Text>
        )}
        {(['default', 'disabled'].includes(push.status) ||
          (push.status === 'denied' && push.canAskAgain)) && (
          <Pressable
            accessibilityRole="button"
            onPress={() => void push.enable()}
            style={styles.button}
          >
            <Text style={styles.buttonText}>Enable notifications</Text>
          </Pressable>
        )}
        {push.status === 'denied' && !push.canAskAgain && (
          <Pressable
            accessibilityRole="button"
            onPress={() => void Linking.openSettings()}
            style={styles.secondary}
          >
            <Text style={styles.secondaryText}>Open app settings</Text>
          </Pressable>
        )}
        {push.status === 'registered' && (
          <Pressable
            accessibilityRole="button"
            onPress={() => void push.disable()}
            style={styles.secondary}
          >
            <Text style={styles.secondaryText}>Disable on this device</Text>
          </Pressable>
        )}
        {push.status === 'failed' && (
          <Pressable
            accessibilityRole="button"
            onPress={() => void push.retry()}
            style={styles.secondary}
          >
            <Text style={styles.secondaryText}>Retry</Text>
          </Pressable>
        )}
      </View>
      <View style={styles.card}>
        <Text style={styles.heading}>Last notification tap</Text>
        {lastTap ? (
          <Text selectable style={styles.mono}>
            {JSON.stringify(lastTap, null, 2)}
          </Text>
        ) : (
          <Text style={styles.muted}>
            Tap a notification to see its data here.
          </Text>
        )}
      </View>
      <Pressable
        accessibilityRole="button"
        disabled={busy}
        onPress={() => void logout()}
        style={[styles.secondary, busy && styles.disabled]}
      >
        <Text style={styles.secondaryText}>
          {busy ? 'Signing out…' : 'Sign out'}
        </Text>
      </Pressable>
    </>
  );
}
