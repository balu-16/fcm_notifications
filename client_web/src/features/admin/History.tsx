import { useEffect, useState } from 'react';
import { api, type Detail, type HistoryItem, type Page } from '../../lib/api';

export function History({ revision }: { revision: number }) {
  const [page, setPage] = useState(1);
  const [history, setHistory] = useState<Page<HistoryItem>>();
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [open, setOpen] = useState<string>();
  const [detail, setDetail] = useState<Detail>();
  const [detailError, setDetailError] = useState('');
  useEffect(() => {
    let active = true;
    let timer: ReturnType<typeof setTimeout> | undefined;
    async function load() {
      if (document.visibilityState === 'hidden') return;
      try {
        const data = await api.history(page);
        if (!active) return;
        setHistory(data);
        setError('');
        if (open) {
          try {
            const item = await api.detail(open);
            if (active) {
              setDetail(item);
              setDetailError('');
            }
          } catch {
            if (active) setDetailError('Could not load delivery details.');
          }
        }
        if (
          data.items.some(
            (item) => item.status === 'pending' || item.status === 'sending',
          )
        )
          timer = setTimeout(() => void load(), 2000);
      } catch {
        if (active) setError('Could not load notification history.');
      } finally {
        if (active) setLoading(false);
      }
    }
    function onVisibility() {
      if (timer) clearTimeout(timer);
      if (document.visibilityState === 'visible') void load();
    }
    setLoading(true);
    void load();
    document.addEventListener('visibilitychange', onVisibility);
    return () => {
      active = false;
      if (timer) clearTimeout(timer);
      document.removeEventListener('visibilitychange', onVisibility);
    };
  }, [page, revision, open]);
  return (
    <section className="card history-card" aria-labelledby="history-heading">
      <div className="section-heading">
        <div>
          <p className="eyebrow">ACTIVITY</p>
          <h2 id="history-heading">Send history</h2>
        </div>
        <span className="subtle">03</span>
      </div>
      <p className="hint">
        Sent means accepted by FCM; delivery to the device is not guaranteed.
      </p>
      {loading && !history ? (
        <p>Loading history…</p>
      ) : error ? (
        <p className="notice error" role="alert">
          {error}
        </p>
      ) : !history?.items.length ? (
        <p className="muted">
          Your notifications will appear here after the first send.
        </p>
      ) : (
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>Notification</th>
                <th>Target</th>
                <th>Status</th>
                <th>Accepted / failed</th>
                <th>Time</th>
                <th>
                  <span className="sr-only">Details</span>
                </th>
              </tr>
            </thead>
            <tbody>
              {history.items.map((item) => (
                <HistoryRows
                  key={item.id}
                  item={item}
                  expanded={open === item.id}
                  detail={open === item.id ? detail : undefined}
                  detailError={open === item.id ? detailError : ''}
                  onToggle={() => {
                    setDetail(undefined);
                    setDetailError('');
                    setOpen(open === item.id ? undefined : item.id);
                  }}
                />
              ))}
            </tbody>
          </table>
        </div>
      )}
      {history && history.total > 0 && (
        <div className="pagination">
          <button
            className="link"
            disabled={page <= 1}
            onClick={() => setPage(page - 1)}
          >
            Previous
          </button>
          <span>
            Page {page} of {Math.max(1, Math.ceil(history.total / 10))}
          </span>
          <button
            className="link"
            disabled={page * 10 >= history.total}
            onClick={() => setPage(page + 1)}
          >
            Next
          </button>
        </div>
      )}
    </section>
  );
}
function HistoryRows({
  item,
  expanded,
  detail,
  detailError,
  onToggle,
}: {
  item: HistoryItem;
  expanded: boolean;
  detail?: Detail;
  detailError: string;
  onToggle: () => void;
}) {
  return (
    <>
      <tr>
        <td>
          <strong>{item.title}</strong>
          <small>by {item.creatorEmail}</small>
        </td>
        <td>
          {item.targetType === 'platform'
            ? item.targetPlatform
            : item.targetType}
        </td>
        <td>
          <span
            className={`status ${item.status === 'completed' ? 'good' : item.status === 'failed' ? 'bad' : ''}`}
          >
            {item.status}
          </span>
        </td>
        <td>
          {item.sent} / {item.failed}
          {item.pending ? ` · ${item.pending} pending` : ''}
        </td>
        <td>{new Date(item.createdAt).toLocaleString()}</td>
        <td>
          <button className="link" aria-expanded={expanded} onClick={onToggle}>
            {expanded ? 'Hide' : 'Details'}
          </button>
        </td>
      </tr>
      {expanded && (
        <tr>
          <td colSpan={6}>
            <div className="delivery-list">
              {detailError ? (
                <p className="notice error">{detailError}</p>
              ) : !detail ? (
                <p>Loading deliveries…</p>
              ) : (
                <>
                  {detail.failureReason && (
                    <p className="notice error">{detail.failureReason}</p>
                  )}
                  <p>{detail.body}</p>
                  {detail.deliveries.length === 0 ? (
                    <p className="muted">No delivery records.</p>
                  ) : (
                    <ul>
                      {detail.deliveries.map((delivery) => (
                        <li key={delivery.id}>
                          <strong>{delivery.email || 'Deleted user'}</strong> ·{' '}
                          {delivery.platform} · {delivery.status}
                          {delivery.tokenLast6 && (
                            <> · …{delivery.tokenLast6}</>
                          )}{' '}
                          · {delivery.attempts} attempt(s)
                          {delivery.errorCode && (
                            <span className="text-error">
                              {' '}
                              · {delivery.errorCode}: {delivery.errorMessage}
                            </span>
                          )}
                        </li>
                      ))}
                    </ul>
                  )}
                </>
              )}
            </div>
          </td>
        </tr>
      )}
    </>
  );
}
