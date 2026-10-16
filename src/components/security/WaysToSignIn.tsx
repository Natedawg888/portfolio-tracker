/**
 * "Ways to sign in": the password, each connected provider (Google / Apple / Microsoft) and
 * each passkey in one list. Removing the last way to sign in is never offered (the server
 * refuses it too), and removing or disconnecting asks for the password without a recent sign-in.
 */
import { useEffect, useRef, useState, type FormEvent } from 'react';
import { ApiError, api, type AccountSecurity } from '../../api/client';
import { useAuth } from '../../auth/AuthContext';
import { addPasskey, hintName, passkeysSupported, readHint, wasCancelled, writeHint } from '../../lib/passkeys';
import { showQuietToast } from '../../lib/quietToast';
import { canDisconnectIdentity, canRemovePasskey, needsReauth, providerIconKind, shortWhen } from '../../lib/securityView';
import { ssoStartUrl } from '../../lib/sso';
import { ConfirmInline } from './ConfirmInline';
import { MethodIcon } from './MethodIcon';
import { PasswordForm } from './PasswordForm';

const toast = (message: string) => showQuietToast(message, { kind: 'info', ttlMs: 5000 });

function errorText(err: unknown, fallback: string): string {
  return err instanceof ApiError ? err.message : fallback;
}

type Confirming = { kind: 'passkey' | 'identity'; id: string };

