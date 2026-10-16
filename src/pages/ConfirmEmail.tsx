/**
 * Email change link: /confirm-email#token=…  Public, so it works on any device. The token is
 * in the URL fragment (never in server logs) and only a button press confirms, so email
 * scanners that open links can't change the address.
 */
import { useState } from 'react';
import { Link } from 'react-router-dom';
import { useAuth } from '../auth/AuthContext';
import { ApiError, api } from '../api/client';
import { BrandLockup } from '../components/BrandLockup';

function takeTokenFromUrl(): string | null {
  const m = /^#token=([A-Za-z0-9_-]{20,200})$/.exec(window.location.hash);
  if (m) window.history.replaceState(null, '', window.location.pathname);
  return m ? m[1] : null;
}

export function ConfirmEmail() {
  const { user, refresh } = useAuth();
  const [token] = useState(takeTokenFromUrl);
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const confirm = async () => {
    if (!token) return;
    setBusy(true);
    setError(null);
    try {
      const res = await api.auth.confirmEmail(token);
      setDone(res.email);
      if (user) await refresh();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not confirm. Try again.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="auth-page login-page">
      <main className="auth-card panel">
        <div className="auth-brand">
          <Link to="/" className="auth-brand-link" aria-label="KoruLedger home">
            <BrandLockup size="md" />
          </Link>
        </div>
        <h1 className="auth-title">Confirm your new email</h1>
        {!token ? (
          <p>This link is incomplete. Open the latest email from KoruLedger again.</p>
        ) : done ? (
          <>
            <p role="status">
              Done. Your account email is now <strong>{done}</strong>. Use it next time you sign in.
            </p>
            <div className="auth-form">
              <Link className="btn primary auth-primary" to={user ? '/settings?tab=account' : '/login'}>
                {user ? 'Back to Settings' : 'Sign in'}
              </Link>
            </div>
          </>
        ) : (
          <>
            <p>Confirm to start using this address for your KoruLedger account. Your old email stops working for sign-in.</p>
            {error ? (
              <p className="auth-error" role="alert">
                {error}
              </p>
            ) : null}
            <div className="auth-form">
              <button type="button" className="btn primary auth-primary" disabled={busy} onClick={() => void confirm()}>
                {busy ? 'Confirming…' : 'Confirm new email'}
              </button>
            </div>
          </>
        )}
      </main>
    </div>
  );
}
