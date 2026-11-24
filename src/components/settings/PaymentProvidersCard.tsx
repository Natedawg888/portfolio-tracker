/**
 * Settings → Business: connect Stripe or Paddle so invoices can be paid online and marked paid
 * automatically (KAN-73). Test mode: Stripe follows the server's test key, Paddle takes sandbox keys.
 */
import { useCallback, useEffect, useState } from 'react';
import { api } from '../../api/client';
import type { PaymentIntegrations } from '../../types';

export function PaymentProvidersCard() {
  const [info, setInfo] = useState<PaymentIntegrations | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [msg, setMsg] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [apiKey, setApiKey] = useState('');
  const [secret, setSecret] = useState('');

  const load = useCallback(() => {
    api.integrations
      .status()
      .then(setInfo)
      .catch((e: unknown) => setError(e instanceof Error ? e.message : 'Could not load.'));
  }, []);
  useEffect(() => {
    load();
    const p = new URLSearchParams(window.location.search).get('payments');
    if (p === 'stripe_connected') setMsg('Stripe connected.');
    if (p === 'stripe_error') setError('Stripe wasn’t connected. Try again.');
  }, [load]);

  const act = async (fn: () => Promise<unknown>, done: string) => {
    setBusy(true);
    setError(null);
    setMsg(null);
    try {
      await fn();
      setMsg(done);
      load();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'That didn’t work.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <section className="panel" aria-labelledby="pay-providers-title">
      <h3 id="pay-providers-title">Online payments for invoices</h3>
      <p className="muted small">Connect Stripe or Paddle to put a pay-online link on invoices. When a client pays, the invoice is marked paid and the income recorded for you. Test mode for now.</p>
      {error ? <p className="auth-error" role="alert">{error}</p> : null}
      {msg ? <p className="banner" role="status">{msg}</p> : null}
      {!info && !error ? <p className="muted">Loading…</p> : null}
      {info ? (
        <>
          <div className="settings-row">
            <strong>Stripe</strong>{' '}
            {info.stripe.connected ? (
              <>
                <span className="muted small">Connected ({info.stripe.accountId}{info.stripe.mode === 'test' ? ', test mode' : ''})</span>{' '}
                <button type="button" className="btn small ghost" disabled={busy} onClick={() => void act(() => api.integrations.disconnect('stripe'), 'Stripe disconnected.')}>
                  Disconnect
                </button>
              </>
            ) : info.stripe.available ? (
              <button type="button" className="btn small primary" disabled={busy} onClick={() => void api.integrations.stripeConnectUrl().then((r) => window.location.assign(r.url)).catch((e: unknown) => setError(e instanceof Error ? e.message : 'Could not start.'))}>
                Connect Stripe
              </button>
            ) : (
              <span className="muted small">Not available on this server yet.</span>
            )}
          </div>
          <div className="settings-row">
            <strong>Paddle</strong>{' '}
            {info.paddle.connected ? (
              <>
                <span className="muted small">Connected (sandbox)</span>{' '}
                <button type="button" className="btn small ghost" disabled={busy} onClick={() => void act(() => api.integrations.disconnect('paddle'), 'Paddle disconnected.')}>
                  Disconnect
                </button>
                {info.paddle.webhookUrl ? (
                  <p className="muted small">
                    In Paddle → Developer tools → Notifications, send transaction events to <code>{info.paddle.webhookUrl}</code>.
                  </p>
                ) : null}
              </>
            ) : (
              <div className="form-grid">
                <label>
                  Sandbox API key
                  <input type="password" autoComplete="off" placeholder="pdl_sdbx_…" value={apiKey} onChange={(e) => setApiKey(e.target.value)} />
                </label>
                <label>
                  Notification secret
                  <input type="password" autoComplete="off" value={secret} onChange={(e) => setSecret(e.target.value)} />
                </label>
                <button
                  type="button"
                  className="btn small primary"
                  disabled={busy || !apiKey || !secret}
                  onClick={() =>
                    void act(async () => {
                      await api.integrations.connectPaddle(apiKey, secret);
                      setApiKey('');
                      setSecret('');
                    }, 'Paddle connected.')
                  }
                >
                  Connect Paddle
                </button>
              </div>
            )}
          </div>
        </>
      ) : null}
    </section>
  );
}
