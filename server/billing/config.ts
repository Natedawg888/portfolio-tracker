/**
 * Stripe settings (KAN-52), read from the environment on every call.
 *
 *   STRIPE_SECRET_KEY          sk_test_… (or a restricted rk_test_… key). Unset = billing off.
 *   STRIPE_WEBHOOK_SECRET      whsec_… for POST /api/billing/webhook.
 *   STRIPE_GST_TAX_RATE_ID     optional txr_…: an inclusive 15% GST rate, so Stripe invoices
 *                              show the GST in the price. Totals are the same either way.
 *   STRIPE_PORTAL_CONFIG_ID    legacy. Portal sessions do not use this. Plus and Pro use
 *                              STRIPE_PORTAL_CONFIG_PERSONAL; Business uses
 *                              STRIPE_PORTAL_CONFIG_BUSINESS.
 *   STRIPE_PORTAL_CONFIG_BUSINESS
 *                              optional bpc_… for Business subscriptions: cancel and card
 *                              update only, no plan change. Unset: look up or create the
 *                              configuration tagged koruledger_business_cancel_only
 *                              (npm run stripe:setup creates it) and cache that id.
 *   STRIPE_PORTAL_CONFIG_PERSONAL
 *                              optional bpc_… for Plus and Pro: card, invoices, cancel at
 *                              period end, and price switches among Plus (and Pro, when
 *                              PRO_PLAN_ENABLED is on). Unset: look up the configuration
 *                              tagged koruledger_personal_portal=1 and cache that id.
 *                              A Pro subscriber while Pro sales are off uses the
 *                              koruledger_personal_portal=pro configuration instead, so
 *                              they can still switch Pro monthly and yearly.
 *   STRIPE_LIVE_ENABLED=1      required before a live key (sk_live_/rk_live_) is used. Without
 *                              it a live key is refused and billing stays off: nobody is charged
 *                              real money until Nathan says go.
 */
export type BillingConfig = {
  secretKey: string;
  webhookSecret: string | null;
  live: boolean;
  gstTaxRateId: string | null;
  portalConfigId: string | null;
  portalBusinessConfigId: string | null;
  portalPersonalConfigId: string | null;
};

export type BillingConfigResult =
  | { ok: true; config: BillingConfig }
  | { ok: false; reason: 'not_configured' | 'live_not_enabled' | 'bad_key' };

function val(env: NodeJS.ProcessEnv, name: string): string | null {
  const v = env[name]?.trim();
  return v ? v : null;
}

export function billingConfig(env: NodeJS.ProcessEnv = process.env): BillingConfigResult {
  const secretKey = val(env, 'STRIPE_SECRET_KEY');
  if (!secretKey) return { ok: false, reason: 'not_configured' };
  const live = /^(sk|rk)_live_/.test(secretKey);
  if (!live && !/^(sk|rk)_test_/.test(secretKey)) return { ok: false, reason: 'bad_key' };
  if (live && val(env, 'STRIPE_LIVE_ENABLED') !== '1') return { ok: false, reason: 'live_not_enabled' };
  return {
    ok: true,
    config: {
      secretKey,
      webhookSecret: val(env, 'STRIPE_WEBHOOK_SECRET'),
      live,
      gstTaxRateId: val(env, 'STRIPE_GST_TAX_RATE_ID'),
      portalConfigId: val(env, 'STRIPE_PORTAL_CONFIG_ID'),
      portalBusinessConfigId: val(env, 'STRIPE_PORTAL_CONFIG_BUSINESS'),
      portalPersonalConfigId: val(env, 'STRIPE_PORTAL_CONFIG_PERSONAL'),
    },
  };
}
