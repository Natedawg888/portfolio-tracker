/**
 * Settings → Security (KAN-16): two-factor sign-in with an authenticator app, backup
 * codes, signed-in sessions and trusted devices. Passkeys and recent sign-ins (KAN-75). Secrets and codes are shown once and
 * never kept in browser storage.
 */
import { useCallback, useEffect, useState, type FormEvent } from 'react';
import { useSearchParams } from 'react-router-dom';
import { ApiError, api, type AccountSecurity } from '../api/client';
import { ssoErrorMessage, ssoStartUrl } from '../lib/sso';
import { useAuth } from '../auth/AuthContext';
import { addPasskey, authEventText, hintName, passkeysSupported, readHint, wasCancelled, writeHint } from '../lib/passkeys';

function when(iso: string | null): string {
  if (!iso) return '—';
  const d = new Date(iso);
  return Number.isNaN(d.getTime())
    ? '—'
    : d.toLocaleString('en-NZ', { dateStyle: 'medium', timeStyle: 'short', timeZone: 'Pacific/Auckland' });
}

function errorText(err: unknown, fallback: string): string {
  return err instanceof ApiError ? err.message : fallback;
}

function svgDataUrl(svg: string): string {
  let bin = '';
  for (const b of new TextEncoder().encode(svg)) bin += String.fromCharCode(b);
  return `data:image/svg+xml;base64,${btoa(bin)}`;
}

function BackupCodes({ codes, onDone }: { codes: string[]; onDone: () => void }) {
  const text = `KoruLedger backup codes (each works once)\n\n${codes.join('\n')}\n`;
  const download = () => {
    const url = URL.createObjectURL(new Blob([text], { type: 'text/plain' }));
    const a = document.createElement('a');
    a.href = url;
    a.download = 'koruledger-backup-codes.txt';
    a.click();
    URL.revokeObjectURL(url);
  };
  return (
    <div className="stack">
      <p>
        <strong>Save these backup codes somewhere safe.</strong> If you lose your phone, each one signs you in once.
        They won&apos;t be shown again.
      </p>
      <ul className="backup-codes" aria-label="Backup codes">
        {codes.map((c) => (
          <li key={c}>{c}</li>
        ))}
      </ul>
      <div className="row gap">
        <button type="button" className="btn ghost" onClick={() => void navigator.clipboard?.writeText(text)}>
          Copy
        </button>
        <button type="button" className="btn ghost" onClick={download}>
          Download .txt
        </button>
        <button type="button" className="btn primary" onClick={onDone}>
          I&apos;ve saved them
        </button>
      </div>
    </div>
  );
}

type Setup = { secret: string; otpauthUri: string; qrSvg: string };

