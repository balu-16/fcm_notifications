import { useEffect, useRef, useState, type FormEvent } from 'react';
import {
  api,
  ApiError,
  type Created,
  type NotificationInput,
  type Platform,
  type Preview,
  type Target,
  type UserItem,
} from '../../lib/api';
import { UserPicker } from './UserPicker';

interface DataRow {
  id: string;
  key: string;
  value: string;
}
function errorText(error: unknown): string {
  if (error instanceof ApiError)
    return error.status === 429
      ? 'Too many sends. Wait a minute and retry.'
      : error.message;
  return 'The request could not be completed. Check your connection.';
}
export function validLink(value: string, development: boolean): boolean {
  if (
    !value ||
    /[\u0000-\u001f\u007f\\]/u.test(value) ||
    value.startsWith('//')
  )
    return false;
  if (value.startsWith('/')) return true;
  try {
    const url = new URL(value);
    return (
      !url.username &&
      !url.password &&
      (url.protocol === 'https:' ||
        (development &&
          url.protocol === 'http:' &&
          url.hostname === 'localhost'))
    );
  } catch {
    return false;
  }
}
export function dataError(rows: DataRow[]): string {
  const seen = new Set<string>();
  for (const row of rows) {
    if (!row.key && !row.value) continue;
    const key = row.key;
    const lower = key.toLowerCase();
    if (
      !/^[A-Za-z_][A-Za-z0-9_]{0,63}$/.test(key) ||
      lower.startsWith('google') ||
      lower.startsWith('gcm') ||
      [
        'from',
        'notification',
        'message_type',
        'clickaction',
        'notificationid',
        '__proto__',
        'constructor',
        'prototype',
      ].includes(lower)
    )
      return `Invalid or reserved data key: ${key || '(empty)'}`;
    if (seen.has(key)) return `Duplicate data key: ${key}`;
    if (row.value.length > 256)
      return `Value for ${key} is longer than 256 characters`;
    seen.add(key);
  }
  return '';
}
function Confirmation({
  preview,
  busy,
  onCancel,
  onSend,
}: {
  preview: Preview;
  busy: boolean;
  onCancel: () => void;
  onSend: () => void;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    dialog.current?.showModal();
    return () => {
      dialog.current?.close();
    };
  }, []);
  return (
    <dialog
      ref={dialog}
      onCancel={(event) => {
        event.preventDefault();
        if (!busy) onCancel();
      }}
    >
      <h2>Ready to send?</h2>
      <p>
        This will send to{' '}
        <strong>
          {preview.totalDevices}{' '}
          {preview.totalDevices === 1 ? 'device' : 'devices'} across{' '}
          {preview.totalUsers} {preview.totalUsers === 1 ? 'user' : 'users'}
        </strong>
        .
      </p>
      {preview.skippedUsers.length > 0 && (
        <p className="muted">
          {preview.skippedUsers.length} users have no active device for this
          target and will be skipped.
        </p>
      )}
      <p className="hint">
        Counts may change if a device registers or signs out before sending.
      </p>
      <div className="button-row">
        <button className="secondary" disabled={busy} onClick={onCancel}>
          Cancel
        </button>
        <button className="primary" disabled={busy} onClick={onSend}>
          {busy ? 'Sending…' : 'Send notification'}
        </button>
      </div>
    </dialog>
  );
}

