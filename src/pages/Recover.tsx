/**
 * Forgotten password (KAN-111/117): email + recovery code + new password (+ an authenticator or
 * backup code when 2FA is on). Signs in, then shows the new recovery code (the old one is used up).
 */
import { useState, type FormEvent } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../api/client';
import { RecoveryCodeDialog } from '../components/security/RecoveryCodeDialog';

export function Recover() {
  const [email, setEmail] = useState('');
  const [recoveryCode, setRecoveryCode] = useState('');
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [code, setCode] = useState('');
  const [need2fa, setNeed2fa] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [newCode, setNewCode] = useState<string | null>(null);

  async function submit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    if (password !== confirm) {
      setError('The passwords don’t match.');
      return;
    }
    setBusy(true);
    try {
      const r = await api.auth.recover({ email, recoveryCode, newPassword: password, ...(code ? { code } : {}) });
      setNewCode(r.recoveryCode);
    } catch (err) {
      const raw = err instanceof Error ? err.message : '';
      if (/TWO_FACTOR_REQUIRED/.test(raw)) {
        setNeed2fa(true);
        setError('Enter a code from your authenticator app, or a backup code.');
      } else if (/INVALID_PASSWORD/.test(raw)) setError('Choose a longer, stronger password.');
      else if (/TOO_MANY/.test(raw)) setError('Too many tries. Wait a few minutes.');
      else setError('That email and recovery code don’t match.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="auth-page">
      <div className="auth-card panel">
        <h1 className="auth-title">Reset your password</h1>
        <p className="muted small">Use the recovery code you saved when you signed up. It keeps your data readable after the reset.</p>
        <form className="auth-form" onSubmit={(e) => void submit(e)}>
          <label>
            Email
            <input type="email" autoComplete="email" value={email} onChange={(e) => setEmail(e.target.value)} required />
          </label>
          <label>
            Recovery code
            <input autoComplete="off" spellCheck={false} placeholder="XXXXX-XXXXX-…" value={recoveryCode} onChange={(e) => setRecoveryCode(e.target.value)} required />
          </label>
          <label>
            New password
            <input type="password" autoComplete="new-password" value={password} onChange={(e) => setPassword(e.target.value)} required />
          </label>
          <label>
            Confirm new password
            <input type="password" autoComplete="new-password" value={confirm} onChange={(e) => setConfirm(e.target.value)} required />
          </label>
          {need2fa ? (
            <label>
              Authenticator or backup code
              <input inputMode="numeric" autoComplete="one-time-code" value={code} onChange={(e) => setCode(e.target.value)} />
            </label>
          ) : null}
          {error ? <p className="auth-error" role="alert">{error}</p> : null}
          <button type="submit" className="btn primary" disabled={busy}>
            {busy ? 'Resetting…' : 'Reset password'}
          </button>
        </form>
        <p className="small">
          <Link to="/login">Back to sign in</Link>
        </p>
        <p className="muted small">Lost your recovery code too? Your encrypted data can’t be recovered, but you can still make a new account.</p>
      </div>
      {newCode ? <RecoveryCodeDialog code={newCode} onDone={() => window.location.assign('/')} /> : null}
    </div>
  );
}
