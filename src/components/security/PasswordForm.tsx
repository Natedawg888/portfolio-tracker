/**
 * Change (or, for accounts made with Google / Apple / Microsoft, set) the password.
 * The server checks the current password and signs out every other session.
 */
import { useEffect, useId, useRef, useState, type FormEvent } from 'react';
import { ApiError, api } from '../../api/client';
import { passwordAcceptable, passwordChecks } from '../../lib/securityView';

export function PasswordForm({
  hasPassword,
  onDone,
  onCancel,
}: {
  hasPassword: boolean;
  onDone: (message: string) => void;
  onCancel: () => void;
}) {
  const [current, setCurrent] = useState('');
  const [next, setNext] = useState('');
  const [confirm, setConfirm] = useState('');
  const [show, setShow] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const checksId = useId();
  const firstRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    firstRef.current?.focus();
  }, []);

  const checks = passwordChecks(next);
  const matches = confirm.length > 0 && confirm === next;
  const ready = (!hasPassword || current.length > 0) && passwordAcceptable(next) && matches;

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (!ready) return;
    setBusy(true);
    setError(null);
    try {
      const r = await api.auth.changePassword({ currentPassword: hasPassword ? current : '', newPassword: next });
      onDone(hasPassword ? r.message || 'Password updated.' : 'Password set. You can now sign in with your email and password too.');
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not change your password.');
      setBusy(false);
    }
  };

  return (
    <form className="security-password-form" onSubmit={(e) => void submit(e)} aria-label={hasPassword ? 'Change password' : 'Set a password'}>
      {hasPassword ? (
        <label className="field">
          <span>Current password</span>
          <input
            ref={firstRef}
            type={show ? 'text' : 'password'}
            autoComplete="current-password"
            value={current}
            onChange={(e) => setCurrent(e.target.value)}
            disabled={busy}
            required
          />
        </label>
      ) : null}
      <div className="field">
        <label htmlFor={`${checksId}-new`}>New password</label>
        <div className="security-password-input">
          <input
            id={`${checksId}-new`}
            ref={hasPassword ? undefined : firstRef}
            type={show ? 'text' : 'password'}
            autoComplete="new-password"
            value={next}
            maxLength={128}
            onChange={(e) => setNext(e.target.value)}
            aria-describedby={checksId}
            disabled={busy}
            required
          />
          <button type="button" className="btn small ghost" aria-pressed={show} onClick={() => setShow(!show)}>
            {show ? 'Hide passwords' : 'Show passwords'}
          </button>
        </div>
        <ul id={checksId} className="security-checklist" aria-label="Password needs">
          {checks.map((c) => (
            <li key={c.label} className={c.ok ? 'is-ok' : ''}>
              <span className="security-check-mark" aria-hidden="true">
                {c.ok ? '✓' : '○'}
              </span>
              {c.label}
              <span className="sr-only">{c.ok ? ' (done)' : ' (not yet)'}</span>
            </li>
          ))}
        </ul>
      </div>
      <label className="field">
        <span>Confirm new password</span>
        <input
          type={show ? 'text' : 'password'}
          autoComplete="new-password"
          value={confirm}
          maxLength={128}
          onChange={(e) => setConfirm(e.target.value)}
          disabled={busy}
          required
        />
      </label>
      {confirm.length > 0 && !matches ? <p className="security-mismatch">The two new passwords don’t match yet.</p> : null}
      {hasPassword ? <p className="muted small">Other browsers signed in to this account will be signed out.</p> : null}
      {error ? (
        <p className="auth-error" role="alert">
          {error}
        </p>
      ) : null}
      <div className="row gap">
        <button type="submit" className="btn primary" disabled={busy || !ready}>
          {busy ? 'Saving…' : hasPassword ? 'Change password' : 'Set password'}
        </button>
        <button type="button" className="btn" onClick={onCancel} disabled={busy}>
          Cancel
        </button>
      </div>
    </form>
  );
}
