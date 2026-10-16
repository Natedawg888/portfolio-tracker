/**
 * Settings → Security (KAN-16, KAN-75, redesign): a summary card, "Was this you?" for
 * sign-ins from a new device, ways to sign in (password, providers, passkeys), two-factor
 * sign-in, your devices (sessions and trusted devices together) and recent activity.
 * Secrets and codes are shown once and never kept in browser storage.
 */
import { useCallback, useEffect, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { ApiError, api, type AccountSecurity } from '../api/client';
import { ssoErrorMessage } from '../lib/sso';
import { DevicesSection } from './security/DevicesSection';
import { NewSignInCard } from './security/NewSignInCard';
import { RecentActivity } from './security/RecentActivity';
import { SecuritySummary } from './security/SecuritySummary';
import { TwoFactorCard } from './security/TwoFactorCard';
import { WaysToSignIn } from './security/WaysToSignIn';

function errorText(err: unknown, fallback: string): string {
  return err instanceof ApiError ? err.message : fallback;
}

export function SecurityPanel() {
  const [searchParams, setSearchParams] = useSearchParams();
  const [data, setData] = useState<AccountSecurity | null>(null);
  const [error, setError] = useState<string | null>(() => ssoErrorMessage(searchParams.get('sso_error')));
  const [notice] = useState<string | null>(() => {
    const p = searchParams.get('sso_linked');
    return p ? `${p.charAt(0).toUpperCase()}${p.slice(1)} connected. You can now use it to sign in.` : null;
  });
  // Account → "Change in Security" opens the password form.
  const [passwordOpen, setPasswordOpen] = useState(() => searchParams.get('change') === 'password');

  // Drop the one-off sso_linked / sso_error / change from the URL once shown.
  useEffect(() => {
    if (!searchParams.has('sso_error') && !searchParams.has('sso_linked') && !searchParams.has('change')) return;
    const next = new URLSearchParams(searchParams);
    next.delete('sso_error');
    next.delete('sso_linked');
    next.delete('change');
    setSearchParams(next, { replace: true });
  }, [searchParams, setSearchParams]);

  const reload = useCallback(async () => {
    try {
      setData(await api.auth.security());
      setError(null);
    } catch (err) {
      setError(errorText(err, 'Could not load security settings'));
    }
  }, []);

  useEffect(() => {
    void reload();
  }, [reload]);

  if (!data) return <section className="panel">{error ? <p className="warn">{error}</p> : <p className="muted">Loading…</p>}</section>;
  const newSignIn = data.newSignIns[0] ?? null;

  return (
    <>
      {error ? <p className="warn">{error}</p> : null}
      {notice ? <p className="muted" role="status">{notice}</p> : null}
      {newSignIn ? (
        <NewSignInCard
          key={newSignIn.id}
          event={newSignIn}
          data={data}
          reload={reload}
          onSecured={() => {
            if (data.hasPassword) setPasswordOpen(true);
            else document.getElementById('ways-to-sign-in')?.scrollIntoView({ block: 'start' });
          }}
        />
      ) : null}
      <SecuritySummary data={data} />
      <WaysToSignIn data={data} reload={reload} passwordOpen={passwordOpen} setPasswordOpen={setPasswordOpen} />
      <TwoFactorCard data={data} reload={reload} />
      <DevicesSection data={data} reload={reload} />
      <RecentActivity data={data} />
    </>
  );
}
