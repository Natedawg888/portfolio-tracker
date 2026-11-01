/**
 * Stripe billing (KAN-52): the live-key guard, signed webhooks turning subscriptions into plans,
 * Checkout and the portal, and cancelling on account deletion. Stripe itself is faked; nothing
 * leaves the machine.
 * Run: npm run test:billing
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import type { AddressInfo } from 'node:net';
import type { Server } from 'node:http';
import express from 'express';
import Stripe from 'stripe';

const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'pt-billing-'));
process.env.DATABASE_PATH = path.join(dataDir, 'portfolio.db');
process.env.AUTH_ENCRYPTION_KEY = 'd'.repeat(64);
process.env.PUBLIC_URL = 'https://app.example.test/';
for (const k of ['STRIPE_SECRET_KEY', 'STRIPE_WEBHOOK_SECRET', 'STRIPE_LIVE_ENABLED', 'STRIPE_GST_TAX_RATE_ID', 'STRIPE_PORTAL_CONFIG_ID', 'PLAN_PLUS_EMAILS', 'PLAN_PRO_EMAILS', 'PLAN_BUSINESS_EMAILS']) {
  delete process.env[k];
}

function assert(cond: unknown, msg: string): void {
  if (!cond) throw new Error(`FAIL: ${msg}`);
}

const { getDb, run, queryOne } = await import('../db/index.ts');
const { planOf, hasFeature, setPlan } = await import('../lib/entitlements.ts');
const { billingConfig } = await import('./config.ts');
const { catalogByLookupKey, catalogPrice } = await import('./catalog.ts');
const { setStripeClientForTests } = await import('./client.ts');
const { createSession, SESSION_COOKIE } = await import('../auth/sessions.ts');
const { hashPassword } = await import('../auth/passwords.ts');
const { attachUser } = await import('../middleware/requireAuth.ts');
const { default: billingRouter, billingWebhook } = await import('../routes/billing.ts');
const { default: authRouter } = await import('../routes/auth.ts');

// --- Config: a live key never turns billing on by itself.
assert(billingConfig({}).ok === false, 'no key: off');
assert(!billingConfig({ STRIPE_SECRET_KEY: 'pk_test_1' }).ok, 'publishable key refused');
const liveOff = billingConfig({ STRIPE_SECRET_KEY: 'sk_live_1' });
assert(!liveOff.ok && liveOff.reason === 'live_not_enabled', 'live key without STRIPE_LIVE_ENABLED is refused');
assert(!billingConfig({ STRIPE_SECRET_KEY: 'rk_live_1', STRIPE_LIVE_ENABLED: 'true' }).ok, 'only STRIPE_LIVE_ENABLED=1 counts');
const liveOn = billingConfig({ STRIPE_SECRET_KEY: 'sk_live_1', STRIPE_LIVE_ENABLED: '1' });
assert(liveOn.ok && liveOn.config.live, 'live only with STRIPE_LIVE_ENABLED=1');
const testCfg = billingConfig({ STRIPE_SECRET_KEY: ' sk_test_1 ', STRIPE_WEBHOOK_SECRET: 'whsec_x' });
assert(testCfg.ok && !testCfg.config.live && testCfg.config.secretKey === 'sk_test_1', 'test key on, trimmed');

// --- Catalog: the prices in the ticket, GST included.
assert(catalogPrice('plus', 'month').amountCents === 999 && catalogPrice('plus', 'year').amountCents === 7999, 'Plus NZ$9.99 / $79.99');
assert(catalogPrice('pro', 'month').amountCents === 1999 && catalogPrice('pro', 'year').amountCents === 14999, 'Pro NZ$19.99 / $149.99');
assert(catalogByLookupKey('koruledger_pro_yearly')?.plan === 'pro' && catalogByLookupKey('other') === null, 'lookup keys');

// --- A fake Stripe: subscriptions live in a map the tests change.
type FakeSub = { id: string; customer: string; status: string; lookupKey: string; metadata: Record<string, string>; cancel_at_period_end?: boolean; livemode?: boolean };
const subs = new Map<string, FakeSub>();
const calls: { checkout: Record<string, unknown>[]; portal: Record<string, unknown>[]; cancelled: string[]; customers: number } = {
  checkout: [],
  portal: [],
  cancelled: [],
  customers: 0,
};
let failCancel = false;
const periodEnd = Math.floor(Date.parse('2026-12-02T00:00:00Z') / 1000);
const fake = {
  subscriptions: {
    retrieve: async (id: string) => {
      const s = subs.get(id);
      if (!s) throw Object.assign(new Error('No such subscription'), { code: 'resource_missing' });
      return {
        id: s.id,
        object: 'subscription',
        customer: s.customer,
        status: s.status,
        livemode: s.livemode ?? false,
        metadata: s.metadata,
        cancel_at_period_end: s.cancel_at_period_end ?? false,
        cancel_at: null,
        items: { data: [{ current_period_end: periodEnd, price: { id: `price_${s.lookupKey}`, lookup_key: s.lookupKey } }] },
      };
    },
    cancel: async (id: string) => {
      if (failCancel) throw new Error('Stripe is down');
      calls.cancelled.push(id);
      subs.get(id)!.status = 'canceled';
      return { id, status: 'canceled' };
    },
  },
  prices: {
    list: async ({ lookup_keys }: { lookup_keys: string[] }) => ({
      data: catalogByLookupKey(lookup_keys[0]) ? [{ id: `price_${lookup_keys[0]}` }] : [],
    }),
  },
  customers: {
    create: async () => ({ id: `cus_new${++calls.customers}` }),
  },
  checkout: {
    sessions: {
      create: async (params: Record<string, unknown>) => {
        calls.checkout.push(params);
        return { id: 'cs_1', url: 'https://checkout.stripe.test/cs_1' };
      },
    },
  },
  billingPortal: {
    sessions: {
      create: async (params: Record<string, unknown>) => {
        calls.portal.push(params);
        return { url: 'https://billing.stripe.test/p_1' };
      },
    },
  },
};
setStripeClientForTests(fake as unknown as Stripe);

const now = '2026-11-02T00:00:00.000Z';
const db = await getDb();
const pw = await hashPassword('correct horse battery');
for (const [id, email] of [
  ['una', 'una@example.com'],
  ['vic', 'vic@example.com'],
  ['wes', 'wes@example.com'],
]) {
  run(db, `INSERT INTO users (id, email, password_hash, first_name, created_at, updated_at) VALUES (?,?,?,?,?,?)`, [id, email, pw, 'X', now, now]);
}

const WHSEC = 'whsec_test_secret';
const app = express();
app.post('/api/billing/webhook', express.raw({ type: 'application/json' }), billingWebhook);
app.use(express.json());
app.use('/api', attachUser);
app.use('/api/billing', (req, res, next) => ((req as { user?: unknown }).user ? next() : res.status(401).json({})), billingRouter);
app.use('/api/auth', authRouter);

let server: Server | null = null;
try {
  server = await new Promise<Server>((resolve) => {
    const s = app.listen(0, '127.0.0.1', () => resolve(s));
  });
  const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  const cookie = async (id: string) => `${SESSION_COOKIE}=${(await createSession(id)).rawToken}`;
  const call = async (method: string, p: string, c: string | null, body?: unknown) => {
    const r = await fetch(`${base}${p}`, {
      method,
      headers: { 'Content-Type': 'application/json', ...(c ? { Cookie: c } : {}) },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    return { status: r.status, json: (await r.json().catch(() => ({}))) as Record<string, any> };
  };
  let evtN = 0;
  const webhook = async (type: string, object: Record<string, unknown>, opts: { livemode?: boolean; secret?: string; signature?: string } = {}) => {
    const payload = JSON.stringify({ id: `evt_${++evtN}`, object: 'event', type, livemode: opts.livemode ?? false, data: { object } });
    const sig = opts.signature ?? Stripe.webhooks.generateTestHeaderString({ payload, secret: opts.secret ?? WHSEC });
    const r = await fetch(`${base}/api/billing/webhook`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Stripe-Signature': sig },
      body: payload,
    });
    return r.status;
  };
  const una = await cookie('una');
  const vic = await cookie('vic');

  // Billing off: the page says so, checkout and the webhook refuse.
  let st = await call('GET', '/api/billing', una);
  assert(st.status === 200 && st.json.available === false && st.json.plan === 'free' && st.json.prices.length === 4, 'off: status shows prices, unavailable');
  assert((await call('POST', '/api/billing/checkout', una, { plan: 'plus', interval: 'month' })).json.code === 'BILLING_UNAVAILABLE', 'off: checkout refused');
  assert((await webhook('customer.subscription.updated', { id: 'sub_x' })) === 503, 'off: webhook 503');
  process.env.STRIPE_SECRET_KEY = 'sk_live_abc';
  assert((await call('GET', '/api/billing', una)).json.available === false, 'live key without the go flag stays off');
  assert((await call('POST', '/api/billing/checkout', una, { plan: 'plus', interval: 'month' })).status === 503, 'live key: no checkout');

  // Test mode on.
  process.env.STRIPE_SECRET_KEY = 'sk_test_abc';
  process.env.STRIPE_WEBHOOK_SECRET = WHSEC;
  st = await call('GET', '/api/billing', una);
  assert(st.json.available === true && st.json.mode === 'test' && st.json.canManage === false, 'test mode on');
  assert((await call('GET', '/api/billing', null)).status === 401, 'signed out 401');
  assert((await call('POST', '/api/billing/checkout', una, { plan: 'business', interval: 'month' })).json.code === 'BAD_PLAN', 'only Plus/Pro sold');
  assert((await call('POST', '/api/billing/portal', una)).json.code === 'NO_CUSTOMER', 'no portal before a customer');

  // Checkout: one customer per user, the price by lookup key, user id on the subscription.
  const co = await call('POST', '/api/billing/checkout', una, { plan: 'pro', interval: 'year' });
  assert(co.status === 200 && co.json.url === 'https://checkout.stripe.test/cs_1', 'checkout url');
  const params = calls.checkout[0] as any;
  assert(params.mode === 'subscription' && params.customer === 'cus_new1' && params.client_reference_id === 'una', 'checkout for una');
  assert(params.line_items[0].price === 'price_koruledger_pro_yearly' && !params.line_items[0].tax_rates, 'pro yearly price, no GST rate unless set');
  assert(params.subscription_data.metadata.user_id === 'una', 'subscription tagged with user');
  assert(params.success_url === 'https://app.example.test/settings?tab=account&billing=success', 'returns to settings on PUBLIC_URL');
  process.env.STRIPE_GST_TAX_RATE_ID = 'txr_gst';
  await call('POST', '/api/billing/checkout', una, { plan: 'pro', interval: 'year' });
  assert(calls.customers === 1 && (calls.checkout[1] as any).customer === 'cus_new1', 'customer reused');
  assert((calls.checkout[1] as any).line_items[0].tax_rates[0] === 'txr_gst', 'GST rate applied when set');
  assert(planOf(db, 'una') === 'free', 'no plan until Stripe says paid');

  // Webhook security: bad signature, wrong mode.
  subs.set('sub_una', { id: 'sub_una', customer: 'cus_new1', status: 'active', lookupKey: 'koruledger_pro_yearly', metadata: { user_id: 'una' } });
  assert((await webhook('customer.subscription.created', { id: 'sub_una' }, { secret: 'whsec_wrong' })) === 400, 'wrong secret 400');
  assert((await webhook('customer.subscription.created', { id: 'sub_una' }, { signature: 'nonsense' })) === 400, 'junk signature 400');
  assert((await webhook('customer.subscription.created', { id: 'sub_una' }, { livemode: true })) === 400, 'live event on test key 400');
  assert(planOf(db, 'una') === 'free', 'rejected events change nothing');

  // checkout.session.completed → fetch the subscription → Pro.
  assert(
    (await webhook('checkout.session.completed', { id: 'cs_1', mode: 'subscription', customer: 'cus_new1', client_reference_id: 'una', subscription: 'sub_una' })) === 200,
    'checkout completed 200',
  );
  assert(planOf(db, 'una') === 'pro' && hasFeature(db, 'una', 'crypto_pro'), 'paid: Pro with its features');
  st = await call('GET', '/api/billing', una);
  assert(st.json.plan === 'pro' && st.json.subscription.interval === 'year' && st.json.subscription.currentPeriodEnd === '2026-12-02T00:00:00.000Z' && st.json.canManage === true, 'status shows the subscription');
  assert((await call('POST', '/api/billing/checkout', una, { plan: 'plus', interval: 'month' })).json.code === 'ALREADY_SUBSCRIBED', 'no second subscription');

  // Portal.
  const portal = await call('POST', '/api/billing/portal', una);
  assert(portal.json.url === 'https://billing.stripe.test/p_1' && (calls.portal[0] as any).customer === 'cus_new1', 'portal for the customer');

  // A switch to Plus in the portal, then cancel at period end (keeps the plan), then failed payments.
  subs.get('sub_una')!.lookupKey = 'koruledger_plus_monthly';
  await webhook('customer.subscription.updated', { id: 'sub_una' });
  assert(planOf(db, 'una') === 'plus' && !hasFeature(db, 'una', 'crypto_pro') && hasFeature(db, 'una', 'household'), 'downgrade to Plus');
  subs.get('sub_una')!.cancel_at_period_end = true;
  await webhook('customer.subscription.updated', { id: 'sub_una' });
  assert(planOf(db, 'una') === 'plus' && (await call('GET', '/api/billing', una)).json.subscription.cancelAtPeriodEnd === true, 'cancelling keeps the plan to period end');
  subs.get('sub_una')!.status = 'past_due';
  await webhook('customer.subscription.updated', { id: 'sub_una' });
  assert(planOf(db, 'una') === 'plus', 'past_due keeps the plan while Stripe retries');
  subs.get('sub_una')!.status = 'unpaid';
  await webhook('customer.subscription.updated', { id: 'sub_una' });
  assert(planOf(db, 'una') === 'free', 'unpaid drops it');

  // Stale events can't roll back: the payload says active, Stripe says canceled.
  subs.get('sub_una')!.status = 'canceled';
  await webhook('customer.subscription.updated', { id: 'sub_una', status: 'active' });
  assert(planOf(db, 'una') === 'free', 'state comes from Stripe, not the event body');

  // An operator grant still counts, and the best plan wins.
  setPlan(db, 'una', 'business', 'test');
  assert(planOf(db, 'una') === 'business', 'operator Business grant');
  setPlan(db, 'una', 'free', 'test');

  // Unknown customer and unknown prices are ignored, not retried.
  subs.set('sub_ghost', { id: 'sub_ghost', customer: 'cus_ghost', status: 'active', lookupKey: 'koruledger_pro_monthly', metadata: {} });
  assert((await webhook('customer.subscription.created', { id: 'sub_ghost' })) === 200, 'unknown customer 200');
  subs.set('sub_odd', { id: 'sub_odd', customer: 'cus_new1', status: 'active', lookupKey: 'something_else', metadata: { user_id: 'una' } });
  await webhook('customer.subscription.created', { id: 'sub_odd' });
  assert(planOf(db, 'una') === 'free', 'a price we do not sell grants nothing');
  assert((await webhook('invoice.paid', { id: 'in_1' })) === 200, 'other events acknowledged');

  // Stripe unreachable → 500 so Stripe retries.
  assert((await webhook('customer.subscription.updated', { id: 'sub_missing' })) === 500, 'fetch failure 500');

  // Account deletion cancels the subscription first; if that fails, nothing is deleted.
  subs.set('sub_vic', { id: 'sub_vic', customer: 'cus_vic', status: 'active', lookupKey: 'koruledger_plus_yearly', metadata: { user_id: 'vic' } });
  await webhook('customer.subscription.created', { id: 'sub_vic' });
  assert(planOf(db, 'vic') === 'plus', 'vic on Plus via subscription metadata');
  failCancel = true;
  let del = await call('POST', '/api/auth/delete-account', vic, { password: 'correct horse battery', confirm: 'DELETE' });
  assert(del.status === 502 && del.json.code === 'SUBSCRIPTION_CANCEL_FAILED', 'cancel failure blocks deletion');
  assert(queryOne(db, `SELECT id FROM users WHERE id = 'vic'`) != null, 'vic still exists');
  failCancel = false;
  delete process.env.STRIPE_SECRET_KEY;
  del = await call('POST', '/api/auth/delete-account', vic, { password: 'correct horse battery', confirm: 'DELETE' });
  assert(del.status === 503 && del.json.code === 'SUBSCRIPTION_ACTIVE', 'billing off with an active subscription blocks deletion');
  process.env.STRIPE_SECRET_KEY = 'sk_test_abc';
  del = await call('POST', '/api/auth/delete-account', vic, { password: 'correct horse battery', confirm: 'DELETE' });
  assert(del.status === 200 && del.json.deleted.subscriptionsCancelled === 1 && calls.cancelled.includes('sub_vic'), 'deletion cancels the subscription');
  assert(queryOne(db, `SELECT 1 AS x FROM billing_subscriptions WHERE user_id = 'vic'`) == null && queryOne(db, `SELECT 1 AS x FROM billing_customers WHERE user_id = 'vic'`) == null, 'billing rows removed');

  // No subscription: deletion is unaffected even with billing off.
  delete process.env.STRIPE_SECRET_KEY;
  del = await call('POST', '/api/auth/delete-account', await cookie('wes'), { password: 'correct horse battery', confirm: 'DELETE' });
  assert(del.status === 200 && del.json.deleted.subscriptionsCancelled === 0, 'deleting a free account needs no Stripe');

  console.log('billing: ok');
} finally {
  setStripeClientForTests(null);
  if (server) await new Promise<void>((resolve) => server!.close(() => resolve()));
  fs.rmSync(dataDir, { recursive: true, force: true });
}
