import { useEffect, useState } from 'react';
import { api, type UserItem } from '../../lib/api';

export function UserPicker({
  selected,
  onChange,
  disabled,
}: {
  selected: Record<string, UserItem>;
  onChange: (value: Record<string, UserItem>) => void;
  disabled?: boolean;
}) {
  const [search, setSearch] = useState('');
  const [page, setPage] = useState(1);
  const [items, setItems] = useState<UserItem[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  useEffect(() => {
    let active = true;
    setLoading(true);
    const timer = setTimeout(() => {
      void api
        .users(search, page)
        .then((result) => {
          if (active) {
            setItems(result.items);
            setTotal(result.total);
            setError('');
          }
        })
        .catch(() => {
          if (active) setError('Could not load users. Try searching again.');
        })
        .finally(() => {
          if (active) setLoading(false);
        });
    }, 300);
    return () => {
      active = false;
      clearTimeout(timer);
    };
  }, [search, page]);
  return (
    <div className="picker">
      <label>
        Search users
        <input
          type="search"
          value={search}
          disabled={disabled}
          placeholder="Search by email"
          onChange={(event) => {
            setSearch(event.target.value);
            setPage(1);
          }}
        />
      </label>
      <p className="hint">
        {Object.keys(selected).length} selected · Users appear after their first
        sign-in.
      </p>
      {loading ? (
        <p className="muted">Loading users…</p>
      ) : error ? (
        <p className="notice error" role="alert">
          {error}
        </p>
      ) : items.length === 0 ? (
        <p className="muted">No users found.</p>
      ) : (
        <ul className="user-list">
          {items.map((user) => (
            <li key={user.id}>
              <label className="user-option">
                <input
                  type="checkbox"
                  disabled={disabled}
                  checked={Boolean(selected[user.id])}
                  onChange={(event) => {
                    const next = { ...selected };
                    if (event.target.checked) next[user.id] = user;
                    else delete next[user.id];
                    onChange(next);
                  }}
                />
                <span className="user-email">{user.email}</span>
                <span className="device-badges">
                  web {user.webDevices} · android {user.androidDevices}
                  {user.webDevices + user.androidDevices === 0
                    ? ' · no devices'
                    : ''}
                </span>
              </label>
            </li>
          ))}
        </ul>
      )}
      <div className="pagination">
        <button
          type="button"
          className="link"
          disabled={disabled || page <= 1}
          onClick={() => setPage(page - 1)}
        >
          Previous
        </button>
        <span>
          Page {page} of {Math.max(1, Math.ceil(total / 10))}
        </span>
        <button
          type="button"
          className="link"
          disabled={disabled || page * 10 >= total}
          onClick={() => setPage(page + 1)}
        >
          Next
        </button>
      </div>
    </div>
  );
}
