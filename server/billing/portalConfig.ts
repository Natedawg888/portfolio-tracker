/**
 * Customer Portal configurations (KAN-52).
 *
 * Business is cancel-only: payment method, invoices, and cancel at period end. No plan changes.
 * Plus and Pro use a separate configuration that can switch only among Plus prices, plus Pro
 * prices when Pro is on sale. Business prices are never on that configuration. A Pro subscriber
 * can still switch Pro monthly and yearly while Pro sales are off; that session uses the
 * Pro-subscriber configuration (metadata koruledger_personal_portal=pro), not the Plus-only one.
 *
 * Configurations are found by metadata, or pinned with STRIPE_PORTAL_CONFIG_BUSINESS and
 * STRIPE_PORTAL_CONFIG_PERSONAL. `npm run stripe:setup` creates them. Portal sessions use the
 * pinned id when set, otherwise the id looked up once per process.
 */
import type Stripe from 'stripe';
import { catalogByLookupKey, PRODUCTS } from './catalog.ts';
import type { BillingPlan } from './catalog.ts';

export const BUSINESS_PORTAL_METADATA_KEY = 'koruledger_business_cancel_only';
export const BUSINESS_PORTAL_METADATA_VALUE = '1';
export const BUSINESS_PORTAL_CONFIG_NAME = 'KoruLedger Business (cancel only)';

export const PERSONAL_PORTAL_METADATA_KEY = 'koruledger_personal_portal';
export const PERSONAL_PORTAL_METADATA_VALUE = '1';
export const PERSONAL_PORTAL_PRO_VALUE = 'pro';

const PLUS_LOOKUP_KEYS = ['koruledger_plus_monthly', 'koruledger_plus_yearly'] as const;
const PRO_LOOKUP_KEYS = ['koruledger_pro_monthly', 'koruledger_pro_yearly'] as const;
const BUSINESS_LOOKUP_KEYS = ['koruledger_business_monthly', 'koruledger_business_yearly'] as const;

/**
 * Statuses the Customer Portal can still change. Canceled subscriptions are left out while any
 * other subscription is open, so an old Business subscription does not hide Plus management.
 * Unpaid, incomplete, and past_due stay in: those Business subscriptions must not get the default portal.
 */
export const PORTAL_OPEN_STATUSES = ['active', 'trialing', 'past_due', 'unpaid', 'incomplete', 'paused'] as const;

export type PersonalPortalVariant = 'standard' | 'pro_holder';

export type PortalConfigEnsureResult = { id: string; created: boolean; updated: boolean };

type PortalCache = {
  businessId: string | null;
  standardId: string | null;
  standardIncludesPro: boolean | null;
  proHolderId: string | null;
  businessPriceIds: Set<string> | null;
};

const cache: PortalCache = {
  businessId: null,
  standardId: null,
  standardIncludesPro: null,
  proHolderId: null,
  businessPriceIds: null,
};

/** Tests only. Portal sessions cache configuration ids for the life of the process. */
export function resetPortalConfigCacheForTests(): void {
  cache.businessId = null;
  cache.standardId = null;
  cache.standardIncludesPro = null;
  cache.proHolderId = null;
  cache.businessPriceIds = null;
}

export function businessCancelOnlyPortalFeatures(): Stripe.BillingPortal.ConfigurationCreateParams.Features {
  return {
    invoice_history: { enabled: true },
    payment_method_update: { enabled: true },
    subscription_cancel: { enabled: true, mode: 'at_period_end', proration_behavior: 'none' },
    subscription_update: { enabled: false },
  };
}

/** Plus prices, plus Pro prices when `includePro` (Pro is on sale, or this is the Pro-subscriber portal). */
export function personalPortalLookupKeys(variant: PersonalPortalVariant, includePro: boolean): string[] {
  const withPro = variant === 'pro_holder' || includePro;
  const keys = withPro ? [...PLUS_LOOKUP_KEYS, ...PRO_LOOKUP_KEYS] : [...PLUS_LOOKUP_KEYS];
  if (keys.some((key) => catalogByLookupKey(key)?.plan === 'business')) {
    throw new Error('Refusing to put a Business price on the personal portal');
  }
  return keys;
}

