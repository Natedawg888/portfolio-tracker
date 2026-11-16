/**
 * Monthly / yearly switch and the plan cards shared by Settings → Plan and signup.
 * Prices come from GET /api/billing. Pro is omitted unless that response says it is for sale.
 */
import {
  BILLING_TEST_NOTE,
  FREE_FEATURES,
  PLAN_FEATURES,
  PLAN_LABELS,
  offeredPaidPlans,
  plusFeatureLines,
  priceFor,
  priceText,
  yearlySavingPct,
  type AccountPlan,
  type BillingInterval,
  type BillingPrice,
  type PaidPlan,
} from '../../lib/billingView';

export function BillingTestNote() {
  return (
    <p className="billing-test-note small" role="note">
      {BILLING_TEST_NOTE}
    </p>
  );
}

export function BillingPlanPicker({
  prices,
  proPlanEnabled,
  interval,
  onInterval,
  busy,
  currentPlan,
  paidEnabled = true,
  showFree = false,
  runsBusiness = false,
  onChooseFree,
  onChoosePaid,
}: {
  prices: readonly BillingPrice[];
  proPlanEnabled: boolean;
  interval: BillingInterval;
  onInterval: (interval: BillingInterval) => void;
  busy: string | null;
  /** The account's plan, so a paid card can say it is already included. */
  currentPlan?: AccountPlan | null;
  /** False when Stripe checkout is not configured. Free still works. */
  paidEnabled?: boolean;
  showFree?: boolean;
  /** Signup tick: Plus then lists clients, invoices and stock. */
  runsBusiness?: boolean;
  onChooseFree?: () => void;
  onChoosePaid: (plan: PaidPlan) => void;
}) {
  const paid = offeredPaidPlans(proPlanEnabled);

  return (
    <>
      <div className="billing-interval" role="group" aria-label="Billing period">
        {(['month', 'year'] as const).map((i) => (
          <button
            key={i}
            type="button"
            className={`billing-interval-btn${interval === i ? ' active' : ''}`}
            aria-pressed={interval === i}
            onClick={() => onInterval(i)}
          >
            {i === 'month' ? 'Monthly' : 'Yearly'}
          </button>
        ))}
      </div>
      <ul className="billing-plans">
        {showFree ? (
          <li className="billing-plan">
            <div className="billing-plan-head">
              <h3>{PLAN_LABELS.free}</h3>
              <p className="billing-plan-price">No charge</p>
            </div>
            <ul className="billing-plan-features">
              {FREE_FEATURES.map((f) => (
                <li key={f}>{f}</li>
              ))}
            </ul>
            <button type="button" className="btn small primary" disabled={busy != null} onClick={onChooseFree}>
              {busy === 'free' ? 'Saving…' : 'Continue with Free'}
            </button>
          </li>
        ) : null}
        {paid.map((plan) => {
          const price = priceFor(prices, plan, interval);
          const saving = interval === 'year' ? yearlySavingPct(prices, plan) : null;
          const included = currentPlan === plan || (currentPlan === 'pro' && plan === 'plus');
          const canBuy = paidEnabled && Boolean(price) && !included;
          return (
            <li key={plan} className={`billing-plan${currentPlan === plan ? ' current' : ''}`}>
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
                {(plan === 'plus' ? plusFeatureLines(runsBusiness) : PLAN_FEATURES[plan]).map((f) => (
                  <li key={f}>{f}</li>
                ))}
              </ul>
              <button
                type="button"
                className="btn small primary"
                disabled={busy != null || !canBuy}
                onClick={() => onChoosePaid(plan)}
              >
                {busy === plan ? 'Opening checkout…' : included ? 'Included in your plan' : `Choose ${PLAN_LABELS[plan]}`}
              </button>
            </li>
          );
        })}
      </ul>
      <p className="muted small">Payments are handled by Stripe. Cancel any time; your plan stays until the end of the period you paid for.</p>
    </>
  );
}
