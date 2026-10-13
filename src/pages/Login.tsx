import { useEffect, useState } from 'react';
import type { FormEvent } from 'react';
import { Link, Navigate, useNavigate, useSearchParams } from 'react-router-dom';
import { useAuth } from '../auth/AuthContext';
import { ApiError, api, type AuthUser, type SsoProvider } from '../api/client';
import { showQuietToast } from '../lib/quietToast';
import { ssoErrorMessage, ssoStartUrl } from '../lib/sso';
import {
  addPasskey,
  dismissOffer,
  hintName,
  offerDismissed,
  passkeysSupported,
  readHint,
  wasCancelled,
  writeHint,
  type PasskeyHint,
} from '../lib/passkeys';

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

type Step =
  | { kind: 'password' }
  | { kind: 'code'; challenge: string }
  /** After a password sign-in: offer a passkey for next time (KAN-75). */
  | { kind: 'offer'; user: AuthUser };

/** After Google / Apple / Microsoft sign-in with 2FA on, the server sends #sso2fa=<challenge>. */
function initialStep(): Step {
  const m = /^#sso2fa=([A-Za-z0-9_%-]{20,200})$/.exec(window.location.hash);
  if (!m) return { kind: 'password' };
  // Drop the challenge from the address bar and history.
  window.history.replaceState(null, '', window.location.pathname + window.location.search);
  return { kind: 'code', challenge: decodeURIComponent(m[1]) };
}

export function Login() {
  const { user, loading, login, completeTwoFactor, passkeySignIn, status } = useAuth();
  const navigate = useNavigate();
  // "Add another account" from the profile menu: sign in without leaving the current account.
  const [searchParams] = useSearchParams();
  const adding = searchParams.get('add') === '1';
  const [rememberedEmail, setRememberedEmail] = useState(() => (adding ? '' : readLastEmail()));
  const [email, setEmail] = useState(rememberedEmail);
  const [password, setPassword] = useState('');
  const [remember, setRemember] = useState(true);
  const [step, setStep] = useState<Step>(initialStep);
  const [providers, setProviders] = useState<SsoProvider[]>([]);
  const [code, setCode] = useState('');
  const [useBackup, setUseBackup] = useState(false);
  const [trustDevice, setTrustDevice] = useState(false);
  const [error, setError] = useState<string | null>(() => ssoErrorMessage(searchParams.get('sso_error')));
  const [busy, setBusy] = useState(false);
  const [canPasskey] = useState(passkeysSupported);
  const [hint, setHint] = useState<PasskeyHint | null>(() => (adding ? null : readHint()));

  useEffect(() => {
    let cancelled = false;
    api.auth
      .ssoProviders()
      .then((r) => {
        if (!cancelled) setProviders(r.providers);
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, []);

  if (!loading && user && !adding) {
    if (!user.onboardingComplete) return <Navigate to="/register" replace />;
    return <Navigate to="/" replace />;
  }
  if (!loading && status?.needsSetup) return <Navigate to="/register" replace />;

  const finish = (u: AuthUser) => {
    writeLastEmail(u.email);
    // After adding an account, reload so no page keeps the previous account's data.
    if (adding) window.location.assign(u.onboardingComplete ? '/' : '/register');
    else navigate(u.onboardingComplete ? '/' : '/register', { replace: true });
  };

  /** After a password (or 2FA) sign-in, offer a passkey once per account on this browser. */
  const done = (u: AuthUser) => {
    const hasHint = hint?.email.toLowerCase() === u.email.toLowerCase();
    if (canPasskey && !adding && !hasHint && !offerDismissed(u.email)) {
      writeLastEmail(u.email);
      setError(null);
      setStep({ kind: 'offer', user: u });
      return;
    }
    finish(u);
  };

  const onPasskey = async () => {
    setError(null);
    setBusy(true);
    try {
      const u = await passkeySignIn(remember);
      const next = { email: u.email, name: hintName(u) };
      writeHint(next);
      setHint(next);
      finish(u);
    } catch (err) {
      if (wasCancelled(err)) {
        setError(null);
      } else if (err instanceof ApiError && err.code === 'UNKNOWN_PASSKEY') {
        writeHint(null);
        setHint(null);
        setError('That passkey was removed from your account. Sign in with your password.');
      } else {
        setError(err instanceof ApiError ? err.message : 'Passkey sign-in didn’t work. Try again or use your password.');
      }
    } finally {
      setBusy(false);
    }
  };

  const onAddPasskey = async () => {
    if (step.kind !== 'offer') return;
    setError(null);
    setBusy(true);
    try {
      await addPasskey();
      writeHint({ email: step.user.email, name: hintName(step.user) });
      showQuietToast('Passkey added. Next time, sign in with one tap.', { kind: 'info' });
      finish(step.user);
    } catch (err) {
      if (wasCancelled(err)) setError(null);
      else setError(err instanceof ApiError ? err.message : 'Couldn’t add a passkey on this device.');
      setBusy(false);
    }
  };

  const onSkipPasskey = () => {
    if (step.kind !== 'offer') return;
    dismissOffer(step.user.email);
    finish(step.user);
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
    writeHint(null);
    setHint(null);
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
            {canPasskey && hint ? (
              <div className="passkey-continue">
                <button type="button" className="btn primary passkey-continue-btn" disabled={busy} onClick={() => void onPasskey()}>
                  <span>Continue as {hint.name}</span>
                  <span className="passkey-continue-email">{hint.email}</span>
                </button>
                <p className="sso-divider muted small">or use your password</p>
              </div>
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
            {canPasskey && !hint && !adding ? (
              <div className="sso-buttons">
                <p className="sso-divider muted small">or</p>
                <button type="button" className="btn ghost sso-btn" disabled={busy} onClick={() => void onPasskey()}>
                  Sign in with a passkey
                </button>
              </div>
            ) : null}
            {providers.length > 0 ? (
              <div className="sso-buttons">
                {canPasskey && !hint && !adding ? null : <p className="sso-divider muted small">or</p>}
                {providers.map((p) => (
                  <a
                    key={p.id}
                    className={`btn ghost sso-btn sso-btn--${p.id}`}
                    href={ssoStartUrl(p.id, { remember, mode: adding ? 'add' : 'signin' })}
                  >
                    Continue with {p.label}
                  </a>
                ))}
              </div>
            ) : null}
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
        ) : step.kind === 'offer' ? (
          <>
            <h2>Sign in faster next time</h2>
            <p className="muted">
              Use Face ID, Touch ID, Windows Hello or your device PIN instead of your password on this device. Your password
              still works.
            </p>
            {error ? <p className="auth-error" role="alert">{error}</p> : null}
            <div className="auth-form">
              <button type="button" className="btn primary" disabled={busy} onClick={() => void onAddPasskey()}>
                {busy ? 'Waiting for your device…' : 'Use this device to sign in'}
              </button>
              <button type="button" className="btn ghost" disabled={busy} onClick={onSkipPasskey}>
                Not now
              </button>
            </div>
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