export function personalPortalFeatures(
  products: Stripe.BillingPortal.ConfigurationCreateParams.Features.SubscriptionUpdate.Product[],
): Stripe.BillingPortal.ConfigurationCreateParams.Features {
  return {
    invoice_history: { enabled: true },
    payment_method_update: { enabled: true },
    subscription_cancel: { enabled: true, mode: 'at_period_end', proration_behavior: 'none' },
    subscription_update: {
      enabled: true,
      default_allowed_updates: ['price'],
      proration_behavior: 'create_prorations',
      products,
    },
  };
}

export function personalPortalName(variant: PersonalPortalVariant, includePro: boolean): string {
  if (variant === 'pro_holder') return 'KoruLedger Pro (monthly or yearly)';
  return includePro ? 'KoruLedger Plus and Pro' : 'KoruLedger Plus';
}

function isCancelOnly(features: Stripe.BillingPortal.Configuration.Features | null | undefined): boolean {
  if (!features) return false;
  return (
    features.payment_method_update?.enabled === true &&
    features.subscription_cancel?.enabled === true &&
    features.subscription_update?.enabled === false
  );
}

function priceIdOf(price: unknown): string | null {
  if (typeof price === 'string') return price;
  if (price && typeof price === 'object' && 'id' in price && typeof (price as { id: unknown }).id === 'string') {
    return (price as { id: string }).id;
  }
  return null;
}

function productIdOf(product: unknown): string | null {
  if (typeof product === 'string') return product;
  if (product && typeof product === 'object' && 'id' in product && typeof (product as { id: unknown }).id === 'string') {
    return (product as { id: string }).id;
  }
  return null;
}

/** product id → price ids, from either a create payload or a Stripe configuration response. */
export function portalProductPriceIds(features: { subscription_update?: { products?: unknown } | null } | null | undefined): Map<string, Set<string>> {
  const map = new Map<string, Set<string>>();
  const products = features?.subscription_update?.products;
  if (!Array.isArray(products)) return map;
  for (const entry of products) {
    if (!entry || typeof entry !== 'object') continue;
    const productId = productIdOf((entry as { product?: unknown }).product);
    if (!productId) continue;
    const ids = new Set<string>();
    const prices = (entry as { prices?: unknown }).prices;
    if (Array.isArray(prices)) {
      for (const price of prices) {
        const id = priceIdOf(price);
        if (id) ids.add(id);
      }
    }
    map.set(productId, ids);
  }
  return map;
}

function samePriceSets(a: Map<string, Set<string>>, b: Map<string, Set<string>>): boolean {
  if (a.size !== b.size) return false;
  for (const [product, prices] of a) {
    const other = b.get(product);
    if (!other || other.size !== prices.size) return false;
    for (const id of prices) if (!other.has(id)) return false;
  }
  return true;
}

function personalFeaturesMatch(
  found: Stripe.BillingPortal.Configuration.Features | null | undefined,
  expected: Stripe.BillingPortal.ConfigurationCreateParams.Features,
): boolean {
  if (!found) return false;
  const cancel = found.subscription_cancel;
  return (
    found.invoice_history?.enabled === true &&
    found.payment_method_update?.enabled === true &&
    cancel?.enabled === true &&
    cancel.mode === 'at_period_end' &&
    found.subscription_update?.enabled === true &&
    samePriceSets(portalProductPriceIds(found), portalProductPriceIds(expected))
  );
}

