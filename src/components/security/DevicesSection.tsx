/**
 * "Your devices": signed-in sessions and trusted devices as one list (see groupDevices).
 * Signing a device out or no longer trusting it only takes access away, so those act at once;
 * "Sign out everywhere else" asks first.
 */
import { useState } from 'react';
import { ApiError, api, type AccountSecurity } from '../../api/client';
import { showQuietToast } from '../../lib/quietToast';
import { deviceTwoFactorText, groupDevices, plural, shortWhen, type Device } from '../../lib/securityView';
import { ConfirmInline } from './ConfirmInline';
import { MethodIcon } from './MethodIcon';

const toast = (message: string) => showQuietToast(message, { kind: 'info', ttlMs: 5000 });

function errorText(err: unknown, fallback: string): string {
  return err instanceof ApiError ? err.message : fallback;
}

export function DevicesSection({ data, reload }: { data: AccountSecurity; reload: () => Promise<void> }) {
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [confirmOthers, setConfirmOthers] = useState(false);
  const devices = groupDevices(data);
  const others = devices.filter((d) => d.signedIn && !d.current);
  const othersSessions = data.sessions.filter((s) => !s.current).length;

  const act = async (key: string, fn: () => Promise<string>) => {
    setBusy(key);
    setError(null);
    try {
      toast(await fn());
      await reload();
    } catch (err) {
      setError(errorText(err, 'That didn’t work. Try again.'));
    } finally {
      setBusy(null);
    }
  };

  const signOut = (d: Device) =>
    act(`out-${d.key}`, async () => {
      for (const s of d.sessions) await api.auth.revokeSession(s.id);
      return `${d.name} signed out.`;
    });

  const stopTrusting = (d: Device) =>
    act(`trust-${d.key}`, async () => {
      await api.auth.revokeTrustedDevice(d.trusted!.id);
      return `${d.name} will ask for a two-factor code next time.`;
    });

  return (
    <section className="panel security-section" id="devices" aria-labelledby="devices-title">
      <h3 id="devices-title">Your devices</h3>
      <p className="security-lead">Browsers signed in to this account, and browsers that skip the two-factor code. Sign out any you don’t recognise.</p>
      {error ? (
        <p className="auth-error" role="alert">
          {error}
        </p>
      ) : null}
      <ul className="security-rows">
        {devices.map((d) => {
          const active = shortWhen(d.lastActiveAt);
          const who = `${d.name}${d.current ? ' (this device)' : `, last active ${active}`}`;
          const twoFactor = deviceTwoFactorText(d, data.twoFactor.enabled);
          return (
            <li key={d.key} className="security-row">
              <MethodIcon kind="device" />
              <div className="security-row-main">
                <p className="security-row-name">
                  {d.name}
                  {d.current ? <span className="security-chip security-chip--here">This device</span> : null}
                </p>
                <p className="security-row-sub">
                  {d.signedIn ? (d.current ? 'Signed in · active now' : `Signed in · active ${active}`) : `Not signed in · last used ${active}`}
                  {d.sessions.length > 1 ? ` · ${plural(d.sessions.length, 'sign-in')}` : ''}
                </p>
                {twoFactor ? <p className="security-row-sub">{twoFactor}</p> : null}
              </div>
              {(d.signedIn && !d.current) || d.trusted ? (
                <div className="security-row-actions">
                  {d.signedIn && !d.current ? (
                    <button type="button" className="btn small" aria-label={`Sign out ${who}`} disabled={busy != null} onClick={() => void signOut(d)}>
                      {busy === `out-${d.key}` ? 'Signing out…' : 'Sign out'}
                    </button>
                  ) : null}
                  {d.trusted ? (
                    <button type="button" className="btn small" aria-label={`Stop trusting ${who}`} disabled={busy != null} onClick={() => void stopTrusting(d)}>
                      {busy === `trust-${d.key}` ? 'Working…' : 'Stop trusting'}
                    </button>
                  ) : null}
                </div>
              ) : null}
            </li>
          );
        })}
      </ul>

      {others.length > 0 ? (
        <div className="security-section-foot">
          {!confirmOthers ? (
            <button type="button" id="sign-out-others" className="btn danger" onClick={() => setConfirmOthers(true)}>
              Sign out everywhere else
            </button>
          ) : (
            <ConfirmInline
              returnFocusId="sign-out-others"
              title={`Sign out ${plural(others.length, 'other device')}?`}
              cancelLabel="Keep them signed in"
              confirmLabel="Sign out everywhere else"
              busy={busy === 'others'}
              error={error}
              onCancel={() => setConfirmOthers(false)}
              onConfirm={() =>
                void act('others', async () => {
                  const r = await api.auth.revokeOtherSessions();
                  setConfirmOthers(false);
                  return r.signedOut > 0 ? `Signed out ${plural(r.signedOut, 'other browser')}.` : 'No other browsers were signed in.';
                })
              }
            >
              <p>
                Every browser except this one is signed out ({plural(othersSessions, 'sign-in')}).
                {data.trustedDevices.length > 0 ? ' Trusted browsers still skip two-factor when they sign in again; use Stop trusting for those.' : ''}
              </p>
            </ConfirmInline>
          )}
        </div>
      ) : null}
    </section>
  );
}