function TwoFactorSection({ state, reload }: { state: AccountSecurity['twoFactor']; reload: () => Promise<void> }) {
  const [mode, setMode] = useState<'idle' | 'password' | 'scan' | 'codes' | 'disable' | 'regen'>('idle');
  const [password, setPassword] = useState('');
  const [code, setCode] = useState('');
  const [setup, setSetup] = useState<Setup | null>(null);
  const [codes, setCodes] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const reset = () => {
    setMode('idle');
    setPassword('');
    setCode('');
    setSetup(null);
    setError(null);
  };

  const run = async (fn: () => Promise<void>, fallback: string) => {
    setBusy(true);
    setError(null);
    try {
      await fn();
    } catch (err) {
      setError(errorText(err, fallback));
      setCode('');
    } finally {
      setBusy(false);
    }
  };

  const onPassword = (e: FormEvent) => {
    e.preventDefault();
    void run(async () => {
      setSetup(await api.auth.twoFactorSetup(password));
      setPassword('');
      setMode('scan');
    }, 'Could not start setup');
  };

  const onEnable = (e: FormEvent) => {
    e.preventDefault();
    void run(async () => {
      const r = await api.auth.twoFactorEnable(code);
      setCodes(r.backupCodes);
      setSetup(null);
      setCode('');
      setMode('codes');
      await reload();
    }, 'Could not turn on two-factor sign-in');
  };

  const onDisable = (e: FormEvent) => {
    e.preventDefault();
    void run(async () => {
      await api.auth.twoFactorDisable({ password, code });
      reset();
      await reload();
    }, 'Could not turn off two-factor sign-in');
  };

  const onRegen = (e: FormEvent) => {
    e.preventDefault();
    void run(async () => {
      const r = await api.auth.twoFactorBackupCodes({ password, code });
      setCodes(r.backupCodes);
      setPassword('');
      setCode('');
      setMode('codes');
      await reload();
    }, 'Could not make new backup codes');
  };

  const confirmFields = (
    <>
      <label>
        <span>Current password</span>
        <input type="password" value={password} onChange={(e) => setPassword(e.target.value)} autoComplete="current-password" required disabled={busy} />
      </label>
      <label>
        <span>Authenticator or backup code</span>
        <input type="text" inputMode="text" autoComplete="one-time-code" value={code} onChange={(e) => setCode(e.target.value)} required disabled={busy} />
      </label>
    </>
  );

  return (
    <section className="panel">
      <h3>Two-factor sign-in</h3>
      {mode === 'codes' ? (
        <BackupCodes codes={codes} onDone={() => { setCodes([]); reset(); }} />
      ) : state.enabled ? (
        <>
          <p>
            <strong>On</strong> since {when(state.enabledAt)} · {state.backupCodesRemaining} backup code
            {state.backupCodesRemaining === 1 ? '' : 's'} left
          </p>
          {state.backupCodesRemaining <= 3 ? (
            <p className="warn small">You&apos;re running low on backup codes. Make a new set so you can still get in if you lose your phone.</p>
          ) : null}
          {mode === 'disable' || mode === 'regen' ? (
            <form className="auth-form account-form" onSubmit={mode === 'disable' ? onDisable : onRegen}>
              {confirmFields}
              {error ? <p className="auth-error" role="alert">{error}</p> : null}
              <div className="row gap">
                <button type="submit" className={mode === 'disable' ? 'btn danger' : 'btn primary'} disabled={busy}>
                  {mode === 'disable' ? 'Turn off two-factor sign-in' : 'Make new backup codes'}
                </button>
                <button type="button" className="btn ghost" onClick={reset} disabled={busy}>
                  Cancel
                </button>
              </div>
            </form>
          ) : (
            <div className="row gap">
              <button type="button" className="btn ghost" onClick={() => setMode('regen')}>
                New backup codes
              </button>
              <button type="button" className="btn danger" onClick={() => setMode('disable')}>
                Turn off
              </button>
            </div>
          )}
        </>
      ) : mode === 'idle' ? (
        <>
          <p className="muted">
            Ask for a code from an authenticator app (Google Authenticator, 1Password, Authy, Microsoft
            Authenticator) when you sign in, so a stolen password isn&apos;t enough to open your finances.
          </p>
          <button type="button" className="btn primary" onClick={() => setMode('password')}>
            Turn on
          </button>
        </>
      ) : mode === 'password' ? (
        <form className="auth-form account-form" onSubmit={onPassword}>
          <label>
            <span>Current password</span>
            <input type="password" value={password} onChange={(e) => setPassword(e.target.value)} autoComplete="current-password" required disabled={busy} autoFocus />
          </label>
          {error ? <p className="auth-error" role="alert">{error}</p> : null}
          <div className="row gap">
            <button type="submit" className="btn primary" disabled={busy}>Continue</button>
            <button type="button" className="btn ghost" onClick={reset} disabled={busy}>Cancel</button>
          </div>
        </form>
      ) : setup ? (
        <form className="auth-form account-form" onSubmit={onEnable}>
          <p>1. Scan this with your authenticator app.</p>
          <img className="security-qr" src={svgDataUrl(setup.qrSvg)} alt="QR code for your authenticator app" />
          <p className="muted small">
            Can&apos;t scan? Enter this key instead: <span className="security-secret">{setup.secret.replace(/(.{4})/g, '$1 ').trim()}</span>
          </p>
          <label>
            <span>2. Enter the 6-digit code it shows</span>
            <input type="text" inputMode="numeric" autoComplete="one-time-code" maxLength={7} value={code} onChange={(e) => setCode(e.target.value)} required disabled={busy} autoFocus />
          </label>
          {error ? <p className="auth-error" role="alert">{error}</p> : null}
          <div className="row gap">
            <button type="submit" className="btn primary" disabled={busy || !code.trim()}>Turn on</button>
            <button type="button" className="btn ghost" onClick={reset} disabled={busy}>Cancel</button>
          </div>
        </form>
      ) : null}
    </section>
  );
}

