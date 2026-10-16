/**
 * "Was this you?" for a recent sign-in from a device the account hadn't used before.
 * "Yes" marks it reviewed. "No" (after a confirmation) signs out every other browser, stops
 * trusting every device, and opens the password change.
 */
import { useState } from 'react';
import { ApiError, api, type AccountSecurity, type AuthEvent } from '../../api/client';
import { showQuietToast } from '../../lib/quietToast';
import { eventMethodShort, plural, shortWhen } from '../../lib/securityView';
import { ConfirmInline } from './ConfirmInline';

const toast = (message: string) => showQuietToast(message, { kind: 'info', ttlMs: 6000 });

export function NewSignInCard({
  event,
  data,
  reload,
  onSecured,
}: {
  event: AuthEvent;
  data: AccountSecurity;
  reload: () => Promise<void>;
  /** After securing: open the password form. */
  onSecured: () => void;
}) {
  const [confirming, setConfirming] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const method = eventMethodShort(event, data.ssoProviders);
  const device = event.deviceLabel ?? 'an unknown device';
  const others = data.sessions.filter((s) => !s.current).length;

  const run = async (fn: () => Promise<void>) => {
    setBusy(true);
    setError(null);
    try {
      await fn();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'That didn’t work. Try again.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <section className="card security-alert" aria-labelledby={`new-sign-in-${event.id}`}>
      <h3 id={`new-sign-in-${event.id}`}>Was this you?</h3>
      <p>
        Someone signed in with <strong>{method}</strong> on <strong>{device}</strong> on {shortWhen(event.createdAt)}. This device hadn’t signed in to
        your account before{event.signedIn ? ', and it’s still signed in' : ''}.
      </p>
      {event.method === 'passkey' ? (
        <p className="muted small">
          Passkeys saved to Google Password Manager or iCloud Keychain can sign in from your other phones and computers too.
        </p>
      ) : null}
      {error && !confirming ? (
        <p className="auth-error" role="alert">
          {error}
        </p>
      ) : null}
      {!confirming ? (
        <div className="row gap">
          <button
            type="button"
            className="btn primary"
            disabled={busy}
            aria-label={`Yes, it was me signing in on ${device}`}
            onClick={() =>
              void run(async () => {
                await api.auth.markSignInReviewed(event.id);
                toast('Thanks. That sign-in is marked as you.');
                await reload();
              })
            }
          >
            Yes, it was me
          </button>
          <button type="button" id={`secure-${event.id}`} className="btn danger" disabled={busy} onClick={() => setConfirming(true)}>
            No, secure my account
          </button>
        </div>
      ) : (
        <ConfirmInline
          title="Secure your account?"
          returnFocusId={`secure-${event.id}`}
          cancelLabel="Cancel"
          confirmLabel={data.hasPassword ? 'Sign out others and change password' : 'Sign out everywhere else'}
          busy={busy}
          error={error}
          onCancel={() => setConfirming(false)}
          onConfirm={() =>
            void run(async () => {
              const r = await api.auth.secureAccount();
              toast(
                `Signed out ${plural(r.signedOut, 'other browser')}${r.untrusted ? ` and stopped trusting ${plural(r.untrusted, 'device')}` : ''}.${data.hasPassword ? ' Now change your password.' : ''}`,
              );
              await reload();
              onSecured();
            })
          }
        >
          <p>
            Every other browser is signed out{others > 0 ? ` (${plural(others, 'sign-in')})` : ''}, and every trusted device will ask for a two-factor
            code again.
            {data.hasPassword
              ? ' Then you’ll change your password, so whoever signed in can’t use it again.'
              : ' Then check your ways to sign in and remove any passkey or account you don’t recognise.'}
          </p>
        </ConfirmInline>
      )}
    </section>
  );
}
