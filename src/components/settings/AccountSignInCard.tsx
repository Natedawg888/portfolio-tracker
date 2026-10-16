import { useEffect, useRef, useState } from 'react';
import type { FormEvent } from 'react';
import { Link } from 'react-router-dom';
import { useAuth } from '../../auth/AuthContext';
import { ApiError, api, type AccountSecurity } from '../../api/client';
import { showQuietToast } from '../../lib/quietToast';
import { providerList } from '../../lib/accountView';

const SECURITY_TAB = '/settings?tab=security';

/** Settings → Account → Email and password: one row each; email changes inline. */
export function AccountSignInCard({ security }: { security: AccountSecurity | null }) {
  const { user, setUser } = useAuth();
  const changeRef = useRef<HTMLButtonElement>(null);
  const emailRef = useRef<HTMLInputElement>(null);

  const [open, setOpen] = useState(false);
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [cancelBusy, setCancelBusy] = useState(false);

  const hasPassword = security?.hasPassword ?? null;
  const pendingEmail = user?.pendingEmail ?? null;
  const confirms = user?.emailChangeConfirms ?? false;
  const providers = providerList((security?.identities ?? []).map((i) => i.label));

  // Focus moves into the form when it opens and back to "Change" when it closes.
  const wasOpen = useRef(false);
  useEffect(() => {
    if (open) emailRef.current?.focus();
    else if (wasOpen.current) changeRef.current?.focus();
    wasOpen.current = open;
  }, [open]);

  const close = () => {
    setOpen(false);
    setEmail('');
    setPassword('');
    setError(null);
  };

  const onSubmit = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const res = await api.auth.changeEmail({ currentPassword: password, email: email.trim() });
      setUser(res.user);
      const message = res.pendingEmail
        ? res.message
        : res.message === 'Email unchanged.'
          ? 'That is already your email'
          : `Email changed to ${res.user.email}`;
      showQuietToast(message, { kind: 'info', ttlMs: 6000 });
      close();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not change your email. Try again.');
    } finally {
      setBusy(false);
    }
  };

  const onCancelPending = async () => {
    if (!user) return;
    setCancelBusy(true);
    try {
      await api.auth.cancelEmailChange();
      setUser({ ...user, pendingEmail: null });
      showQuietToast('Email change cancelled', { kind: 'info', ttlMs: 4000 });
    } catch (err) {
      showQuietToast(err instanceof ApiError ? err.message : 'Could not cancel. Try again.', { kind: 'warn' });
    } finally {
      setCancelBusy(false);
    }
  };

  return (
    <section className="panel account-card" aria-labelledby="account-signin-title">
      <div className="account-card-head">
        <h2 id="account-signin-title">Email and password</h2>
      </div>

      <ul className="account-rows">
        <li className="account-row">
          <div className="account-row-main">
            <p className="account-row-label">Email</p>
            <p className="account-row-value">{user?.email}</p>
            {pendingEmail ? (
              <p className="account-row-sub">
                Check {pendingEmail} to confirm. Your current email works until then.{' '}
                <button type="button" className="link-btn" disabled={cancelBusy} onClick={() => void onCancelPending()}>
                  Cancel change
                </button>
              </p>
            ) : null}
          </div>
          {!open ? (
            <button
              ref={changeRef}
              type="button"
              className="btn small"
              aria-expanded={false}
              aria-controls="account-email-form"
              onClick={() => setOpen(true)}
            >
              Change<span className="sr-only"> email</span>
            </button>
          ) : null}

          {open ? (
            <div className="account-row-extra" id="account-email-form">
              {hasPassword === false ? (
                <div className="account-inline-form">
                  <p>
                    To change your email, first set a password. It confirms it&apos;s you.{' '}
                    <Link to={SECURITY_TAB}>Set a password in Security ›</Link>
                  </p>
                  <div className="account-actions">
                    <button type="button" className="btn ghost small" onClick={close}>
                      Cancel
                    </button>
                  </div>
                </div>
              ) : (
                <form className="account-inline-form" onSubmit={onSubmit} aria-label="Change email">
                  <label className="field">
                    <span>New email</span>
                    <input
                      ref={emailRef}
                      type="email"
                      value={email}
                      onChange={(e) => setEmail(e.target.value)}
                      required
                      disabled={busy}
                      autoComplete="email"
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
                  <p className="muted small">
                    {confirms
                      ? 'We’ll email a link to the new address. Your current email keeps working until you open it.'
                      : 'Email isn’t set up on this server, so the change happens straight away with no confirmation link. Check the address carefully.'}
                  </p>
                  {providers ? (
                    <p className="muted small">
                      Your {providers} sign-in stays connected. It&apos;s linked to that account, not to this email address.
                    </p>
                  ) : null}
                  {error ? (
                    <p className="auth-error" role="alert">
                      {error}
                    </p>
                  ) : null}
                  <div className="account-actions">
                    <button type="submit" className="btn primary small" disabled={busy || !email.trim() || !password}>
                      {busy ? 'Saving…' : confirms ? 'Send link' : 'Change email'}
                    </button>
                    <button type="button" className="btn ghost small" disabled={busy} onClick={close}>
                      Cancel
                    </button>
                  </div>
                </form>
              )}
            </div>
          ) : null}
        </li>

        <li className="account-row">
          <div className="account-row-main">
            <p className="account-row-label">Password</p>
            <p className="account-row-value">
              {hasPassword === null ? '…' : hasPassword ? <>
                  <span aria-hidden>••••••••</span>
                  <span className="sr-only">Set</span>
                </> : 'Not set'}
            </p>
          </div>
          {hasPassword === null ? null : (
            <Link className="account-row-link" to={SECURITY_TAB}>
              {hasPassword ? 'Change in Security ›' : 'Set a password in Security ›'}
            </Link>
          )}
        </li>
      </ul>
    </section>
  );
}