/** Password + Google / Apple / Microsoft connections. */
function SignInMethods({ data, reload }: { data: AccountSecurity; reload: () => Promise<void> }) {
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [msg, setMsg] = useState<string | null>(null);
  const linked = new Set(data.identities.map((i) => i.provider));
  const connectable = data.ssoProviders.filter((p) => !linked.has(p.id));

  const setFirstPassword = async (e: FormEvent) => {
    e.preventDefault();
    setBusy('password');
    setError(null);
    try {
      await api.auth.changePassword({ currentPassword: '', newPassword: password });
      setPassword('');
      setMsg('Password set. You can now sign in with your email and password too.');
      await reload();
    } catch (err) {
      setError(errorText(err, 'Could not set a password'));
    } finally {
      setBusy(null);
    }
  };

  const disconnect = async (id: string) => {
    setBusy(id);
    setError(null);
    try {
      await api.auth.disconnectIdentity(id);
      await reload();
    } catch (err) {
      setError(errorText(err, 'Could not disconnect'));
    } finally {
      setBusy(null);
    }
  };

  if (!data.hasPassword && data.identities.length === 0 && data.ssoProviders.length === 0) return null;
  return (
    <section className="panel">
      <h3>Sign-in methods</h3>
      <ul className="security-list">
        <li>
          <div>
            <strong>Email and password</strong>
            <div className="muted small">{data.hasPassword ? 'Set' : 'Not set — you sign in with a connected account below'}</div>
          </div>
        </li>
        {data.identities.map((i) => (
          <li key={i.id}>
            <div>
              <strong>{i.label}</strong>
              {i.email ? <span className="muted small"> · {i.email}</span> : null}
              <div className="muted small">Connected {when(i.createdAt)} · last used {when(i.lastUsedAt)}</div>
            </div>
            <button type="button" className="btn ghost" disabled={busy === i.id} onClick={() => void disconnect(i.id)}>
              Disconnect
            </button>
          </li>
        ))}
      </ul>
      {!data.hasPassword ? (
        <form className="auth-form account-form" onSubmit={setFirstPassword}>
          <label>
            <span>Set a password (needed to turn on two-factor sign-in, change your email or delete the account)</span>
            <input type="password" value={password} onChange={(e) => setPassword(e.target.value)} autoComplete="new-password" minLength={8} required disabled={busy !== null} />
          </label>
          <button type="submit" className="btn primary" disabled={busy !== null || password.length < 8}>
            Set password
          </button>
        </form>
      ) : null}
      {connectable.length ? (
        <div className="row gap">
          {connectable.map((p) => (
            <a key={p.id} className={`btn ghost sso-btn sso-btn--${p.id}`} href={ssoStartUrl(p.id, { mode: 'link' })}>
              Connect {p.label}
            </a>
          ))}
        </div>
      ) : null}
      {msg ? <p className="muted" role="status">{msg}</p> : null}
      {error ? <p className="auth-error" role="alert">{error}</p> : null}
    </section>
  );
}

