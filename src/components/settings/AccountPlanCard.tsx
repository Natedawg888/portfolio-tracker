/**
 * Settings → Account → Plan (KAN-52): the account's plan, and Plus or Business through Stripe.
 * Pro is listed only when the server has PRO_PLAN_ENABLED set. Checkout and plan changes happen
 * on Stripe's own pages; the plan here follows Stripe's webhook, so after checkout it can take
 * a few seconds to show. An existing Pro grant or subscription still shows as Pro.
 */
import { useCallback, useEffect, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { ApiError, api, type BillingStatus } from '../../api/client';
import { showQuietToast } from '../../lib/quietToast';
import { PLAN_LABELS, subscriptionLine, type BillingInterval } from '../../lib/billingView';
import { BillingPlanPicker, BillingTestNote } from '../billing/BillingPlanPicker';

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

      {status.mode === 'test' ? <BillingTestNote /> : null}

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
        <BillingPlanPicker
          prices={status.prices}
          proPlanEnabled={status.proPlanEnabled === true}
          interval={interval}
          onInterval={setBillingInterval}
          busy={busy}
          currentPlan={status.plan}
          onChoosePaid={(plan) => void go(plan, () => api.billing.checkout(plan, interval))}
        />
      ) : null}

      {error ? (
        <p className="auth-error" role="alert">
          {error}
        </p>
      ) : null}
    </section>
  );
}
