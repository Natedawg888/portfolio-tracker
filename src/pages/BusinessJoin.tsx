/**
 * Business invite link (KAN-129): /business/join#token=…  Public, so it works before signing in,
 * like the household invite (HouseholdJoin). The token stays in this tab's sessionStorage while
 * the person signs in or creates an account; Layout brings them back here afterwards. The token
 * is in the URL fragment, so it never reaches the server's request logs.
 */
import { useEffect, useState } from 'react';
import { Link, Navigate, useNavigate } from 'react-router-dom';
import { useAuth } from '../auth/AuthContext';
import { api } from '../api/client';
import { BrandLockup } from '../components/BrandLockup';
import { readPendingBusinessInvite, writePendingBusinessInvite } from '../lib/householdInvite';
import type { BusinessInvitePreview } from '../types';

function takeTokenFromUrl(): string | null {
  const m = /^#token=([A-Za-z0-9_-]{20,200})$/.exec(window.location.hash);
  if (!m) return readPendingBusinessInvite();
  writePendingBusinessInvite(m[1]);
  window.history.replaceState(null, '', window.location.pathname);
  return m[1];
}

export function BusinessJoin() {
  const { user, loading } = useAuth();
  const navigate = useNavigate();
  const [token] = useState(takeTokenFromUrl);
  const [preview, setPreview] = useState<BusinessInvitePreview | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const ready = Boolean(user && user.onboardingComplete && token);

  useEffect(() => {
    if (!ready || !token) return;
    let cancelled = false;
    api.business
      .previewInvite(token)
      .then((p) => !cancelled && setPreview(p))
      .catch((e: unknown) => !cancelled && setError(e instanceof Error ? e.message : 'This invite can’t be opened.'));
    return () => {
      cancelled = true;
    };
  }, [ready, token]);

  if (!loading && user && !user.onboardingComplete) return <Navigate to="/register" replace />;

  const done = (to: string) => {
    writePendingBusinessInvite(null);
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
        <h1 className="auth-title">Open a business’s books</h1>
        {!token ? (
          <p>This invite link is incomplete. Ask the person who invited you to send it again.</p>
        ) : loading ? (
          <p className="muted">Checking your session…</p>
        ) : !user ? (
          <>
            <p>You’ve been invited to a business’s books on KoruLedger.</p>
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
        ) : preview.alreadyMember ? (
          <>
            <p>
              You already have access to <strong>{preview.businessName}</strong>.
            </p>
            <div className="auth-form">
              <button type="button" className="btn primary auth-primary" onClick={() => done(`/business/${encodeURIComponent(preview.businessId)}`)}>
                Open {preview.businessName}
              </button>
            </div>
          </>
        ) : (
          <>
            <p>
              <strong>{preview.ownerName}</strong> invited you to <strong>{preview.businessName}</strong> as{' '}
              {preview.role === 'accountant' ? 'their accountant (you can read and edit the books)' : 'a viewer (you can read the books, not change them)'}.
            </p>
            <p className="muted small">
              You’ll see this business only, never {preview.ownerName}’s personal finances. They can remove your access at any time.
            </p>
            <div className="auth-form">
              <button
                type="button"
                className="btn primary auth-primary"
                disabled={busy}
                onClick={() => {
                  setBusy(true);
                  setError(null);
                  api.business
                    .acceptInvite(token)
                    .then((r) => done(`/business/${encodeURIComponent(r.businessId)}`))
                    .catch((e: unknown) => {
                      setError(e instanceof Error ? e.message : 'Couldn’t accept the invite.');
                      setBusy(false);
                    });
                }}
              >
                Open {preview.businessName}
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
