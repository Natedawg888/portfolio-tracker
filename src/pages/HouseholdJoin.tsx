/**
 * Household invite link (KAN-77): /household/join#token=…  Public, so it works before
 * signing in. The token is kept in this tab's sessionStorage while the person signs in or
 * creates an account; Layout brings them back here afterwards. The token is in the URL
 * fragment, so it never reaches the server's request logs.
 */
import { useEffect, useState } from 'react';
import { Link, Navigate, useNavigate } from 'react-router-dom';
import { useAuth } from '../auth/AuthContext';
import { api } from '../api/client';
import { BrandLockup } from '../components/BrandLockup';
import { readPendingInvite, writePendingInvite } from '../lib/householdInvite';

function takeTokenFromUrl(): string | null {
  const m = /^#token=([A-Za-z0-9_-]{20,200})$/.exec(window.location.hash);
  if (!m) return readPendingInvite();
  writePendingInvite(m[1]);
  window.history.replaceState(null, '', window.location.pathname);
  return m[1];
}

type Preview = { householdName: string; inviterName: string; role: 'owner' | 'adult' | 'viewer'; alreadyInHousehold: boolean };

export function HouseholdJoin() {
  const { user, loading } = useAuth();
  const navigate = useNavigate();
  const [token] = useState(takeTokenFromUrl);
  const [preview, setPreview] = useState<Preview | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const ready = Boolean(user && user.onboardingComplete && token);

  useEffect(() => {
    if (!ready || !token) return;
    let cancelled = false;
    api.household
      .previewInvite(token)
      .then((p) => !cancelled && setPreview(p))
      .catch((e: unknown) => !cancelled && setError(e instanceof Error ? e.message : 'This invite can’t be opened.'));
    return () => {
      cancelled = true;
    };
  }, [ready, token]);

  if (!loading && user && !user.onboardingComplete) return <Navigate to="/register" replace />;

  const done = (to: string) => {
    writePendingInvite(null);
    navigate(to, { replace: true });
  };

  return (
    <div className="auth-page login-page">
      <main className="auth-card panel">
        <div className="auth-brand">
          <Link to="/" className="auth-brand-link" aria-label="KoruLedger home">
            <BrandLockup size="md" />
          </Link>
        </div>
        <h1 className="auth-title">Join a household</h1>
        {!token ? (
          <p>This invite link is incomplete. Ask the person who invited you to send it again.</p>
        ) : loading ? (
          <p className="muted">Checking your session…</p>
        ) : !user ? (
          <>
            <p>You’ve been invited to share budgets and finances in a KoruLedger household.</p>
            <p className="muted small">Sign in, or create an account, with the email address the invite was sent to. You’ll come back here after.</p>
            <div className="auth-form">
              <Link className="btn primary auth-primary" to="/login">
                Sign in
              </Link>
              <Link className="btn ghost auth-secondary" to="/register">
                Create account
              </Link>
            </div>
          </>
        ) : error ? (
          <>
            <p className="auth-error" role="alert">
              {error}
            </p>
            <p className="auth-switch">
              <button type="button" className="link-btn" onClick={() => done('/')}>
                Go to my dashboard
              </button>
            </p>
          </>
        ) : !preview ? (
          <p className="muted">Opening the invite…</p>
        ) : (
          <>
            <p>
              <strong>{preview.inviterName}</strong> invited you to join <strong>{preview.householdName}</strong> as{' '}
              {preview.role === 'viewer' ? 'a viewer (you can see what’s shared, not change it)' : 'an adult (you can edit what’s shared)'}.
            </p>
            <p className="muted small">Your own finances stay private. Only items members choose to share are visible to the household.</p>
            {preview.alreadyInHousehold ? (
              <p className="auth-error" role="alert">
                You’re already in a household. Leave it first, then open this link again.
              </p>
            ) : null}
            <div className="auth-form">
              <button
                type="button"
                className="btn primary auth-primary"
                disabled={busy || preview.alreadyInHousehold}
                onClick={() => {
                  setBusy(true);
                  setError(null);
                  api.household
                    .acceptInvite(token)
                    .then(() => done('/household'))
                    .catch((e: unknown) => {
                      setError(e instanceof Error ? e.message : 'Couldn’t join.');
                      setBusy(false);
                    });
                }}
              >
                Join {preview.householdName}
              </button>
              <button type="button" className="btn ghost auth-secondary" disabled={busy} onClick={() => done('/')}>
                Not now
              </button>
            </div>
          </>
        )}
      </main>
    </div>
  );
}
