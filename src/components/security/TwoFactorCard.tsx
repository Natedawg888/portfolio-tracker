/**
 * Two-factor sign-in card: On/Off status, the method (authenticator app), backup codes left
 * with "Make new codes", and a quiet "Turn off two-factor" link behind a confirmation.
 * The server rules are unchanged: turning it on needs the password; turning it off and
 * making new codes need the password and a current code. Codes are shown once, never stored here.
 */
import { useEffect, useRef, useState, type FormEvent } from 'react';
import { ApiError, api, type AccountSecurity } from '../../api/client';
import { showQuietToast } from '../../lib/quietToast';
import { lowOnBackupCodes, plural, shortWhen } from '../../lib/securityView';
import { ConfirmInline } from './ConfirmInline';
import { MethodIcon } from './MethodIcon';

const toast = (message: string) => showQuietToast(message, { kind: 'info', ttlMs: 5000 });

function errorText(err: unknown, fallback: string): string {
  return err instanceof ApiError ? err.message : fallback;
}

function svgDataUrl(svg: string): string {
  let bin = '';
  for (const b of new TextEncoder().encode(svg)) bin += String.fromCharCode(b);
  return `data:image/svg+xml;base64,${btoa(bin)}`;
}

/** New codes, shown once. `replaced`: these replace an older set (which stops working now). */
function BackupCodes({ codes, replaced, onDone }: { codes: string[]; replaced: boolean; onDone: () => void }) {
  const [copied, setCopied] = useState(false);
  const headingRef = useRef<HTMLParagraphElement>(null);
  const text = `KoruLedger backup codes (each works once)\n\n${codes.join('\n')}\n`;

  useEffect(() => {
    headingRef.current?.focus();
  }, []);

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
    } catch {
      setCopied(false);
    }
  };
  const download = () => {
    const url = URL.createObjectURL(new Blob([text], { type: 'text/plain' }));
    const a = document.createElement('a');
    a.href = url;
    a.download = 'koruledger-backup-codes.txt';
    a.click();
    URL.revokeObjectURL(url);
  };

  return (
    <div className="security-codes">
      <p className="security-codes-title" ref={headingRef} tabIndex={-1}>
        Your new backup codes
      </p>
      <p className="security-codes-note">
        <strong>This is the only time they’re shown.</strong> Each one signs you in once if you lose your phone.
        {replaced ? ' Your old backup codes stopped working just now.' : ''}
      </p>
      <ul className="backup-codes" aria-label="Backup codes">
        {codes.map((c) => (
          <li key={c}>{c}</li>
        ))}
      </ul>
      <div className="row gap">
        <button type="button" className="btn small" onClick={() => void copy()} aria-label="Copy backup codes">
          {copied ? 'Copied' : 'Copy'}
        </button>
        <button type="button" className="btn small" onClick={download} aria-label="Download backup codes as a text file">
          Download
        </button>
        <button type="button" className="btn small primary" onClick={onDone}>
          I’ve saved them
        </button>
      </div>
      <p className="sr-only" role="status">
        {copied ? 'Backup codes copied.' : ''}
      </p>
    </div>
  );
}

type Setup = { secret: string; otpauthUri: string; qrSvg: string };
type Mode = 'idle' | 'setup-password' | 'setup-scan' | 'regen' | 'disable';

