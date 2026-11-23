/**
 * Data unlock (KAN-117). After a passkey or Google / Apple / Microsoft sign-in, or a server restart,
 * the session's data key is locked: this banner asks for the password (or the data passphrase) to
 * unlock it. Accounts with no password and no key yet set a data passphrase here. Unlocked accounts
 * without a recovery code get a nudge to make one. Re-checks when the server says data is locked.
 */
import { useCallback, useEffect, useState, type FormEvent } from 'react';
import { Link } from 'react-router-dom';
import { api, DATA_LOCKED_EVENT } from '../../api/client';

type State = { state: 'unlocked' | 'locked' | 'needs_passphrase'; hasRecoveryCode: boolean };

export function DataUnlockBanner() {
  const [s, setS] = useState<State | null>(null);
  const [secret, setSecret] = useState('');
  const [confirm, setConfirm] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(() => {
    api.auth
      .dataKey()
      .then(setS)
      .catch(() => setS(null));
  }, []);
  useEffect(() => {
    load();
    window.addEventListener(DATA_LOCKED_EVENT, load);
    return () => window.removeEventListener(DATA_LOCKED_EVENT, load);
  }, [load]);

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (!s) return;
    setError(null);
    if (s.state === 'needs_passphrase' && secret !== confirm) {
      setError('The two passphrases don’t match.');
      return;
    }
    setBusy(true);
    try {
      if (s.state === 'needs_passphrase') await api.auth.setDataPassphrase(secret);
      else await api.auth.unlockData(secret);
      setSecret('');
      setConfirm('');
      load();
    } catch (err) {
      const raw = err instanceof Error ? err.message : '';
      setError(/WRONG_PASSPHRASE|isn’t right/.test(raw) ? 'That isn’t right. Try again.' : /TOO_MANY/.test(raw) ? 'Too many tries. Wait a few minutes.' : 'Couldn’t unlock. Try again.');
    } finally {
      setBusy(false);
    }
  }

  if (!s) return null;
  if (s.state === 'unlocked') {
    return s.hasRecoveryCode ? null : (
      <div className="banner data-unlock-banner" role="note">
        You don’t have a recovery code yet. <Link to="/settings?tab=security">Make one</Link> so you can get back in if you forget your password.
      </div>
    );
  }
  const setting = s.state === 'needs_passphrase';
  return (
    <form className="banner data-unlock-banner" onSubmit={(e) => void submit(e)} aria-label={setting ? 'Set a data passphrase' : 'Unlock your data'}>
      <p className="small">
        {setting
          ? 'Set a data passphrase. Your data is encrypted with it, so keep it safe: you’ll enter it after signing in with Google, Apple or Microsoft.'
          : 'Your data is locked. Enter your password (or data passphrase) to see and change it.'}
      </p>
      <div className="row gap">
        <input type="password" autoComplete={setting ? 'new-password' : 'current-password'} aria-label={setting ? 'New data passphrase' : 'Password or passphrase'} placeholder={setting ? 'New passphrase' : 'Password or passphrase'} value={secret} onChange={(e) => setSecret(e.target.value)} required />
        {setting ? <input type="password" autoComplete="new-password" aria-label="Confirm passphrase" placeholder="Confirm" value={confirm} onChange={(e) => setConfirm(e.target.value)} required /> : null}
        <button type="submit" className="btn small primary" disabled={busy || !secret}>
          {busy ? '…' : setting ? 'Set passphrase' : 'Unlock'}
        </button>
      </div>
      {error ? <p className="auth-error small" role="alert">{error}</p> : null}
    </form>
  );
}