export function Compose({ onSent }: { onSent: () => void }) {
  const [title, setTitle] = useState('');
  const [body, setBody] = useState('');
  const [imageUrl, setImageUrl] = useState('');
  const [clickAction, setClickAction] = useState('');
  const [rows, setRows] = useState<DataRow[]>([]);
  const [targetType, setTargetType] = useState<'all' | 'users' | 'platform'>(
    'all',
  );
  const [platform, setPlatform] = useState<Platform>('android');
  const [selected, setSelected] = useState<Record<string, UserItem>>({});
  const [preview, setPreview] = useState<Preview>();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [result, setResult] = useState<Created>();
  const [retry, setRetry] = useState<{
    input: NotificationInput;
    key: string;
  }>();
  const key = useRef<string>(crypto.randomUUID());
  const target: Target =
    targetType === 'users'
      ? { type: 'users', userIds: Object.keys(selected) }
      : targetType === 'platform'
        ? { type: 'platform', platform }
        : { type: 'all' };
  const customData = Object.fromEntries(
    rows.filter((row) => row.key).map((row) => [row.key, row.value]),
  );
  const input: NotificationInput = {
    title: title.trim(),
    body: body.trim(),
    target,
    ...(imageUrl.trim() ? { imageUrl: imageUrl.trim() } : {}),
    ...(clickAction.trim() ? { clickAction: clickAction.trim() } : {}),
    ...(Object.keys(customData).length ? { data: customData } : {}),
  };
  const representative = {
    notification: {
      title: input.title,
      body: input.body,
      imageUrl: input.imageUrl,
    },
    data: {
      ...customData,
      notificationId: '00000000-0000-4000-8000-000000000000',
      ...(input.clickAction ? { clickAction: input.clickAction } : {}),
    },
    webpush: {
      headers: { TTL: '86400' },
      fcmOptions: { link: input.clickAction },
    },
    android: {
      priority: 'high',
      ttl: 86400000,
      notification: { channelId: 'default' },
    },
  };
  const size = new TextEncoder().encode(JSON.stringify(representative)).length;
  function validate(): string {
    if (
      !input.title ||
      !input.body ||
      input.title.length > 100 ||
      input.body.length > 500
    )
      return 'Enter a title up to 100 characters and a body up to 500 characters.';
    if (input.imageUrl) {
      try {
        const url = new URL(input.imageUrl);
        if (url.protocol !== 'https:' || url.username || url.password)
          return 'Image URL must use HTTPS.';
      } catch {
        return 'Image URL must use HTTPS.';
      }
    }
    if (input.clickAction && !validLink(input.clickAction, import.meta.env.DEV))
      return 'Click URL must be an HTTPS URL or a path beginning with one /.';
    if (
      target.type === 'users' &&
      (!target.userIds.length || target.userIds.length > 1000)
    )
      return 'Select between 1 and 1000 users.';
    if (size > 4000) return 'The notification payload exceeds 4000 bytes.';
    return dataError(rows);
  }
  async function review(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError('');
    setResult(undefined);
    const problem = validate();
    if (problem) {
      setError(problem);
      return;
    }
    setBusy(true);
    try {
      const count = await api.preview(target);
      if (!count.totalDevices) setError('No active devices for this target.');
      else setPreview(count);
    } catch (cause) {
      setError(errorText(cause));
    } finally {
      setBusy(false);
    }
  }
  async function send(draft = { input, key: key.current }) {
    setBusy(true);
    setError('');
    try {
      const sent = await api.send(draft.input, draft.key);
      setResult(sent);
      setRetry(undefined);
      setPreview(undefined);
      key.current = crypto.randomUUID();
      setTitle('');
      setBody('');
      setImageUrl('');
      setClickAction('');
      setRows([]);
      onSent();
    } catch (cause) {
      setError(errorText(cause));
      setPreview(undefined);
      if (
        !(cause instanceof ApiError) ||
        (cause.status !== 422 && cause.status !== 429 && cause.status >= 500)
      )
        setRetry(draft);
    } finally {
      setBusy(false);
    }
  }
  const locked = busy || Boolean(retry);
  return (
    <section className="card compose-card" aria-labelledby="compose-heading">
      <div className="section-heading">
        <div>
          <p className="eyebrow">CREATE</p>
          <h2 id="compose-heading">Compose notification</h2>
        </div>
        <span className="subtle">01</span>
      </div>
      <form onSubmit={(event) => void review(event)}>
        <fieldset disabled={locked} className="bare-fieldset">
          <label>
            Title <span className="counter">{title.length}/100</span>
            <input
              required
              maxLength={100}
              value={title}
              onChange={(event) => setTitle(event.target.value)}
              placeholder="A short, clear headline"
            />
          </label>
          <label>
            Message <span className="counter">{body.length}/500</span>
            <textarea
              required
              maxLength={500}
              rows={4}
              value={body}
              onChange={(event) => setBody(event.target.value)}
              placeholder="What would you like people to know?"
            />
          </label>
          <div className="two-columns">
            <label>
              Image URL <span className="subtle">Optional · HTTPS</span>
              <input
                type="url"
                value={imageUrl}
                onChange={(event) => setImageUrl(event.target.value)}
                placeholder="https://…"
              />
            </label>
            <label>
              Click URL <span className="subtle">Optional</span>
              <input
                value={clickAction}
                onChange={(event) => setClickAction(event.target.value)}
                placeholder="/updates or https://…"
              />
            </label>
          </div>
          <div className="inline-heading">
            <h3>Custom data</h3>
            <button
              type="button"
              className="link"
              disabled={rows.length >= 10}
              onClick={() =>
                setRows([
                  ...rows,
                  { id: crypto.randomUUID(), key: '', value: '' },
                ])
              }
            >
              + Add field
            </button>
          </div>
          {rows.map((row, index) => (
            <div className="data-row" key={row.id}>
              <label>
                <span className="sr-only">Key {index + 1}</span>
                <input
                  placeholder="Key"
                  value={row.key}
                  maxLength={64}
                  onChange={(event) =>
                    setRows(
                      rows.map((item) =>
                        item.id === row.id
                          ? { ...item, key: event.target.value }
                          : item,
                      ),
                    )
                  }
                />
              </label>
              <label>
                <span className="sr-only">Value {index + 1}</span>
                <input
                  placeholder="Value"
                  value={row.value}
                  maxLength={256}
                  onChange={(event) =>
                    setRows(
                      rows.map((item) =>
                        item.id === row.id
                          ? { ...item, value: event.target.value }
                          : item,
                      ),
                    )
                  }
                />
              </label>
              <button
                type="button"
                className="icon-button"
                aria-label={`Remove data row ${index + 1}`}
                onClick={() =>
                  setRows(rows.filter((item) => item.id !== row.id))
                }
              >
                ×
              </button>
            </div>
          ))}
          <p className={`hint ${size > 4000 ? 'text-error' : ''}`}>
            Estimated payload: {size} / 4000 bytes
          </p>
          <div className="notification-preview">
            <span className="preview-icon">N</span>
            <div>
              <small>NOTIFICATIONS</small>
              <strong>{title || 'Notification title'}</strong>
              <p>{body || 'Your message preview will appear here.'}</p>
            </div>
          </div>
          <div className="section-heading target-heading">
            <div>
              <p className="eyebrow">AUDIENCE</p>
              <h2>Choose recipients</h2>
            </div>
            <span className="subtle">02</span>
          </div>
          <div className="radio-group">
            {(['all', 'users', 'platform'] as const).map((option) => (
              <label
                key={option}
                className={targetType === option ? 'selected' : ''}
              >
                <input
                  type="radio"
                  name="target"
                  checked={targetType === option}
                  onChange={() => setTargetType(option)}
                />
                {option === 'all'
                  ? 'All users'
                  : option === 'users'
                    ? 'Specific users'
                    : 'By platform'}
              </label>
            ))}
          </div>
          {targetType === 'users' && (
            <UserPicker
              selected={selected}
              onChange={setSelected}
              disabled={locked}
            />
          )}
          {targetType === 'platform' && (
            <label>
              Platform
              <select
                value={platform}
                onChange={(event) =>
                  setPlatform(event.target.value as Platform)
                }
              >
                <option value="android">Android</option>
                <option value="web">Web</option>
              </select>
            </label>
          )}
        </fieldset>
        {error && (
          <p className="notice error" role="alert">
            {error}
          </p>
        )}
        {result && (
          <p className="notice success" role="status">
            Queued notification {result.id.slice(0, 8)} for{' '}
            {result.totalDevices} devices.{' '}
            {result.skippedUsers.length > 0
              ? `${result.skippedUsers.length} users skipped.`
              : ''}
          </p>
        )}
        {retry ? (
          <div className="notice">
            <p>
              The send result is uncertain. Retry uses the same request key to
              prevent a duplicate.
            </p>
            <div className="button-row">
              <button
                type="button"
                className="primary"
                disabled={busy}
                onClick={() => void send(retry)}
              >
                Retry send
              </button>
              <button
                type="button"
                className="link"
                disabled={busy}
                onClick={() => {
                  setRetry(undefined);
                  key.current = crypto.randomUUID();
                }}
              >
                Start a new notification
              </button>
            </div>
          </div>
        ) : (
          <button className="primary send-button" disabled={busy}>
            {busy ? 'Preparing…' : 'Review recipients →'}
          </button>
        )}
      </form>
      {preview && (
        <Confirmation
          preview={preview}
          busy={busy}
          onCancel={() => setPreview(undefined)}
          onSend={() => void send()}
        />
      )}
    </section>
  );
}