export function TwoFactorCard({ data, reload }: { data: AccountSecurity; reload: () => Promise<void> }) {
  const tf = data.twoFactor;
  const [mode, setMode] = useState<Mode>('idle');
  const [codes, setCodes] = useState<{ list: string[]; replaced: boolean } | null>(null);
  const [password, setPassword] = useState('');
  const [code, setCode] = useState('');
  const [setup, setSetup] = useState<Setup | null>(null);
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

  const onSetupPassword = (e: FormEvent) => {
    e.preventDefault();
    void run(async () => {
      setSetup(await api.auth.twoFactorSetup(password));
      setPassword('');
      setMode('setup-scan');
    }, 'Could not start setup');
  };

  const onEnable = (e: FormEvent) => {
    e.preventDefault();
    void run(async () => {
      const r = await api.auth.twoFactorEnable(code);
      reset();
      setCodes({ list: r.backupCodes, replaced: false });
      await reload();
    }, 'Could not turn on two-factor sign-in');
  };

  const trusted = data.trustedDevices.length;
  const low = tf.enabled && lowOnBackupCodes(tf.backupCodesRemaining);

  return (
    <section className="panel security-section" id="two-factor" aria-labelledby="two-factor-title">
      <div className="security-section-head">
        <h3 id="two-factor-title">Two-factor sign-in</h3>
        <span className={`security-status security-status--${tf.enabled ? 'on' : 'off'}`}>
          <span aria-hidden="true">{tf.enabled ? '✓ ' : ''}</span>
          {tf.enabled ? 'On' : 'Off'}
        </span>
      </div>
      <p className="security-lead">
        {tf.enabled
          ? 'When you sign in with your password, you also enter a code from your authenticator app, so a stolen password isn’t enough. Passkeys count as two-factor on their own.'
          : 'Ask for a code from an authenticator app when you sign in with your password, so a stolen password isn’t enough to open your finances.'}
      </p>

      {codes ? (
        <BackupCodes
          codes={codes.list}
          replaced={codes.replaced}
          onDone={() => {
            setCodes(null);
            toast('Backup codes saved.');
          }}
        />
      ) : tf.enabled ? (
        <>
          <ul className="security-rows">
            <li className="security-row">
              <MethodIcon kind="device" />
              <div className="security-row-main">
                <p className="security-row-name">Authenticator app</p>
                <p className="security-row-sub">Google Authenticator, 1Password, Authy or similar · on since {shortWhen(tf.enabledAt)}</p>
              </div>
            </li>
            <li className="security-row">
              <MethodIcon kind="shield" />
              <div className="security-row-main">
                <p className="security-row-name">{plural(tf.backupCodesRemaining, 'backup code')} left</p>
                <p className={low ? 'security-row-sub security-row-warn' : 'security-row-sub'}>
                  {low ? 'Running low. Make new codes so you can still get in if you lose your phone.' : 'Each one signs you in once without your phone.'}
                </p>
              </div>
              {mode !== 'regen' ? (
                <div className="security-row-actions">
                  <button type="button" id="make-new-codes" className="btn small" aria-label="Make new backup codes" onClick={() => { reset(); setMode('regen'); }}>
                    Make new codes
                  </button>
                </div>
              ) : (
                <div className="security-row-extra">
                  <ConfirmInline
                    title="Make new backup codes?"
                    returnFocusId="make-new-codes"
                    tone="primary"
                    confirmLabel="Make new codes"
                    confirmAriaLabel="Make new backup codes"
                    askPassword
                    askCode
                    busy={busy}
                    error={error}
                    onCancel={reset}
                    onConfirm={(pw, c) =>
                      void run(async () => {
                        const r = await api.auth.twoFactorBackupCodes({ password: pw ?? '', code: c ?? '' });
                        reset();
                        setCodes({ list: r.backupCodes, replaced: true });
                        await reload();
                      }, 'Could not make new backup codes')
                    }
                  >
                    <p>You’ll get {plural(10, 'new code')}. Your {plural(tf.backupCodesRemaining, 'current code')} stop working straight away.</p>
                  </ConfirmInline>
                </div>
              )}
            </li>
          </ul>

          <div className="security-section-foot">
            {mode !== 'disable' ? (
              <button type="button" id="turn-off-2fa" className="security-link-warn" onClick={() => { reset(); setMode('disable'); }}>
                Turn off two-factor
              </button>
            ) : (
              <ConfirmInline
                title="Turn off two-factor sign-in?"
                returnFocusId="turn-off-2fa"
                tone="warn"
                cancelLabel="Keep it on"
                confirmLabel="Turn off"
                confirmAriaLabel="Turn off two-factor sign-in"
                askPassword
                askCode
                focus="cancel"
                busy={busy}
                error={error}
                onCancel={reset}
                onConfirm={(pw, c) =>
                  void run(async () => {
                    await api.auth.twoFactorDisable({ password: pw ?? '', code: c ?? '' });
                    reset();
                    toast('Two-factor sign-in is off.');
                    await reload();
                  }, 'Could not turn off two-factor sign-in')
                }
              >
                <p>Your password alone would then open your financial data.</p>
                <p>
                  Your backup codes are deleted
                  {trusted > 0 ? `, and ${plural(trusted, 'trusted browser')} will no longer skip the code` : ''}. To turn it back on you’ll scan a
                  new QR code.
                </p>
              </ConfirmInline>
            )}
          </div>
        </>
      ) : !data.hasPassword ? (
        <p className="muted small">Set a password above first. Turning on two-factor sign-in asks for it.</p>
      ) : mode === 'idle' ? (
        <button type="button" className="btn primary" aria-label="Turn on two-factor sign-in" onClick={() => setMode('setup-password')}>
          Turn on
        </button>
      ) : mode === 'setup-password' ? (
        <form className="security-password-form" onSubmit={onSetupPassword} aria-label="Turn on two-factor sign-in">
          <label className="field">
            <span>Current password</span>
            <input type="password" value={password} onChange={(e) => setPassword(e.target.value)} autoComplete="current-password" required disabled={busy} autoFocus />
          </label>
          {error ? <p className="auth-error" role="alert">{error}</p> : null}
          <div className="row gap">
            <button type="submit" className="btn primary" disabled={busy || !password}>Continue</button>
            <button type="button" className="btn" onClick={reset} disabled={busy}>Cancel</button>
          </div>
        </form>
      ) : setup ? (
        <form className="security-password-form" onSubmit={onEnable} aria-label="Scan the QR code and enter a code">
          <p className="security-row-name">1. Scan this with your authenticator app</p>
          <img className="security-qr" src={svgDataUrl(setup.qrSvg)} alt="QR code for your authenticator app" />
          <p className="muted small">
            Can’t scan? Enter this key instead: <span className="security-secret">{setup.secret.replace(/(.{4})/g, '$1 ').trim()}</span>
          </p>
          <label className="field">
            <span>2. Enter the 6-digit code it shows</span>
            <input type="text" inputMode="numeric" autoComplete="one-time-code" maxLength={7} value={code} onChange={(e) => setCode(e.target.value)} required disabled={busy} autoFocus />
          </label>
          {error ? <p className="auth-error" role="alert">{error}</p> : null}
          <div className="row gap">
            <button type="submit" className="btn primary" disabled={busy || !code.trim()} aria-label="Turn on two-factor sign-in">Turn on</button>
            <button type="button" className="btn" onClick={reset} disabled={busy}>Cancel</button>
          </div>
        </form>
      ) : null}
    </section>
  );
}