function PasskeysSection({ data, reload }: { data: AccountSecurity; reload: () => Promise<void> }) {
  const { user } = useAuth();
  const [supported] = useState(passkeysSupported);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [needPassword, setNeedPassword] = useState(false);
  const [password, setPassword] = useState('');
  const [renaming, setRenaming] = useState<{ id: string; name: string } | null>(null);

  async function add(e?: FormEvent) {
    e?.preventDefault();
    setBusy('add');
    setError(null);
    setNotice(null);
    try {
      await addPasskey({ password: needPassword ? password : undefined });
      if (user) writeHint({ email: user.email, name: hintName(user) });
      setNeedPassword(false);
      setPassword('');
      setNotice('Passkey added. You can sign in on this device with one tap.');
      await reload();
    } catch (err) {
      if (err instanceof ApiError && err.code === 'REAUTH_REQUIRED') {
        if (data.hasPassword) {
          setNeedPassword(true);
          if (needPassword) setError('That password isn’t right.');
        } else {
          setError('For your security, sign out and back in, then add the passkey within 15 minutes.');
        }
      } else if (!wasCancelled(err)) {
        setError(errorText(err, 'Couldn’t add a passkey on this device.'));
      }
    } finally {
      setBusy(null);
    }
  }

  async function saveName(e: FormEvent) {
    e.preventDefault();
    if (!renaming) return;
    setBusy(renaming.id);
    setError(null);
    try {
      await api.auth.renamePasskey(renaming.id, renaming.name);
      setRenaming(null);
      await reload();
    } catch (err) {
      setError(errorText(err, 'Couldn’t rename that passkey.'));
    } finally {
      setBusy(null);
    }
  }

  async function remove(id: string, name: string) {
    if (!window.confirm(`Remove ${name}? It can’t be used to sign in any more, and anything signed in with it (other than this browser) is signed out.`)) return;
    setBusy(id);
    setError(null);
    setNotice(null);
    try {
      const r = await api.auth.removePasskey(id);
      // The hint on this browser may point at the removed passkey; "Sign in with a passkey" still works.
      if (data.passkeys.length <= 1 && readHint()?.email === user?.email) writeHint(null);
      setNotice(r.sessionsEnded > 0 ? `${name} removed. ${r.sessionsEnded} signed-in session${r.sessionsEnded === 1 ? '' : 's'} ended.` : `${name} removed.`);
      await reload();
    } catch (err) {
      setError(errorText(err, 'Couldn’t remove that passkey.'));
    } finally {
      setBusy(null);
    }
  }

  return (
    <section className="panel">
      <h3>Passkeys</h3>
      <p className="muted small">
        Sign in with Face ID, Touch ID, Windows Hello or your device PIN instead of a password. A passkey counts as two-factor
        sign-in. Your password still works.
      </p>
      {error ? <p className="auth-error" role="alert">{error}</p> : null}
      {notice ? <p className="muted" role="status">{notice}</p> : null}
      {data.passkeys.length > 0 ? (
        <ul className="security-list">
          {data.passkeys.map((p) => (
            <li key={p.id}>
              {renaming?.id === p.id ? (
                <form className="passkey-rename" onSubmit={saveName}>
                  <label>
                    Name
                    <input value={renaming.name} maxLength={60} autoFocus onChange={(e) => setRenaming({ id: p.id, name: e.target.value })} />
                  </label>
                  <button type="submit" className="btn small primary" disabled={busy === p.id || !renaming.name.trim()}>
                    Save
                  </button>
                  <button type="button" className="btn small ghost" onClick={() => setRenaming(null)}>
                    Cancel
                  </button>
                </form>
              ) : (
                <>
                  <div>
                    <strong>{p.name}</strong>
                    <div className="muted small">
                      Added {when(p.createdAt)} · {p.lastUsedAt ? `last used ${when(p.lastUsedAt)}` : 'not used yet'}
                    </div>
                  </div>
                  <div className="row gap">
                    <button type="button" className="btn ghost" disabled={busy != null} onClick={() => setRenaming({ id: p.id, name: p.name })}>
                      Rename
                    </button>
                    <button type="button" className="btn ghost" disabled={busy != null} onClick={() => void remove(p.id, p.name)}>
                      Remove
                    </button>
                  </div>
                </>
              )}
            </li>
          ))}
        </ul>
      ) : (
        <p className="muted">No passkeys yet.</p>
      )}
      {!supported ? (
        <p className="muted small">This browser can’t create passkeys. Try a recent version of Chrome, Edge, Safari or Firefox.</p>
      ) : needPassword ? (
        <form className="passkey-reauth" onSubmit={(e) => void add(e)}>
          <label>
            Confirm your password to add a passkey
            <input type="password" autoComplete="current-password" value={password} autoFocus onChange={(e) => setPassword(e.target.value)} />
          </label>
          <div className="row gap">
            <button type="submit" className="btn primary" disabled={busy === 'add' || !password}>
              {busy === 'add' ? 'Waiting for your device…' : 'Continue'}
            </button>
            <button type="button" className="btn ghost" onClick={() => setNeedPassword(false)}>
              Cancel
            </button>
          </div>
        </form>
      ) : (
        <button type="button" className="btn" disabled={busy === 'add'} onClick={() => void add()}>
          {busy === 'add' ? 'Waiting for your device…' : 'Add a passkey on this device'}
        </button>
      )}
    </section>
  );
}

