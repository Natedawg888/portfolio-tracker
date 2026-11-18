/**
 * Settings → Account → Plan (KAN-52): the account's plan, and a change of plan through Stripe.
 * What is offered follows the usage saved at signup. Personal does not see Business.
 * Pro stays hidden until PRO_PLAN_FOR_SALE, and is never sent to checkout before that.
 * A Business plan cannot change plan: cancel only, through the billing portal.
 * Checkout and plan changes happen on Stripe's own pages; the plan here follows Stripe's
 * webhook, so after checkout it can take a few seconds to show. An existing Pro grant or
 * subscription still shows as Pro.
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import { useLocation, useNavigate, useSearchParams } from 'react-router-dom';
import { ApiError, api, type BillingStatus } from '../../api/client';
import { useAuth } from '../../auth/AuthContext';
import { showQuietToast } from '../../lib/quietToast';
import {
  PLAN_LABELS,
  PRO_PLAN_FOR_SALE,
  settingsCheckoutPlan,
  settingsPlanOffer,
  subscriptionLine,
  type BillingInterval,
} from '../../lib/billingView';
import type { UsageMode } from '../../lib/usageMode';
import {
  ACCOUNT_PLAN_SECTION_ID,
  BUSINESS_ACCOUNT_HREF,
  businessPlanNeededCopy,
  personalChoosingBusiness,
  routesPersonalToBusinessAccount,
} from '../../lib/accountLinksView';
import { BillingPlanPicker, BillingTestNote } from '../billing/BillingPlanPicker';
import { BusinessPlanNeededLine } from '../business/BusinessPlanNote';

export function AccountPlanCard() {
  const { user } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const planRef = useRef<HTMLElement>(null);
  const [searchParams, setSearchParams] = useSearchParams();
  const [status, setStatus] = useState<BillingStatus | null>(null);
  const [interval, setBillingInterval] = useState<BillingInterval>('month');
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [planNeeded, setPlanNeeded] = useState(false);

  const openBusinessAccount = useCallback(() => {
    setError(null);
    setPlanNeeded(false);
    navigate(BUSINESS_ACCOUNT_HREF);
  }, [navigate]);

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

  // The section is absent until billing status loads, so the browser's hash scroll misses it.
  useEffect(() => {
    if (!status || location.hash !== `#${ACCOUNT_PLAN_SECTION_ID}`) return;
    planRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }, [status, location.hash]);

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
      if (e instanceof ApiError && routesPersonalToBusinessAccount(e.code)) {
        openBusinessAccount();
        setBusy(null);
        return;
      }
      if (e instanceof ApiError && businessPlanNeededCopy(e.code)) {
        setError(null);
        setPlanNeeded(true);
        setBusy(null);
        return;
      }
      setPlanNeeded(false);
      setError(e instanceof ApiError ? e.message : 'Couldn’t reach billing. Try again in a minute.');
      setBusy(null);
    }
  }

  if (!status) return null;
  const sub = status.subscription;
  const usage: UsageMode = user?.usageMode ?? 'personal';
  const proForSale = PRO_PLAN_FOR_SALE && status.proPlanEnabled === true;
  const offer = settingsPlanOffer({
    usage,
    plan: status.plan,
    canChoosePlan: status.available && !sub,
    canOpenPortal: status.available && Boolean(sub || status.canManage),
    proForSale,
  });

  return (
    <section ref={planRef} id={ACCOUNT_PLAN_SECTION_ID} className="panel account-card" aria-labelledby="account-plan-title">
      <div className="account-card-head">
        <h2 id="account-plan-title">Plan</h2>
        <p className="muted small">
          You’re on <strong>{PLAN_LABELS[status.plan]}</strong>.{' '}
          {sub ? subscriptionLine(sub) : null}
        </p>
      </div>

      {status.mode === 'test' ? <BillingTestNote /> : null}

      {status.plan !== 'business' && !status.available ? (
        <p className="muted small">Paid plans aren’t open yet.</p>
      ) : null}

      {offer.portalAction === 'manage' ? (
        <div className="account-actions billing-manage">
          <button type="button" className="btn small" disabled={busy != null} onClick={() => void go('portal', api.billing.portal)}>
            {busy === 'portal' ? 'Opening…' : 'Manage billing'}
          </button>
          <span className="muted small">Change plan, update your card, see receipts or cancel.</span>
        </div>
      ) : null}

      {offer.portalAction === 'cancel' ? (
        <div className="account-actions billing-manage">
          <button type="button" className="btn small" disabled={busy != null} onClick={() => void go('cancel', api.billing.portal)}>
            {busy === 'cancel' ? 'Opening…' : 'Cancel subscription'}
          </button>
          <span className="muted small">Cancel any time; your plan stays until the end of the period you paid for.</span>
        </div>
      ) : null}

      {offer.showIntervalToggle ? (
        <BillingPlanPicker
          prices={status.prices}
          proPlanEnabled={proForSale}
          paidPlans={offer.cards}
          plusLines={offer.plusLines}
          interval={interval}
          onInterval={setBillingInterval}
          busy={busy}
          currentPlan={status.plan}
          onChoosePaid={(plan) => {
            if (personalChoosingBusiness(usage, plan)) {
              openBusinessAccount();
              return;
            }
            const allowed = settingsCheckoutPlan(plan, usage, proForSale);
            if (!allowed) return;
            void go(allowed, () => api.billing.checkout(allowed, interval));
          }}
        />
      ) : null}

      {planNeeded ? <BusinessPlanNeededLine /> : null}
      {error ? (
        <p className="auth-error" role="alert">
          {error}
        </p>
      ) : null}
    </section>
  );
}
