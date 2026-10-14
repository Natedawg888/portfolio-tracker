import { useEffect, useRef, useState } from 'react';
import type { FormEvent } from 'react';
import { Link, Navigate, useNavigate, useSearchParams } from 'react-router-dom';
import { useAuth } from '../auth/AuthContext';
import { ApiError, api, type AuthUser, type SsoProvider } from '../api/client';
import { showQuietToast } from '../lib/quietToast';
import { BusyLabel, FormError, GoogleButton, PasswordField } from '../components/auth/AuthControls';
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
  // The remembered account: last email used here, else the account this browser has a passkey for.
  const [rememberedEmail, setRememberedEmail] = useState(() => (adding ? '' : readLastEmail() || readHint()?.email || ''));
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
  // Layout only: which button shows a spinner, and whether a returning user opened the password form.
  const [pending, setPending] = useState<'passkey' | 'password' | 'code' | 'addPasskey' | null>(null);
  const [usePassword, setUsePassword] = useState(false);
  const errorRef = useRef<HTMLParagraphElement>(null);
  const attempted = useRef(false);

  // After a sign-in attempt fails, move focus to its error (not for an error shown on page load).
  useEffect(() => {
    if (error && attempted.current) errorRef.current?.focus();
    attempted.current = false;
  }, [error]);

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
    setUsePassword(false);
    setError(null);
  };

  /** Runs a sign-in action; its button shows the spinner for as long as the page is busy. */
  const track = (key: NonNullable<typeof pending>, fn: () => Promise<void>) => {
    setPending(key);
    attempted.current = true;
    void fn();
  };
  const spinning = (key: NonNullable<typeof pending>) => busy && pending === key;

  const returning = !adding && Boolean(rememberedEmail);
  const sameAccount = (h: PasskeyHint | null) => Boolean(h && h.email.toLowerCase() === rememberedEmail.toLowerCase());
  const accountName = sameAccount(hint) ? hint!.name : null;
  // "Continue" is a passkey sign-in, offered when this browser has a passkey for the remembered account.
  const canContinue = returning && canPasskey && sameAccount(hint);
  const passwordOpen = !returning || !canContinue || usePassword;
  const offerPasskeyButton = canPasskey && !adding && !canContinue;
  const google = providers.find((p) => p.id === 'google');
  const otherProviders = providers.filter((p) => p.id !== 'google');
  const ssoHref = (id: SsoProvider['id']) => ssoStartUrl(id, { remember, mode: adding ? 'add' : 'signin' });
  const hasAlternatives = Boolean(google) || otherProviders.length > 0 || offerPasskeyButton;
  const initial = Array.from((accountName || rememberedEmail).trim())[0]?.toUpperCase() ?? '?';

  // Applies to password, passkey and Google sign-in alike, so it's on every sign-in view.
  const keepSignedIn = (
    <label className="auth-check">
      <input type="checkbox" checked={remember} onChange={(e) => setRemember(e.target.checked)} disabled={busy} />
      <span>Keep me signed in</span>
    </label>
  );

  const passwordForm = (
    <form className="auth-form" onSubmit={(e) => track('password', () => onPassword(e))}>
      {returning ? (
        // Lets password managers match the saved login; the email is shown once, in the account row.
        <input
          className="sr-only"
          type="email"
          name="username"
          autoComplete="username"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          tabIndex={-1}
          aria-hidden="true"
        />
      ) : (
        <div className="auth-field">
          <label htmlFor="login-email">Email</label>
          <input
            id="login-email"
            type="email"
            name="username"
            autoComplete="username"
            inputMode="email"
            autoCapitalize="off"
            spellCheck={false}
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            required
            disabled={busy}
            autoFocus
          />
        </div>
      )}
      <PasswordField value={password} onChange={setPassword} disabled={busy} autoFocus={returning} />
      {keepSignedIn}
      <FormError ref={errorRef} message={error} />
      <button type="submit" className="btn primary auth-primary" disabled={busy}>
        <BusyLabel busy={spinning('password')} busyText="Signing in…">
          Sign in
        </BusyLabel>
      </button>
    </form>
  );

  return (
    <div className="auth-page login-page">
      <main className="auth-card panel">
        <p className="eyebrow">Portfolio Tracker</p>
        {step.kind === 'password' ? (
          <>
            <h1 className="auth-title">{adding ? 'Add another account' : returning ? 'Welcome back' : 'Sign in'}</h1>
            {adding && user ? (
              <p className="muted small">You&apos;ll stay signed in as {user.email} and can switch from the profile menu.</p>
            ) : null}

            {returning ? (
              <div className="auth-account">
                <span className="auth-avatar" aria-hidden="true">
                  {initial}
                </span>
                <div className="auth-account-text">
                  {accountName ? <span className="auth-account-name">{accountName}</span> : null}
                  <span className={accountName ? 'auth-account-email' : 'auth-account-name'}>{rememberedEmail}</span>
                </div>
                <button type="button" className="link-btn auth-not-you" onClick={forgetEmail} disabled={busy}>
                  Not you?
                </button>
              </div>
            ) : null}

            {passwordOpen ? (
              passwordForm
            ) : (
              <div className="auth-form">
                {keepSignedIn}
                <FormError ref={errorRef} message={error} />
                <button type="button" className="btn primary auth-primary" disabled={busy} onClick={() => track('passkey', onPasskey)}>
                  <BusyLabel busy={spinning('passkey')} busyText="Waiting for your device…">
                    Continue
                  </BusyLabel>
                </button>
              </div>
            )}
            {canContinue ? (
              <p className="auth-toggle">
                <button
                  type="button"
                  className="link-btn"
                  disabled={busy}
                  onClick={() => {
                    setUsePassword((v) => !v);
                    setError(null);
                  }}
                >
                  {usePassword ? 'Use your passkey instead' : 'Use password instead'}
                </button>
              </p>
            ) : null}

            {hasAlternatives ? (
              <div className="sso-buttons">
                <p className="auth-divider">
                  <span>or</span>
                </p>
                {google ? <GoogleButton href={ssoHref('google')} disabled={busy} /> : null}
                {otherProviders.map((p) => (
                  <a
                    key={p.id}
                    className={`btn ghost sso-btn sso-btn--${p.id}` + (busy ? ' is-disabled' : '')}
                    href={ssoHref(p.id)}
                    aria-disabled={busy || undefined}
                    onClick={(e) => (busy ? e.preventDefault() : undefined)}
                  >
                    Continue with {p.label}
                  </a>
                ))}
                {offerPasskeyButton ? (
                  <button type="button" className="btn ghost sso-btn" disabled={busy} onClick={() => track('passkey', onPasskey)}>
                    <BusyLabel busy={spinning('passkey')} busyText="Waiting for your device…">
                      Sign in with a passkey
                    </BusyLabel>
                  </button>
                ) : null}
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
            <h1 className="auth-title">Sign in faster next time</h1>
            <p className="muted">
              Use Face ID, Touch ID, Windows Hello or your device PIN instead of your password on this device. Your password
              still works.
            </p>
            <div className="auth-form">
              <FormError ref={errorRef} message={error} />
              <button type="button" className="btn primary auth-primary" disabled={busy} onClick={() => track('addPasskey', onAddPasskey)}>
                <BusyLabel busy={spinning('addPasskey')} busyText="Waiting for your device…">
                  Use this device to sign in
                </BusyLabel>
              </button>
              <button type="button" className="btn ghost auth-secondary" disabled={busy} onClick={onSkipPasskey}>
                Not now
              </button>
            </div>
          </>
        ) : (
          <>
            <h1 className="auth-title">Two-factor sign-in</h1>
            <p className="muted">
              {useBackup
                ? 'Enter one of your backup codes. Each code works once.'
                : 'Enter the 6-digit code from your authenticator app.'}
            </p>
            <form className="auth-form" onSubmit={(e) => track('code', () => onCode(e))}>
              <div className="auth-field">
                <label htmlFor="login-code">{useBackup ? 'Backup code' : 'Authenticator code'}</label>
                <input
                  id="login-code"
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
              </div>
              <label className="auth-check">
                <input
                  type="checkbox"
                  checked={trustDevice}
                  onChange={(e) => setTrustDevice(e.target.checked)}
                  disabled={busy}
                />
                <span>Trust this device for 30 days</span>
              </label>
              <FormError ref={errorRef} message={error} />
              <button type="submit" className="btn primary auth-primary" disabled={busy || !code.trim()}>
                <BusyLabel busy={spinning('code')} busyText="Checking…">
                  Verify
                </BusyLabel>
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
      </main>
    </div>
  );
}
