import { useEffect, useRef, useState } from 'react';
import type { FormEvent, KeyboardEvent } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useAuth } from '../../auth/AuthContext';
import { ApiError, api } from '../../api/client';
import { DELETED_ITEMS, DELETE_WORD, KEPT_ITEMS, deleteConfirmed } from '../../lib/accountView';

/** Settings → Account → Delete account: collapsed until asked, then says exactly what goes and what stays. */
export function AccountDeleteCard({ hasPassword }: { hasPassword: boolean | null }) {
  const { setUser } = useAuth();
  const navigate = useNavigate();
  const openRef = useRef<HTMLButtonElement>(null);
  const confirmRef = useRef<HTMLInputElement>(null);
  const cancelRef = useRef<HTMLButtonElement>(null);

  const [open, setOpen] = useState(false);
  const [typed, setTyped] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Focus moves into the confirmation when it opens and back to the button when it closes.
  const wasOpen = useRef(false);
  useEffect(() => {
    if (open) (confirmRef.current ?? cancelRef.current)?.focus();
    else if (wasOpen.current) openRef.current?.focus();
    wasOpen.current = open;
  }, [open]);

  const close = () => {
    if (busy) return;
    setOpen(false);
    setTyped('');
    setPassword('');
    setError(null);
  };

  const onKeyDown = (e: KeyboardEvent) => {
    if (e.key === 'Escape') {
      e.stopPropagation();
      close();
    }
  };

  const onSubmit = async (e: FormEvent) => {
    e.preventDefault();
    if (!deleteConfirmed(typed)) return;
    setBusy(true);
    setError(null);
    try {
      await api.auth.deleteAccount({ password, confirm: DELETE_WORD });
      setUser(null);
      navigate('/login', { replace: true });
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not delete your account. Try again.');
      setBusy(false);
    }
  };

  return (
    <section className="panel account-card account-danger-zone" aria-labelledby="account-delete-title">
      <div className="account-card-head">
        <h2 id="account-delete-title">Delete account</h2>
        <p className="muted small">Permanently delete your account and everything in it. This can&apos;t be undone.</p>
      </div>

      {!open ? (
        <div className="account-actions">
          <button ref={openRef} type="button" className="btn danger small" onClick={() => setOpen(true)}>
            Delete account…
          </button>
        </div>
      ) : (
        <div
          className="account-delete-confirm"
          role="alertdialog"
          aria-modal="false"
          aria-labelledby="account-delete-confirm-title"
          aria-describedby="account-delete-confirm-desc"
          onKeyDown={onKeyDown}
        >
          <p className="account-delete-title" id="account-delete-confirm-title">
            Delete your account?
          </p>
          <p className="small" id="account-delete-confirm-desc">
            Everything under Deleted is removed for good. There&apos;s no undo.
          </p>

          <div className="account-delete-lists">
            <div>
              <h3 className="account-delete-list-title">Deleted</h3>
              <ul className="account-delete-list">
                {DELETED_ITEMS.map((t) => (
                  <li key={t}>{t}</li>
                ))}
              </ul>
            </div>
            <div>
              <h3 className="account-delete-list-title">Kept</h3>
              <ul className="account-delete-list">
                {KEPT_ITEMS.map((k) => (
                  <li key={k.text}>
                    {k.text}
                    {k.link ? (
                      <>
                        {' '}
                        <a href={k.link.href} target="_blank" rel="noreferrer">
                          {k.link.label}
                        </a>
                        .
                      </>
                    ) : null}
                  </li>
                ))}
              </ul>
            </div>
          </div>

          {hasPassword === false ? (
            <div className="account-inline-form">
              <p>
                To delete your account, first set a password. It confirms it&apos;s you.{' '}
                <Link to="/settings?tab=security">Set a password in Security ›</Link>
              </p>
              <div className="account-actions">
                <button ref={cancelRef} type="button" className="btn ghost small" onClick={close}>
                  Cancel
                </button>
              </div>
            </div>
          ) : (
            <form className="account-inline-form" onSubmit={onSubmit} aria-label="Confirm account deletion">
              <label className="field">
                <span>Type {DELETE_WORD} to confirm</span>
                <input
                  ref={confirmRef}
                  type="text"
                  value={typed}
                  onChange={(e) => setTyped(e.target.value)}
                  required
                  disabled={busy}
                  autoComplete="off"
                  autoCapitalize="characters"
                  spellCheck={false}
                />
              </label>
              <label className="field">
                <span>Current password</span>
                <input
                  type="password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  required
                  disabled={busy}
                  autoComplete="current-password"
                />
              </label>
              {error ? (
                <p className="auth-error" role="alert">
                  {error}
                </p>
              ) : null}
              <div className="account-actions">
                <button type="submit" className="btn danger small" disabled={busy || !deleteConfirmed(typed) || !password}>
                  {busy ? 'Deleting…' : 'Delete my account'}
                </button>
                <button ref={cancelRef} type="button" className="btn ghost small" disabled={busy} onClick={close}>
                  Cancel
                </button>
              </div>
            </form>
          )}
        </div>
      )}
    </section>
  );
}
