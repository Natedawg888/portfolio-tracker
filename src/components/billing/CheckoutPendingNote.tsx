/**
 * After Stripe Checkout succeeds, the plan follows the webhook a few seconds later.
 */
import { useEffect, useState } from 'react';
import { api } from '../../api/client';
import { checkoutPendingText, type AccountPlan } from '../../lib/billingView';

export function CheckoutPendingNote({ active }: { active: boolean }) {
  const [plan, setPlan] = useState<AccountPlan | null>(null);

  useEffect(() => {
    if (!active) return;
    let cancelled = false;
    const load = () => {
      api.billing
        .status()
        .then((s) => {
          if (!cancelled) setPlan(s.plan);
        })
        .catch(() => {});
    };
    load();
    const timers = [2000, 6000].map((ms) => window.setTimeout(load, ms));
    return () => {
      cancelled = true;
      timers.forEach((t) => window.clearTimeout(t));
    };
  }, [active]);

  if (!active) return null;
  return (
    <p className="billing-pending-note billing-test-note small" role="status">
      {checkoutPendingText(plan)}
    </p>
  );
}
