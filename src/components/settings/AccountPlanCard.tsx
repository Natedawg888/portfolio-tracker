/**
 * Settings → Account → Plan (KAN-52): the account's plan, and Plus or Pro through Stripe.
 * Checkout and plan changes happen on Stripe's own pages; the plan here follows Stripe's
 * webhook, so after checkout it can take a few seconds to show.
 */
import { useCallback, useEffect, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { ApiError, api, type BillingStatus } from '../../api/client';
import { showQuietToast } from '../../lib/quietToast';
import {
  PLAN_FEATURES,
  PLAN_LABELS,
  priceFor,
  priceText,
  subscriptionLine,
  yearlySavingPct,
  type BillingInterval,
  type PaidPlan,
} from '../../lib/billingView';

const PAID: PaidPlan[] = ['plus', 'pro'];

export function AccountPlanCard() {
  const [searchParams, setSearchParams] = useSearchParams();
  const [status, setStatus] = useState<BillingStatus | null>(null);
  const [interval, setBillingInterval] = useState<BillingInterval>('month');
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      setStatus(await api.billing.status());
    } catch {
      setStatus(null);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  // Back from Stripe Checkout: say so, and check again while the webhook lands.
  useEffect(() => {
    const flag = searchParams.get('billing');
    if (!flag) return;
    const next = new URLSearchParams(searchParams);
    next.delete('billing');
    setSearchParams(next, { replace: true });
    if (flag !== 'success') return;
    showQuietToast('Thanks! Your plan will update in a moment.');
    const timers = [2000, 6000].map((ms) => window.setTimeout(() => void load(), ms));
    return () => timers.forEach((t) => window.clearTimeout(t));
  }, [searchParams, setSearchParams, load]);

  async function go(key: string, open: () => Promise<{ url: string }>) {
    setBusy(key);
    setError(null);
    try {
      const { url } = await open();
      window.location.assign(url);
    } catch (e) {
      setError(e instanceof ApiError ? e.message : 'Couldn’t reach billing. Try again in a minute.');
      setBusy(null);
    }
  }

  if (!status) return null;
  const sub = status.subscription;

  return (
    <section className="panel account-card" aria-labelledby="account-plan-title">
      <div className="account-card-head">
        <h2 id="account-plan-title">Plan</h2>
        <p className="muted small">
          You’re on <strong>{PLAN_LABELS[status.plan]}</strong>.{' '}
          {sub ? subscriptionLine(sub) : null}
        </p>
      </div>

      {status.mode === 'test' ? (
        <p className="billing-test-note small" role="note">
          Test mode: no real charges. Use Stripe’s test card 4242 4242 4242 4242.
        </p>
      ) : null}

      {!status.available ? (
        <p className="muted small">Paid plans aren’t open yet.</p>
      ) : sub || status.canManage ? (
        <div className="account-actions billing-manage">
          <button type="button" className="btn small" disabled={busy != null} onClick={() => void go('portal', api.billing.portal)}>
            {busy === 'portal' ? 'Opening…' : 'Manage billing'}
          </button>
          <span className="muted small">Change plan, update your card, see receipts or cancel.</span>
        </div>
      ) : null}

      {status.available && !sub ? (
        <>
          <div className="billing-interval" role="group" aria-label="Billing period">
            {(['month', 'year'] as const).map((i) => (
              <button
                key={i}
                type="button"
                className={`billing-interval-btn${interval === i ? ' active' : ''}`}
                aria-pressed={interval === i}
                onClick={() => setBillingInterval(i)}
              >
                {i === 'month' ? 'Monthly' : 'Yearly'}
              </button>
            ))}
          </div>
          <ul className="billing-plans">
            {PAID.map((plan) => {
              const price = priceFor(status.prices, plan, interval);
              const saving = interval === 'year' ? yearlySavingPct(status.prices, plan) : null;
              const current = status.plan === plan || (status.plan === 'pro' && plan === 'plus');
              return (
                <li key={plan} className={`billing-plan${status.plan === plan ? ' current' : ''}`}>
                  <div className="billing-plan-head">
                    <h3>{PLAN_LABELS[plan]}</h3>
                    {price ? (
                      <p className="billing-plan-price">
                        {priceText(price)}
                        {saving ? <span className="billing-saving"> · save {saving}%</span> : null}
                      </p>
                    ) : null}
                    <p className="muted small">Includes GST.</p>
                  </div>
                  <ul className="billing-plan-features">
                    {PLAN_FEATURES[plan].map((f) => (
                      <li key={f}>{f}</li>
                    ))}
                  </ul>
                  <button
                    type="button"
                    className="btn small primary"
                    disabled={busy != null || current || !price}
                    onClick={() => void go(plan, () => api.billing.checkout(plan, interval))}
                  >
                    {busy === plan ? 'Opening checkout…' : current ? 'Included in your plan' : `Choose ${PLAN_LABELS[plan]}`}
                  </button>
                </li>
              );
            })}
          </ul>
          <p className="muted small">Payments are handled by Stripe. Cancel any time; your plan stays until the end of the period you paid for.</p>
        </>
      ) : null}

      {error ? (
        <p className="auth-error" role="alert">
          {error}
        </p>
      ) : null}
    </section>
  );
}
