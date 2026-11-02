import { useCallback, useEffect, useState } from 'react';
import { api, onUnauthorized, type Me } from './lib/api';
import { clearSession, configureAuth, idToken } from './lib/auth';
import { AuthCard, type SignInRole } from './features/auth/AuthCard';
import { PushCard } from './features/push/PushCard';
import { usePush } from './features/push/usePush';
import { Compose } from './features/admin/Compose';
import { History } from './features/admin/History';

export default function App() {
  const [user, setUser] = useState<Me | null>();
  const [startupError, setStartupError] = useState('');
  const loadUser = useCallback(async (expectedRole?: SignInRole) => {
    const profile = await api.me();
    if (expectedRole && profile.role !== expectedRole) throw new Error('ROLE_MISMATCH');
    setUser(profile);
  }, []);
  const start = useCallback(async () => {
    setStartupError('');
    try {
      configureAuth();
      if (await idToken()) await loadUser();
      else setUser(null);
    } catch {
      await clearSession().catch(() => undefined);
      setStartupError(
        'Could not restore your session. Check configuration and your connection.',
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
    return () => onUnauthorized(() => undefined);
  }, [start]);
  if (user === undefined)
    return (
      <main className="centered">
        <p>Loading your workspace…</p>
      </main>
    );
  if (user === null)
    return (
      <main>
        {startupError && (
          <div className="notice error top-error" role="alert">
            {startupError}
          </div>
        )}
        <AuthCard onSignedIn={loadUser} />
      </main>
    );
  return (
    <Dashboard key={user.id} user={user} onSignedOut={() => setUser(null)} />
  );
}

function Dashboard({
  user,
  onSignedOut,
}: {
  user: Me;
  onSignedOut: () => void;
}) {
  const push = usePush(user.id);
  const [busy, setBusy] = useState(false);
  const [revision, setRevision] = useState(0);
  async function logout() {
    setBusy(true);
    try {
      await push.disconnectForLogout();
    } catch {
      /* Sign out even when network cleanup fails. */
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
      <header className="topbar">
        <div className="topbar-inner">
          <div className="wordmark">
            <span className="brand-mark small-mark">N</span>
            <span>
              Notification Lab<small>FCM LEARNING PROJECT</small>
            </span>
          </div>
          <div className="account">
            <span className="account-email">{user.email}</span>
            <span className="role-badge">{user.role}</span>
            <button
              className="secondary"
              disabled={busy}
              onClick={() => void logout()}
            >
              {busy ? 'Signing out…' : 'Sign out'}
            </button>
          </div>
        </div>
      </header>
      <main className="workspace">
        <div className="page-intro">
          <div>
            <p className="eyebrow">
              {user.role === 'admin' ? 'ADMIN DASHBOARD' : 'YOUR WORKSPACE'}
            </p>
            <h1>
              {user.role === 'admin' ? 'Make a connection.' : 'Hello World'}
            </h1>
            <p className="muted">
              {user.role === 'admin'
                ? 'Create, deliver, and follow every notification from one place.'
                : 'Your notification playground is ready.'}
            </p>
          </div>
        </div>
        <PushCard {...push} />
        {user.role === 'admin' && (
          <>
            <Compose onSent={() => setRevision((value) => value + 1)} />
            <History revision={revision} />
          </>
        )}
      </main>
    </>
  );
}
