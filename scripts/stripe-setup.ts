/**
 * Create KoruLedger's Stripe products and prices (KAN-52). Safe to run again: it only adds
 * what's missing, and moves a lookup key to a new price when an amount in
 * server/billing/catalog.ts changes (Stripe prices can't be edited).
 *
 *   STRIPE_SECRET_KEY=sk_test_… npm run stripe:setup
 *   STRIPE_SECRET_KEY=sk_test_… npm run stripe:setup -- --gst   # also an inclusive 15% GST rate
 *
 * A live key is refused unless STRIPE_LIVE_ENABLED=1 (see server/billing/config.ts).
 */
import Stripe from 'stripe';
import { loadDotEnv } from '../server/akahu/loadEnv.ts';
import { BILLING_CURRENCY, CATALOG, PRODUCTS } from '../server/billing/catalog.ts';
import { billingConfig } from '../server/billing/config.ts';

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

console.log('\nNext: point a webhook at <PUBLIC_URL>/api/billing/webhook (checkout.session.completed and');
console.log('customer.subscription.*), set STRIPE_WEBHOOK_SECRET, and save the Customer Portal settings');
console.log('once in the Stripe dashboard (Settings → Billing → Customer portal).');
