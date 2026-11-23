/**
 * Settings → Security: recovery code status and a new one (KAN-117). Making a new code needs the
 * password and an unlocked session; the old code stops working.
 */
import { useEffect, useState } from 'react';
import { api } from '../../api/client';
import { RecoveryCodeDialog } from './RecoveryCodeDialog';

export function RecoveryCodeCard() {
  const [has, setHas] = useState<boolean | null>(null);
  const [password, setPassword] = useState('');
  const [code, setCode] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    api.auth
      .dataKey()
      .then((r) => setHas(r.hasRecoveryCode))
      .catch(() => setHas(null));
  }, [code]);

  async function make() {
    setBusy(true);
    setError(null);
    try {
      const r = await api.auth.newRecoveryCode(password);
      setPassword('');
      setCode(r.recoveryCode);
    } catch (e) {
      const raw = e instanceof Error ? e.message : '';
      setError(/DATA_LOCKED/.test(raw) ? 'Unlock your data first (banner at the top).' : /WRONG_PASSWORD|password/i.test(raw) ? 'That password isn’t right.' : 'Couldn’t make a new code.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="panel" aria-labelledby="recovery-card-title">
      <h3 id="recovery-card-title">Recovery code</h3>
      <p className="muted small">
        {has === null ? 'Checking…' : has ? 'You have a recovery code. Make a new one if you’ve lost it; the old one stops working.' : 'You don’t have one yet. Without it, a forgotten password means your data can’t be recovered.'}
      </p>
      <div className="row gap">
        <input type="password" autoComplete="current-password" aria-label="Your password" placeholder="Your password" value={password} onChange={(e) => setPassword(e.target.value)} />
        <button type="button" className="btn small primary" disabled={busy || !password} onClick={() => void make()}>
          {has ? 'Make a new code' : 'Make my recovery code'}
        </button>
      </div>
      {error ? <p className="auth-error small" role="alert">{error}</p> : null}
      {code ? <RecoveryCodeDialog code={code} onDone={() => setCode(null)} /> : null}
    </section>
  );
}
