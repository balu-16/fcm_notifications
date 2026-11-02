interface PushProps {
  state: string;
  error: string;
  enable: () => Promise<void>;
  retry: () => Promise<void>;
  disable: () => Promise<void>;
}
export function PushCard({ state, error, enable, retry, disable }: PushProps) {
  return (
    <section className="card push-card" aria-labelledby="push-heading">
      <div className="card-title">
        <div>
          <p className="eyebrow">THIS DEVICE</p>
          <h2 id="push-heading">Notifications</h2>
        </div>
        <span className={`status ${state === 'registered' ? 'good' : ''}`}>
          {state === 'registered'
            ? 'Connected'
            : state === 'registering'
              ? 'Connecting'
              : state}
        </span>
      </div>
      {state === 'unsupported' && (
        <p>
          Notifications need a supported browser on HTTPS or localhost. On iOS,
          install the site to your home screen first.
        </p>
      )}
      {state === 'default' && (
        <p>
          Get updates on this device. We’ll ask for permission when you choose
          to enable them.
        </p>
      )}
      {state === 'denied' && (
        <p>
          Notifications are blocked. Enable them in your browser’s site
          settings, then reload this page.
        </p>
      )}
      {state === 'registered' && (
        <p>This browser is registered to receive notifications.</p>
      )}
      {state === 'disabled' && (
        <p>Notifications are disabled on this browser.</p>
      )}
      {(state === 'checking' || state === 'registering') && (
        <p>Checking notification settings…</p>
      )}
      {error && (
        <p className="notice error" role="alert">
          {error}
        </p>
      )}
      {(state === 'default' || state === 'disabled') && (
        <button className="primary" onClick={() => void enable()}>
          Enable notifications
        </button>
      )}
      {state === 'failed' && (
        <button className="secondary" onClick={() => void retry()}>
          Retry
        </button>
      )}
      {state === 'registered' && (
        <button className="secondary" onClick={() => void disable()}>
          Disable on this device
        </button>
      )}
    </section>
  );
}