async function findActivePortalConfiguration(
  stripe: Stripe,
  metadataKey: string,
  metadataValue: string,
): Promise<Stripe.BillingPortal.Configuration | null> {
  let startingAfter: string | undefined;
  for (let page = 0; page < 20; page++) {
    const listed = await stripe.billingPortal.configurations.list({
      limit: 100,
      ...(startingAfter ? { starting_after: startingAfter } : {}),
    });
    const found = listed.data.find((c) => c.active !== false && c.metadata?.[metadataKey] === metadataValue);
    if (found) return found;
    if (!listed.has_more || listed.data.length === 0) break;
    const last = listed.data[listed.data.length - 1]?.id;
    if (!last || last === startingAfter) break;
    startingAfter = last;
  }
  return null;
}

async function priceIdsByLookupKey(stripe: Stripe, keys: readonly string[]): Promise<Map<string, string>> {
  const listed = await stripe.prices.list({ lookup_keys: [...keys], active: true, limit: 100 });
  const map = new Map<string, string>();
  for (const price of listed.data) {
    if (price.lookup_key && price.id) map.set(price.lookup_key, price.id);
  }
  const missing = keys.filter((key) => !map.has(key));
  if (missing.length) throw new Error(`Missing Stripe price for ${missing.join(', ')}`);
  return map;
}

function productsForKeys(
  keys: readonly string[],
  priceIds: ReadonlyMap<string, string>,
): Stripe.BillingPortal.ConfigurationCreateParams.Features.SubscriptionUpdate.Product[] {
  const grouped = new Map<string, string[]>();
  for (const key of keys) {
    const entry = catalogByLookupKey(key);
    const priceId = priceIds.get(key);
    if (!entry || !priceId) throw new Error(`Missing Stripe price for ${key}`);
    if (entry.plan === 'business') throw new Error('Refusing to put a Business price on the personal portal');
    const productId = PRODUCTS[entry.plan].id;
    const list = grouped.get(productId) ?? [];
    list.push(priceId);
    grouped.set(productId, list);
  }
  return [...grouped.entries()].map(([product, prices]) => ({ product, prices }));
}

/**
 * The cancel-only portal configuration for this Stripe account. A matching active
 * configuration is reused; one whose plan-change switch is still on is updated in place.
 */
export async function findOrCreateBusinessCancelOnlyPortal(stripe: Stripe): Promise<PortalConfigEnsureResult> {
  const found = await findActivePortalConfiguration(stripe, BUSINESS_PORTAL_METADATA_KEY, BUSINESS_PORTAL_METADATA_VALUE);
  if (found) {
    if (isCancelOnly(found.features)) return { id: found.id, created: false, updated: false };
    await stripe.billingPortal.configurations.update(found.id, { features: businessCancelOnlyPortalFeatures() });
    return { id: found.id, created: false, updated: true };
  }
  const created = await stripe.billingPortal.configurations.create({
    name: BUSINESS_PORTAL_CONFIG_NAME,
    metadata: { [BUSINESS_PORTAL_METADATA_KEY]: BUSINESS_PORTAL_METADATA_VALUE },
    features: businessCancelOnlyPortalFeatures(),
  });
  return { id: created.id, created: true, updated: false };
}

/**
 * Plus/Pro portal. `standard` follows Pro sales (Plus only, or Plus and Pro). `pro_holder`
 * always includes Plus and Pro so a current Pro subscriber can switch interval or move to Plus,
 * and never includes Business. Re-running updates the price list in place.
 */
