/**
 * Create KoruLedger's Stripe products and prices (KAN-52). Safe to run again: it only adds
 * what's missing, and moves a lookup key to a new price when an amount in
 * server/billing/catalog.ts changes (Stripe prices can't be edited).
 * Plus, Pro and Business each get a product and a monthly and yearly price.
 * Business gets a cancel-only Customer Portal configuration (no plan changes).
 * Plus and Pro get a restricted one: card, invoices, cancel at period end, and switches
 * among Plus prices (and Pro prices when PRO_PLAN_ENABLED is on). A second configuration
 * lets a current Pro subscriber switch Pro monthly and yearly while Pro sales are off.
 * Neither includes Business prices.
 *
 *   STRIPE_SECRET_KEY=sk_test_… npm run stripe:setup
 *   STRIPE_SECRET_KEY=sk_test_… npm run stripe:setup -- --gst   # also an inclusive 15% GST rate
 *
 * A live key is refused unless STRIPE_LIVE_ENABLED=1 (see server/billing/config.ts).
 * This script never sets that flag.
 */
import Stripe from 'stripe';
import { loadDotEnv } from '../server/akahu/loadEnv.ts';
import { BILLING_CURRENCY, CATALOG, PRODUCTS } from '../server/billing/catalog.ts';
import { billingConfig } from '../server/billing/config.ts';
import { proPlanEnabled } from '../server/billing/proPlan.ts';
import {
  BUSINESS_PORTAL_METADATA_KEY,
  findOrCreateBusinessCancelOnlyPortal,
  findOrCreatePersonalPortal,
  PERSONAL_PORTAL_METADATA_KEY,
  PERSONAL_PORTAL_METADATA_VALUE,
  PERSONAL_PORTAL_PRO_VALUE,
} from '../server/billing/portalConfig.ts';

loadDotEnv();
const cfg = billingConfig();
if (!cfg.ok) {
  const why = {
    not_configured: 'Set STRIPE_SECRET_KEY (a sk_test_… key) first.',
    bad_key: 'STRIPE_SECRET_KEY must start with sk_test_ or rk_test_.',
    live_not_enabled: 'That is a live key. Live billing stays off until STRIPE_LIVE_ENABLED=1 is set on purpose.',
  }[cfg.reason];
  console.error(why);
  process.exit(1);
}
const stripe = new Stripe(cfg.config.secretKey);
console.log(`Stripe ${cfg.config.live ? 'LIVE' : 'test'} mode`);

for (const [plan, product] of Object.entries(PRODUCTS)) {
  try {
    await stripe.products.retrieve(product.id);
    console.log(`product ${product.id}: exists`);
  } catch (err) {
    if ((err as { code?: string }).code !== 'resource_missing') throw err;
    await stripe.products.create({ id: product.id, name: product.name, metadata: { plan } });
    console.log(`product ${product.id}: created`);
  }
}

for (const c of CATALOG) {
  const found = (await stripe.prices.list({ lookup_keys: [c.lookupKey], limit: 1 })).data[0];
  const matches =
    found &&
    found.active &&
    found.unit_amount === c.amountCents &&
    found.currency === BILLING_CURRENCY &&
    found.recurring?.interval === c.interval &&
    found.product === PRODUCTS[c.plan].id;
  if (matches) {
    console.log(`price ${c.lookupKey}: exists (${found.id})`);
    continue;
  }
  const price = await stripe.prices.create({
    product: PRODUCTS[c.plan].id,
    currency: BILLING_CURRENCY,
    unit_amount: c.amountCents,
    recurring: { interval: c.interval },
    tax_behavior: 'inclusive',
    lookup_key: c.lookupKey,
    transfer_lookup_key: true,
    metadata: { plan: c.plan, interval: c.interval },
  });
  if (found) await stripe.prices.update(found.id, { active: false });
  console.log(`price ${c.lookupKey}: ${found ? 'replaced' : 'created'} (${price.id}, NZ$${(c.amountCents / 100).toFixed(2)}/${c.interval} incl. GST)`);
}

if (process.argv.includes('--gst')) {
  const rates = await stripe.taxRates.list({ active: true, limit: 100 });
  let rate = rates.data.find((r) => r.inclusive && r.percentage === 15 && r.country === 'NZ' && r.display_name === 'GST');
  if (!rate) {
    rate = await stripe.taxRates.create({ display_name: 'GST', percentage: 15, inclusive: true, country: 'NZ', jurisdiction: 'NZ', tax_type: 'gst' });
    console.log(`GST rate: created (${rate.id})`);
  } else {
    console.log(`GST rate: exists (${rate.id})`);
  }
  console.log(`\nSet STRIPE_GST_TAX_RATE_ID=${rate.id} to show GST on invoices.`);
}

const proOn = proPlanEnabled();
const personal = await findOrCreatePersonalPortal(stripe, { variant: 'standard', includePro: proOn });
console.log(
  `Personal portal (${proOn ? 'Plus and Pro' : 'Plus only'}): ${personal.created ? 'created' : personal.updated ? 'updated' : 'exists'} (${personal.id}, metadata ${PERSONAL_PORTAL_METADATA_KEY}=${PERSONAL_PORTAL_METADATA_VALUE})`,
);
const pinnedPersonal = process.env.STRIPE_PORTAL_CONFIG_PERSONAL?.trim();
if (pinnedPersonal && pinnedPersonal !== personal.id) {
  console.log(`STRIPE_PORTAL_CONFIG_PERSONAL=${pinnedPersonal} is set, so Plus and Pro portal sessions use that id.`);
} else if (!pinnedPersonal) {
  console.log(`Set STRIPE_PORTAL_CONFIG_PERSONAL=${personal.id} to pin it (Railway Alpha). Unset, sessions look it up by metadata and cache the id.`);
}
const proHolder = await findOrCreatePersonalPortal(stripe, { variant: 'pro_holder', includePro: true });
console.log(
  `Pro subscriber portal (monthly or yearly while Pro sales are off): ${proHolder.created ? 'created' : proHolder.updated ? 'updated' : 'exists'} (${proHolder.id}, metadata ${PERSONAL_PORTAL_METADATA_KEY}=${PERSONAL_PORTAL_PRO_VALUE})`,
);

const portal = await findOrCreateBusinessCancelOnlyPortal(stripe);
console.log(
  `Business portal (cancel only): ${portal.created ? 'created' : portal.updated ? 'updated' : 'exists'} (${portal.id}, metadata ${BUSINESS_PORTAL_METADATA_KEY})`,
);
const pinnedPortal = process.env.STRIPE_PORTAL_CONFIG_BUSINESS?.trim();
if (pinnedPortal && pinnedPortal !== portal.id) {
  console.log(`STRIPE_PORTAL_CONFIG_BUSINESS=${pinnedPortal} is set, so Business portal sessions use that id.`);
} else if (!pinnedPortal) {
  console.log(`Optional: set STRIPE_PORTAL_CONFIG_BUSINESS=${portal.id} to pin it. Unset, sessions look it up by metadata.`);
}

console.log('\nNext: point a webhook at <PUBLIC_URL>/api/billing/webhook (checkout.session.completed and');
console.log('customer.subscription.*), and set STRIPE_WEBHOOK_SECRET.');
console.log('Plus and Pro use the personal configuration above, not the dashboard default portal.');
console.log('Business subscriptions use the cancel-only configuration, including unpaid and incomplete ones.');
console.log('Re-run this after changing PRO_PLAN_ENABLED so the personal portal’s price list matches.');
