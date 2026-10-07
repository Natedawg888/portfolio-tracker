import { useState } from 'react';
import type { FormEvent } from 'react';
import { Link, Navigate, useNavigate, useSearchParams } from 'react-router-dom';
import { useAuth } from '../auth/AuthContext';
import { ApiError, type AuthUser } from '../api/client';
import { showQuietToast } from '../lib/quietToast';

/** Last email used on this browser (never the password). Convenience only — may be unavailable. */
const LAST_EMAIL_KEY = 'koru.auth.lastEmail';

function readLastEmail(): string {
  try {
    return localStorage.getItem(LAST_EMAIL_KEY) ?? '';
  } catch {
    return '';
  }
}

function writeLastEmail(email: string | null): void {
  try {
    if (email) localStorage.setItem(LAST_EMAIL_KEY, email);
    else localStorage.removeItem(LAST_EMAIL_KEY);
  } catch {
    /* storage blocked — nothing to remember */
  }
}

type Step = { kind: 'password' } | { kind: 'code'; challenge: string };

export function Login() {
  const { user, loading, login, completeTwoFactor, status } = useAuth();
  const navigate = useNavigate();
  // "Add another account" from the profile menu: sign in without leaving the current account.
  const [searchParams] = useSearchParams();
  const adding = searchParams.get('add') === '1';
  const [rememberedEmail, setRememberedEmail] = useState(() => (adding ? '' : readLastEmail()));
  const [email, setEmail] = useState(rememberedEmail);
  const [password, setPassword] = useState('');
  const [remember, setRemember] = useState(true);
  const [step, setStep] = useState<Step>({ kind: 'password' });
  const [code, setCode] = useState('');
  const [useBackup, setUseBackup] = useState(false);
  const [trustDevice, setTrustDevice] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  if (!loading && user && !adding) {
    if (!user.onboardingComplete) return <Navigate to="/register" replace />;
    return <Navigate to="/" replace />;
  }
  if (!loading && status?.needsSetup) return <Navigate to="/register" replace />;

  const done = (u: AuthUser) => {
    writeLastEmail(u.email);
    // After adding an account, reload so no page keeps the previous account's data.
    if (adding) window.location.assign(u.onboardingComplete ? '/' : '/register');
    else navigate(u.onboardingComplete ? '/' : '/register', { replace: true });
  };

  const onPassword = async (e: FormEvent) => {
    e.preventDefault();
    setError(null);
    setBusy(true);
    try {
      const r = await login(email, password, { remember });
      if (r.kind === 'signedIn') return done(r.user);
      setPassword('');
      setCode('');
      setStep({ kind: 'code', challenge: r.challenge });
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Login failed');
    } finally {
      setBusy(false);
    }
  };

  const onCode = async (e: FormEvent) => {
    e.preventDefault();
    if (step.kind !== 'code') return;
    setError(null);
    setBusy(true);
    try {
      const r = await completeTwoFactor(step.challenge, code, trustDevice);
      if (r.usedBackupCode) {
        const left = r.backupCodesRemaining ?? 0;
        showQuietToast(
          left <= 3
            ? `Backup code used — ${left} left. Make new ones in Settings → Security.`
            : `Backup code used — ${left} left.`,
          { kind: left <= 3 ? 'warn' : 'info' },
        );
      }
      done(r.user);
    } catch (err) {
      const apiErr = err instanceof ApiError ? err : null;
      // Only a wrong code can be retried; an expired / locked / rate-limited sign-in starts over.
      if (apiErr?.code !== 'INVALID_CODE') setStep({ kind: 'password' });
      setCode('');
      setError(apiErr ? apiErr.message : 'Could not verify the code');
    } finally {
      setBusy(false);
    }
  };

  const forgetEmail = () => {
    writeLastEmail(null);
    setRememberedEmail('');
    setEmail('');
  };

  return (
    <div className="auth-page login-page">
      <div className="auth-card panel">
        <p className="eyebrow">Portfolio Tracker</p>
        {step.kind === 'password' ? (
          <>
            <h2>{adding ? 'Add another account' : 'Sign in'}</h2>
            {adding && user ? (
              <p className="muted small">You&apos;ll stay signed in as {user.email} and can switch from the profile menu.</p>
            ) : null}
            <form className="auth-form" onSubmit={onPassword}>
              <label>
                Email
                <input
                  type="email"
                  autoComplete="username"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  required
                  disabled={busy}
                />
              </label>
              {rememberedEmail && email === rememberedEmail ? (
                <p className="muted small auth-remembered">
                  Remembered on this browser ·{' '}
                  <button type="button" className="link-btn" onClick={forgetEmail}>
                    Use a different email
                  </button>
                </p>
              ) : null}
              <label>
                Password
                <input
                  type="password"
                  autoComplete="current-password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  required
                  disabled={busy}
                  autoFocus={Boolean(rememberedEmail)}
                />
              </label>
              <label className="auth-check">
                <input type="checkbox" checked={remember} onChange={(e) => setRemember(e.target.checked)} disabled={busy} />
                <span>Keep me signed in</span>
              </label>
              {error ? <p className="auth-error" role="alert">{error}</p> : null}
              <button type="submit" className="btn primary" disabled={busy}>
                {busy ? 'Signing in…' : 'Sign in'}
              </button>
            </form>
            <p className="auth-switch">
              {adding && user ? (
                <Link to="/">Cancel</Link>
              ) : (
                <>
                  Need an account? <Link to="/register">Create account</Link>
                </>
              )}
            </p>
          </>
        ) : (
          <>
            <h2>Two-factor sign-in</h2>
            <p className="muted">
              {useBackup
                ? 'Enter one of your backup codes. Each code works once.'
                : 'Enter the 6-digit code from your authenticator app.'}
            </p>
            <form className="auth-form" onSubmit={onCode}>
              <label>
                {useBackup ? 'Backup code' : 'Authenticator code'}
                <input
                  key={useBackup ? 'backup' : 'totp'}
                  type="text"
                  inputMode={useBackup ? 'text' : 'numeric'}
                  autoComplete="one-time-code"
                  autoCapitalize="off"
                  spellCheck={false}
                  placeholder={useBackup ? 'xxxxx-xxxxx' : '123456'}
                  maxLength={useBackup ? 11 : 7}
                  value={code}
                  onChange={(e) => setCode(e.target.value)}
                  required
                  disabled={busy}
                  autoFocus
                />
              </label>
              <label className="auth-check">
                <input
                  type="checkbox"
                  checked={trustDevice}
                  onChange={(e) => setTrustDevice(e.target.checked)}
                  disabled={busy}
                />
                <span>Trust this device for 30 days</span>
              </label>
              {error ? <p className="auth-error" role="alert">{error}</p> : null}
              <button type="submit" className="btn primary" disabled={busy || !code.trim()}>
                {busy ? 'Checking…' : 'Verify'}
              </button>
            </form>
            <p className="auth-switch">
              <button
                type="button"
                className="link-btn"
                onClick={() => {
                  setUseBackup((v) => !v);
                  setCode('');
                  setError(null);
                }}
              >
                {useBackup ? 'Use your authenticator app' : 'Lost your phone? Use a backup code'}
              </button>
              {' · '}
              <button
                type="button"
                className="link-btn"
                onClick={() => {
                  setStep({ kind: 'password' });
                  setError(null);
                }}
              >
                Back
              </button>
            </p>
          </>
        )}
      </div>
    </div>
  );
}