export async function findOrCreatePersonalPortal(
  stripe: Stripe,
  options: { variant: PersonalPortalVariant; includePro?: boolean },
): Promise<PortalConfigEnsureResult> {
  const includePro = options.includePro === true;
  const keys = personalPortalLookupKeys(options.variant, includePro);
  const products = productsForKeys(keys, await priceIdsByLookupKey(stripe, keys));
  const features = personalPortalFeatures(products);
  const name = personalPortalName(options.variant, includePro);
  const metadataValue = options.variant === 'pro_holder' ? PERSONAL_PORTAL_PRO_VALUE : PERSONAL_PORTAL_METADATA_VALUE;
  const found = await findActivePortalConfiguration(stripe, PERSONAL_PORTAL_METADATA_KEY, metadataValue);
  if (found) {
    if (personalFeaturesMatch(found.features, features)) return { id: found.id, created: false, updated: false };
    await stripe.billingPortal.configurations.update(found.id, { name, features });
    return { id: found.id, created: false, updated: true };
  }
  const created = await stripe.billingPortal.configurations.create({
    name,
    metadata: { [PERSONAL_PORTAL_METADATA_KEY]: metadataValue },
    features,
  });
  return { id: created.id, created: true, updated: false };
}

/** Pinned id when STRIPE_PORTAL_CONFIG_BUSINESS is set; otherwise lookup-or-create, then cache. */
export async function businessCancelOnlyPortalConfigId(stripe: Stripe, pinnedId: string | null): Promise<string> {
  if (pinnedId) return pinnedId;
  if (cache.businessId) return cache.businessId;
  const found = await findOrCreateBusinessCancelOnlyPortal(stripe);
  cache.businessId = found.id;
  return found.id;
}

/**
 * Portal configuration for a subscription that is not Business.
 * A pinned STRIPE_PORTAL_CONFIG_PERSONAL id is the standard configuration (Plus, plus Pro when
 * Pro is on sale). It is not used for a Pro subscriber while Pro sales are off: that session
 * needs Pro monthly and yearly, which the Plus-only pin does not have.
 */
export async function personalPortalConfigId(
  stripe: Stripe,
  pinnedId: string | null,
  options: { proEnabled: boolean; holdsPro: boolean },
): Promise<string> {
  if (!options.proEnabled && options.holdsPro) {
    if (cache.proHolderId) return cache.proHolderId;
    const found = await findOrCreatePersonalPortal(stripe, { variant: 'pro_holder', includePro: true });
    cache.proHolderId = found.id;
    return found.id;
  }
  if (pinnedId) return pinnedId;
  if (cache.standardId && cache.standardIncludesPro === options.proEnabled) return cache.standardId;
  const found = await findOrCreatePersonalPortal(stripe, { variant: 'standard', includePro: options.proEnabled });
  cache.standardId = found.id;
  cache.standardIncludesPro = options.proEnabled;
  return found.id;
}

/** Active Business price ids (lookup keys koruledger_business_monthly / _yearly), cached per process. */
export async function knownBusinessPriceIds(stripe: Stripe): Promise<ReadonlySet<string>> {
  if (cache.businessPriceIds) return cache.businessPriceIds;
  const listed = await stripe.prices.list({ lookup_keys: [...BUSINESS_LOOKUP_KEYS], limit: 10 });
  const ids = new Set<string>();
  for (const price of listed.data) if (price.id) ids.add(price.id);
  cache.businessPriceIds = ids;
  return ids;
}

export function priceIsBusiness(
  price: { id?: string | null; lookup_key?: string | null; metadata?: { plan?: string } | null },
  businessPriceIds: ReadonlySet<string>,
): boolean {
  if (catalogByLookupKey(price.lookup_key)?.plan === 'business') return true;
  if (price.metadata?.plan === 'business') return true;
  if (price.id && businessPriceIds.has(price.id)) return true;
  return false;
}

/** Open subscriptions when there are any; otherwise every row (a lone canceled Business sub still counts). */
export function rowsForPortal<T extends { status: string }>(rows: readonly T[]): T[] {
  const open = rows.filter((row) => (PORTAL_OPEN_STATUSES as readonly string[]).includes(row.status));
  return open.length > 0 ? open : [...rows];
}

export function portalHoldsPro(rows: readonly { plan: BillingPlan; status: string }[]): boolean {
  return rowsForPortal(rows).some((row) => row.plan === 'pro');
}