export function WaysToSignIn({
  data,
  reload,
  passwordOpen,
  setPasswordOpen,
}: {
  data: AccountSecurity;
  reload: () => Promise<void>;
  /** The password form is open (Account → "Change in Security", or after securing the account). */
  passwordOpen: boolean;
  setPasswordOpen: (open: boolean) => void;
}) {
  const { user } = useAuth();
  const [supported] = useState(passkeysSupported);
  const [confirming, setConfirming] = useState<Confirming | null>(null);
  const [forcePassword, setForcePassword] = useState(false);
  const [renaming, setRenaming] = useState<{ id: string; name: string } | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [rowError, setRowError] = useState<string | null>(null);
  const [addPassword, setAddPassword] = useState<string | null>(null);
  const passwordRowRef = useRef<HTMLLIElement>(null);

  useEffect(() => {
    if (passwordOpen) passwordRowRef.current?.scrollIntoView({ block: 'center' });
  }, [passwordOpen]);

  const reauth = forcePassword || needsReauth(data);
  const askPassword = reauth && data.hasPassword;
  const passwordNote = reauth && !data.hasPassword ? 'For your security, sign out and back in, then do this within 15 minutes.' : null;

  const startConfirm = (c: Confirming) => {
    setConfirming(c);
    setForcePassword(false);
    setRowError(null);
    setRenaming(null);
  };

  const confirmed = async (fn: () => Promise<string>) => {
    if (!confirming) return;
    setBusy(confirming.id);
    setRowError(null);
    try {
      const message = await fn();
      setConfirming(null);
      toast(message);
      await reload();
    } catch (err) {
      if (err instanceof ApiError && err.code === 'REAUTH_REQUIRED') {
        setForcePassword(true);
        setRowError(askPassword ? 'That password isn’t right.' : data.hasPassword ? 'Confirm your password to continue.' : null);
      } else {
        setRowError(errorText(err, 'That didn’t work. Try again.'));
      }
    } finally {
      setBusy(null);
    }
  };

  async function add(e?: FormEvent) {
    e?.preventDefault();
    setBusy('add');
    setError(null);
    try {
      await addPasskey({ password: addPassword ?? undefined });
      if (user) writeHint({ email: user.email, name: hintName(user) });
      setAddPassword(null);
      toast('Passkey added. You can sign in on this device with one tap.');
      await reload();
    } catch (err) {
      if (err instanceof ApiError && err.code === 'REAUTH_REQUIRED') {
        if (data.hasPassword) {
          if (addPassword) setError('That password isn’t right.');
          setAddPassword(addPassword ?? '');
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
      const saved = await api.auth.renamePasskey(renaming.id, renaming.name);
      setRenaming(null);
      toast(`Renamed to ${saved.name}.`);
      await reload();
    } catch (err) {
      setError(errorText(err, 'Couldn’t rename that passkey.'));
    } finally {
      setBusy(null);
    }
  }

  const linked = new Set(data.identities.map((i) => i.provider));
  const connectable = data.ssoProviders.filter((p) => !linked.has(p.id));
  const removable = canRemovePasskey(data);
  const disconnectable = canDisconnectIdentity(data);

  return (
    <section className="panel security-section" id="ways-to-sign-in" aria-labelledby="ways-to-sign-in-title">
      <h3 id="ways-to-sign-in-title">Ways to sign in</h3>
      {error ? (
        <p className="auth-error" role="alert">
          {error}
        </p>
      ) : null}
      <ul className="security-rows">
        <li className="security-row" ref={passwordRowRef} id="password">
          <MethodIcon kind="password" />
          <div className="security-row-main">
            <p className="security-row-name">Password</p>
            <p className="security-row-sub">
              {data.hasPassword
                ? data.passwordLastUsedAt
                  ? `Last used ${shortWhen(data.passwordLastUsedAt)}`
                  : 'Set · not used to sign in recently'
                : 'Not set. You sign in with a connected account or passkey.'}
            </p>
          </div>
          {!passwordOpen ? (
            <div className="security-row-actions">
              <button type="button" className="btn small" aria-label={data.hasPassword ? 'Change password' : 'Set a password'} onClick={() => setPasswordOpen(true)}>
                {data.hasPassword ? 'Change' : 'Set a password'}
              </button>
            </div>
          ) : null}
          {passwordOpen && !data.hasPassword && needsReauth(data) ? (
            <div className="security-row-extra">
              <p className="security-confirm-note">For your security, sign out and back in, then set your password within 15 minutes.</p>
              <button type="button" className="btn small" onClick={() => setPasswordOpen(false)}>
                Close
              </button>
            </div>
          ) : passwordOpen ? (
            <div className="security-row-extra">
              <PasswordForm
                hasPassword={data.hasPassword}
                onCancel={() => setPasswordOpen(false)}
                onDone={(message) => {
                  setPasswordOpen(false);
                  toast(message);
                  void reload();
                }}
              />
            </div>
          ) : null}
        </li>

        {data.identities.map((i) => {
          const name = i.email ? `${i.label} (${i.email})` : i.label;
          return (
            <li key={i.id} className="security-row">
              <MethodIcon kind={providerIconKind(i.provider)} />
              <div className="security-row-main">
                <p className="security-row-name">{i.label}</p>
                <p className="security-row-sub">
                  {i.email ? <span className="security-row-email">{i.email}</span> : null}
                  {i.email ? ' · ' : ''}
                  {i.lastUsedAt ? `Last used ${shortWhen(i.lastUsedAt)}` : `Connected ${shortWhen(i.createdAt)}`}
                </p>
                {!disconnectable ? <p className="security-row-sub">Set a password before disconnecting {i.label}, so you can still sign in.</p> : null}
              </div>
              {disconnectable ? (
                <div className="security-row-actions">
                  <button
                    type="button"
                    className="btn small"
                    aria-label={`Disconnect ${name}`}
                    disabled={busy != null}
                    onClick={() => startConfirm({ kind: 'identity', id: i.id })}
                  >
                    Disconnect
                  </button>
                </div>
              ) : null}
              {confirming?.kind === 'identity' && confirming.id === i.id ? (
                <div className="security-row-extra">
                  <ConfirmInline
                    key={String(askPassword)}
                    title={`Disconnect ${i.label}?`}
                    confirmLabel={`Disconnect ${i.label}`}
                    cancelLabel="Keep it connected"
                    askPassword={askPassword}
                    passwordNote={passwordNote}
                    busy={busy === i.id}
                    error={rowError}
                    onCancel={() => setConfirming(null)}
                    onConfirm={(password) =>
                      void confirmed(async () => {
                        await api.auth.disconnectIdentity(i.id, password);
                        return `${i.label} disconnected.`;
                      })
                    }
                  >
                    <p>You won’t be able to sign in with {name} any more. You can connect it again later.</p>
                  </ConfirmInline>
                </div>
              ) : null}
            </li>
          );
        })}

        {data.passkeys.map((p) => (
          <li key={p.id} className="security-row">
            <MethodIcon kind="passkey" />
            {renaming?.id === p.id ? (
              <form
                className="security-rename"
                onSubmit={(e) => void saveName(e)}
                onKeyDown={(e) => {
                  if (e.key === 'Escape') setRenaming(null);
                }}
              >
                <label className="field">
                  <span>Name for this passkey</span>
                  <input value={renaming.name} maxLength={60} autoFocus onChange={(e) => setRenaming({ id: p.id, name: e.target.value })} />
                </label>
                <div className="row gap">
                  <button type="submit" className="btn small primary" disabled={busy === p.id || !renaming.name.trim()} aria-label={`Save new name for ${p.name}`}>
                    Save
                  </button>
                  <button type="button" className="btn small" onClick={() => setRenaming(null)} aria-label={`Cancel renaming ${p.name}`}>
                    Cancel
                  </button>
                </div>
              </form>
            ) : (
              <>
                <div className="security-row-main">
                  <p className="security-row-name">
                    {p.name}
                    {p.backedUp ? <span className="security-chip">Synced</span> : null}
                  </p>
                  <p className="security-row-sub">Passkey · Face ID, fingerprint or device PIN</p>
                  <p className="security-row-sub">
                    Added {shortWhen(p.createdAt)} · {p.lastUsedAt ? `last used ${shortWhen(p.lastUsedAt)}` : 'not used yet'}
                  </p>
                  {!removable ? <p className="security-row-sub">This is your only way to sign in. Add a password or another passkey before removing it.</p> : null}
                </div>
                <div className="security-row-actions">
                  <button type="button" className="btn small" aria-label={`Rename ${p.name}`} disabled={busy != null} onClick={() => setRenaming({ id: p.id, name: p.name })}>
                    Rename
                  </button>
                  {removable ? (
                    <button type="button" className="btn small danger" aria-label={`Remove ${p.name}`} disabled={busy != null} onClick={() => startConfirm({ kind: 'passkey', id: p.id })}>
                      Remove
                    </button>
                  ) : null}
                </div>
              </>
            )}
            {confirming?.kind === 'passkey' && confirming.id === p.id ? (
              <div className="security-row-extra">
                <ConfirmInline
                  key={String(askPassword)}
                  title={`Remove ${p.name}?`}
                  confirmLabel={`Remove ${p.name}`}
                  cancelLabel="Keep it"
                  askPassword={askPassword}
                  passwordNote={passwordNote}
                  busy={busy === p.id}
                  error={rowError}
                  onCancel={() => setConfirming(null)}
                  onConfirm={(password) =>
                    void confirmed(async () => {
                      const r = await api.auth.removePasskey(p.id, password);
                      // The hint on this browser may point at the removed passkey.
                      if (data.passkeys.length <= 1 && readHint()?.email === user?.email) writeHint(null);
                      return r.sessionsEnded > 0
                        ? `${p.name} removed. ${r.sessionsEnded} signed-in browser${r.sessionsEnded === 1 ? '' : 's'} signed out.`
                        : `${p.name} removed.`;
                    })
                  }
                >
                  <p>It can’t be used to sign in any more. Browsers that signed in with it, other than this one, are signed out.</p>
                </ConfirmInline>
              </div>
            ) : null}
          </li>
        ))}
      </ul>

      <div className="security-section-foot">
        {!supported ? (
          <p className="muted small">This browser can’t create passkeys. Try a recent version of Chrome, Edge, Safari or Firefox.</p>
        ) : addPassword != null ? (
          <form className="passkey-reauth" onSubmit={(e) => void add(e)}>
            <label>
              Confirm your password to add a passkey
              <input type="password" autoComplete="current-password" value={addPassword} autoFocus onChange={(e) => setAddPassword(e.target.value)} />
            </label>
            <div className="row gap">
              <button type="submit" className="btn primary" disabled={busy === 'add' || !addPassword}>
                {busy === 'add' ? 'Waiting for your device…' : 'Continue'}
              </button>
              <button type="button" className="btn" onClick={() => setAddPassword(null)}>
                Cancel
              </button>
            </div>
          </form>
        ) : (
          <button type="button" className="btn" disabled={busy === 'add'} onClick={() => void add()}>
            {busy === 'add' ? 'Waiting for your device…' : '+ Add a passkey on this device'}
          </button>
        )}
        {connectable.map((p) => (
          <a key={p.id} className={`btn ghost sso-btn sso-btn--${p.id}`} href={ssoStartUrl(p.id, { mode: 'link' })}>
            Connect {p.label}
          </a>
        ))}
      </div>
    </section>
  );
}