export function SecurityPanel() {
  const [searchParams, setSearchParams] = useSearchParams();
  const [data, setData] = useState<AccountSecurity | null>(null);
  const [error, setError] = useState<string | null>(() => ssoErrorMessage(searchParams.get('sso_error')));
  const [notice] = useState<string | null>(() => {
    const p = searchParams.get('sso_linked');
    return p ? `${p.charAt(0).toUpperCase()}${p.slice(1)} connected. You can now use it to sign in.` : null;
  });
  const [busyId, setBusyId] = useState<string | null>(null);

  // Drop the one-off sso_linked / sso_error from the URL once shown.
  useEffect(() => {
    if (!searchParams.has('sso_error') && !searchParams.has('sso_linked')) return;
    const next = new URLSearchParams(searchParams);
    next.delete('sso_error');
    next.delete('sso_linked');
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

  const act = async (id: string, fn: () => Promise<unknown>) => {
    setBusyId(id);
    try {
      await fn();
      await reload();
    } catch (err) {
      setError(errorText(err, 'That didn’t work. Try again.'));
    } finally {
      setBusyId(null);
    }
  };

  if (!data) return <section className="panel">{error ? <p className="warn">{error}</p> : <p className="muted">Loading…</p>}</section>;
  const others = data.sessions.filter((s) => !s.current);

  return (
    <>
      {error ? <p className="warn">{error}</p> : null}
      {notice ? <p className="muted" role="status">{notice}</p> : null}
      <SignInMethods data={data} reload={reload} />
      <PasskeysSection data={data} reload={reload} />
      {data.hasPassword ? (
        <TwoFactorSection state={data.twoFactor} reload={reload} />
      ) : (
        <section className="panel">
          <h3>Two-factor sign-in</h3>
          <p className="muted">Set a password above first — turning on two-factor sign-in asks for it.</p>
        </section>
      )}

      <section className="panel">
        <h3>Signed-in sessions</h3>
        <p className="muted small">Every browser signed in to this account. Sign out any you don&apos;t recognise.</p>
        <ul className="security-list">
          {data.sessions.map((s) => (
            <li key={s.id}>
              <div>
                <strong>{s.deviceLabel ?? 'Unknown device'}</strong>
                {s.current ? <span className="muted small"> · this device</span> : null}
                <div className="muted small">
                  Last active {when(s.lastSeenAt ?? s.createdAt)} · {s.persistent ? 'kept signed in' : 'ends when the browser closes'}
                </div>
              </div>
              {s.current ? null : (
                <button type="button" className="btn ghost" disabled={busyId === s.id} onClick={() => void act(s.id, () => api.auth.revokeSession(s.id))}>
                  Sign out
                </button>
              )}
            </li>
          ))}
        </ul>
        {others.length > 0 ? (
          <button type="button" className="btn danger" disabled={busyId === 'others'} onClick={() => void act('others', () => api.auth.revokeOtherSessions())}>
            Sign out all other sessions
          </button>
        ) : null}
      </section>

      <section className="panel">
        <h3>Recent sign-ins</h3>
        <p className="muted small">The last 10 sign-ins and passkey changes on this account. Device names are approximate.</p>
        {data.recentSignIns.length === 0 ? (
          <p className="muted">None recorded yet.</p>
        ) : (
          <ul className="security-list">
            {data.recentSignIns.map((e) => (
              <li key={e.id}>
                <div>
                  <strong>{authEventText(e.kind, e.method)}</strong>
                  <div className="muted small">
                    {when(e.createdAt)} · {e.deviceLabel ?? 'Unknown device'}
                  </div>
                </div>
              </li>
            ))}
          </ul>
        )}
      </section>

      {data.twoFactor.enabled || data.trustedDevices.length > 0 ? (
        <section className="panel">
          <h3>Trusted devices</h3>
          <p className="muted small">These browsers skip the two-factor code for 30 days. Removing one asks for a code next time.</p>
          {data.trustedDevices.length === 0 ? (
            <p className="muted">None. Tick “Trust this device” when you enter a code to add one.</p>
          ) : (
            <>
              <ul className="security-list">
                {data.trustedDevices.map((d) => (
                  <li key={d.id}>
                    <div>
                      <strong>{d.label ?? 'Unknown device'}</strong>
                      {d.current ? <span className="muted small"> · this browser</span> : null}
                      <div className="muted small">
                        Last used {when(d.lastUsedAt ?? d.createdAt)} · until {when(d.expiresAt)}
                      </div>
                    </div>
                    <button type="button" className="btn ghost" disabled={busyId === d.id} onClick={() => void act(d.id, () => api.auth.revokeTrustedDevice(d.id))}>
                      Remove
                    </button>
                  </li>
                ))}
              </ul>
              <button type="button" className="btn danger" disabled={busyId === 'trusted'} onClick={() => void act('trusted', () => api.auth.revokeAllTrustedDevices())}>
                Remove all trusted devices
              </button>
            </>
          )}
        </section>
      ) : null}
    </>
  );
}
