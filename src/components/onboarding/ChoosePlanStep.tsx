/**
 * Signup → Choose your plan. Free continues. Plus and Business open Stripe Checkout.
 * Pro is listed only when it is on sale (PRO_PLAN_FOR_SALE) and GET /api/billing says
 * proPlanEnabled. Prices are that response, not a second copy of the catalog.
 */
import { useCallback, useEffect, useState } from 'react';
import { api, type BillingStatus } from '../../api/client';
import { BillingPlanPicker, BillingTestNote } from '../billing/BillingPlanPicker';
import { canCheckoutPlan, type BillingInterval, type PaidPlan } from '../../lib/billingView';

export function ChoosePlanStep({
  busy,
  onFree,
  onSkip,
  onPaid,
}: {
  /** 'free', 'skip', or a paid plan id while that action is in flight. */
  busy: string | null;
  onFree: (runsBusiness: boolean) => void;
  onSkip: (runsBusiness: boolean) => void;
  onPaid: (plan: PaidPlan, interval: BillingInterval, runsBusiness: boolean) => void;
}) {
  const [status, setStatus] = useState<BillingStatus | null>(null);
  const [failed, setFailed] = useState(false);
  const [interval, setInterval] = useState<BillingInterval>('month');
  const [runsBusiness, setRunsBusiness] = useState(false);

  const load = useCallback(async () => {
    try {
      setStatus(await api.billing.status());
      setFailed(false);
    } catch {
      setStatus(null);
      setFailed(true);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  return (
    <>
      <h2>Choose your plan</h2>
      <p className="page-lead">
        Prices are in NZD and include GST. You can change this any time in Settings. Free is enough to start, and skipping leaves you on Free.
      </p>
      <label className="runs-business-tick">
        <input type="checkbox" checked={runsBusiness} disabled={busy != null} onChange={(e) => setRunsBusiness(e.target.checked)} />
        <span>
          <strong>I run a business</strong>
          <span className="muted small">Clients, invoices and stock need Plus or Business. Profit and loss, GST and the accountant export are on Business.</span>
        </span>
      </label>
      {runsBusiness ? (
        <p className="billing-test-note small" role="note">
          On Free, business management waits until you choose Plus or Business. Ticking this and choosing Plus, Pro or Business opens a business for you.
        </p>
      ) : null}
      {status?.mode === 'test' ? <BillingTestNote /> : null}
      {failed ? (
        <p className="auth-error" role="alert">
          Couldn’t load prices. You can continue on Free and choose a plan later in Settings.
        </p>
      ) : null}
      {!status && !failed ? <p className="muted">Loading plans…</p> : null}
      {status && !status.available ? <p className="muted small">Paid plans aren’t open yet.</p> : null}
      {status ? (
        <BillingPlanPicker
          prices={status.prices}
          proPlanEnabled={status.proPlanEnabled === true}
          interval={interval}
          onInterval={setInterval}
          busy={busy}
          paidEnabled={status.available}
          showFree
          runsBusiness={runsBusiness}
          onChooseFree={() => onFree(runsBusiness)}
          onChoosePaid={(plan) => {
            if (!canCheckoutPlan(plan)) return;
            onPaid(plan, interval, runsBusiness);
          }}
        />
      ) : failed ? (
        <div className="onboarding-plan-actions">
          <button type="button" className="btn primary" disabled={busy != null} onClick={() => onFree(runsBusiness)}>
            {busy === 'free' ? 'Saving…' : 'Continue with Free'}
          </button>
        </div>
      ) : null}
      <div className="onboarding-plan-actions">
        <button type="button" className="btn ghost" disabled={busy != null} onClick={() => onSkip(runsBusiness)}>
          {busy === 'skip' ? 'Saving…' : 'Skip / decide later'}
        </button>
      </div>
    </>
  );
}
