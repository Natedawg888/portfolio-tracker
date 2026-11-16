/**
 * Cancel-only Customer Portal configuration for a Business subscription.
 *
 * Business cannot change plan in the portal (subscription updates are off). Cancelling and
 * updating the card stay on. The configuration is looked up by metadata
 * `koruledger_business_cancel_only=1`, or pinned with STRIPE_PORTAL_CONFIG_BUSINESS.
 * `npm run stripe:setup` creates it in whichever Stripe account the key belongs to.
 */
import type Stripe from 'stripe';

export const BUSINESS_PORTAL_METADATA_KEY = 'koruledger_business_cancel_only';
export const BUSINESS_PORTAL_METADATA_VALUE = '1';
export const BUSINESS_PORTAL_CONFIG_NAME = 'KoruLedger Business (cancel only)';

export function businessCancelOnlyPortalFeatures(): Stripe.BillingPortal.ConfigurationCreateParams.Features {
  return {
    invoice_history: { enabled: true },
    payment_method_update: { enabled: true },
    subscription_cancel: { enabled: true, mode: 'at_period_end', proration_behavior: 'none' },
    subscription_update: { enabled: false },
  };
}

function isCancelOnly(features: Stripe.BillingPortal.Configuration.Features | null | undefined): boolean {
  if (!features) return false;
  return (
    features.payment_method_update?.enabled === true &&
    features.subscription_cancel?.enabled === true &&
    features.subscription_update?.enabled === false
  );
}

export type PortalConfigEnsureResult = { id: string; created: boolean; updated: boolean };

/**
 * The cancel-only portal configuration for this Stripe account. A matching active
 * configuration is reused; one whose plan-change switch is still on is updated in place.
 */
export async function findOrCreateBusinessCancelOnlyPortal(stripe: Stripe): Promise<PortalConfigEnsureResult> {
  let startingAfter: string | undefined;
  for (let page = 0; page < 20; page++) {
    const listed = await stripe.billingPortal.configurations.list({
      limit: 100,
      ...(startingAfter ? { starting_after: startingAfter } : {}),
    });
    const found = listed.data.find(
      (c) => c.active !== false && c.metadata?.[BUSINESS_PORTAL_METADATA_KEY] === BUSINESS_PORTAL_METADATA_VALUE,
    );
    if (found) {
      if (isCancelOnly(found.features)) return { id: found.id, created: false, updated: false };
      await stripe.billingPortal.configurations.update(found.id, { features: businessCancelOnlyPortalFeatures() });
      return { id: found.id, created: false, updated: true };
    }
    if (!listed.has_more || listed.data.length === 0) break;
    const last = listed.data[listed.data.length - 1]?.id;
    if (!last || last === startingAfter) break;
    startingAfter = last;
  }
  const created = await stripe.billingPortal.configurations.create({
    name: BUSINESS_PORTAL_CONFIG_NAME,
    metadata: { [BUSINESS_PORTAL_METADATA_KEY]: BUSINESS_PORTAL_METADATA_VALUE },
    features: businessCancelOnlyPortalFeatures(),
  });
  return { id: created.id, created: true, updated: false };
}

/** Pinned id when STRIPE_PORTAL_CONFIG_BUSINESS is set; otherwise lookup-or-create. */
export async function businessCancelOnlyPortalConfigId(stripe: Stripe, pinnedId: string | null): Promise<string> {
  if (pinnedId) return pinnedId;
  const found = await findOrCreateBusinessCancelOnlyPortal(stripe);
  return found.id;
}
