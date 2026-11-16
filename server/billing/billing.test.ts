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
for (const k of ['STRIPE_SECRET_KEY', 'STRIPE_WEBHOOK_SECRET', 'STRIPE_LIVE_ENABLED', 'STRIPE_GST_TAX_RATE_ID', 'STRIPE_PORTAL_CONFIG_ID', 'STRIPE_PORTAL_CONFIG_BUSINESS', 'STRIPE_PORTAL_CONFIG_PERSONAL', 'PLAN_PLUS_EMAILS', 'PLAN_PRO_EMAILS', 'PLAN_BUSINESS_EMAILS', 'PRO_PLAN_ENABLED']) {
  delete process.env[k];
}

function assert(cond: unknown, msg: string): void {
  if (!cond) throw new Error(`FAIL: ${msg}`);
}

const { getDb, run, queryOne } = await import('../db/index.ts');
const { planOf, hasFeature, setPlan } = await import('../lib/entitlements.ts');
const { billingConfig } = await import('./config.ts');
const { catalogByLookupKey, catalogPrice } = await import('./catalog.ts');
const { proPlanEnabled } = await import('./proPlan.ts');
const { catalogForSubscription } = await import('./service.ts');
const { BUSINESS_ACCOUNT_CHECKOUT_ERROR, PRO_CHECKOUT_ERROR, businessCheckoutBlock, priceChangeDecision, proCheckoutBlock } = await import('./planGuards.ts');
const {
  BUSINESS_PORTAL_METADATA_KEY,
  BUSINESS_PORTAL_METADATA_VALUE,
  findOrCreateBusinessCancelOnlyPortal,
  findOrCreatePersonalPortal,
  PERSONAL_PORTAL_METADATA_KEY,
  PERSONAL_PORTAL_METADATA_VALUE,
  PERSONAL_PORTAL_PRO_VALUE,
  personalPortalLookupKeys,
  portalProductPriceIds,
  priceIsBusiness,
  resetPortalConfigCacheForTests,
} = await import('./portalConfig.ts');
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
const pinnedPortal = billingConfig({ STRIPE_SECRET_KEY: 'sk_test_1', STRIPE_PORTAL_CONFIG_BUSINESS: ' bpc_biz ' });
assert(pinnedPortal.ok && pinnedPortal.config.portalBusinessConfigId === 'bpc_biz' && pinnedPortal.config.portalConfigId === null && pinnedPortal.config.portalPersonalConfigId === null && !pinnedPortal.config.live, 'business portal id is trimmed and does not enable live');
const pinnedPersonal = billingConfig({ STRIPE_SECRET_KEY: 'sk_test_1', STRIPE_PORTAL_CONFIG_PERSONAL: ' bpc_per ' });
assert(pinnedPersonal.ok && pinnedPersonal.config.portalPersonalConfigId === 'bpc_per' && !pinnedPersonal.config.live, 'personal portal id is trimmed and does not enable live');
assert(!billingConfig({ STRIPE_SECRET_KEY: 'sk_live_1', STRIPE_PORTAL_CONFIG_BUSINESS: 'bpc_biz' }).ok, 'a portal id does not turn a live key on');
assert(!billingConfig({ STRIPE_SECRET_KEY: 'sk_live_1', STRIPE_PORTAL_CONFIG_PERSONAL: 'bpc_per' }).ok, 'a personal portal id does not turn a live key on');

// --- Catalog: the prices in the ticket, GST included.
assert(catalogPrice('plus', 'month').amountCents === 999 && catalogPrice('plus', 'year').amountCents === 7999, 'Plus NZ$9.99 / $79.99');
assert(catalogPrice('pro', 'month').amountCents === 1999 && catalogPrice('pro', 'year').amountCents === 14999, 'Pro NZ$19.99 / $149.99');
assert(catalogPrice('business', 'month').amountCents === 2999 && catalogPrice('business', 'year').amountCents === 24999, 'Business NZ$29.99 / $249.99');
assert(catalogPrice('business', 'month').lookupKey === 'koruledger_business_monthly' && catalogPrice('business', 'year').lookupKey === 'koruledger_business_yearly', 'Business lookup keys');
assert(catalogByLookupKey('koruledger_pro_yearly')?.plan === 'pro' && catalogByLookupKey('koruledger_business_yearly')?.plan === 'business' && catalogByLookupKey('other') === null, 'lookup keys');
assert(proPlanEnabled({}) === false && proPlanEnabled({ PRO_PLAN_ENABLED: '' }) === false && proPlanEnabled({ PRO_PLAN_ENABLED: '0' }) === false, 'Pro sales default off');
assert(proPlanEnabled({ PRO_PLAN_ENABLED: 'false' }) === false && proPlanEnabled({ PRO_PLAN_ENABLED: 'no' }) === false && proPlanEnabled({ PRO_PLAN_ENABLED: 'off' }) === false && proPlanEnabled({ PRO_PLAN_ENABLED: ' 2 ' }) === false, 'only the on-values enable Pro');
assert(proPlanEnabled({ PRO_PLAN_ENABLED: '1' }) && proPlanEnabled({ PRO_PLAN_ENABLED: ' true ' }) && proPlanEnabled({ PRO_PLAN_ENABLED: 'YES' }) && proPlanEnabled({ PRO_PLAN_ENABLED: 'on' }), 'PRO_PLAN_ENABLED accepts 1, true, yes, on');
assert(proCheckoutBlock('pro')?.code === 'PRO_UNAVAILABLE' && proCheckoutBlock('pro')?.error === PRO_CHECKOUT_ERROR && proCheckoutBlock('pro')?.status === 400, 'pro checkout block while the flag is off');
assert(proCheckoutBlock('plus') === null && proCheckoutBlock('business') === null && proCheckoutBlock('nope') === null, 'the pro block ignores every other plan');
for (const usage of ['personal', 'business', 'both'] as const) {
  const blocked = businessCheckoutBlock('business', usage);
  if (usage === 'personal') {
    assert(blocked?.status === 403 && blocked.code === 'BUSINESS_PLAN_REQUIRES_BUSINESS_ACCOUNT' && blocked.error === BUSINESS_ACCOUNT_CHECKOUT_ERROR, 'personal cannot buy Business');
  } else {
    assert(blocked === null, `${usage} can buy Business`);
  }
  assert(businessCheckoutBlock('plus', usage) === null && businessCheckoutBlock('pro', usage) === null, `${usage} is not refused Plus or Pro by account type`);
}
assert(process.env.PRO_PLAN_ENABLED == null, 'plan guard checks did not set PRO_PLAN_ENABLED');
process.env.PRO_PLAN_ENABLED = '1';
assert(proCheckoutBlock('pro') === null && proCheckoutBlock('plus') === null, 'PRO_PLAN_ENABLED=1 lets every account type check out Pro');
delete process.env.PRO_PLAN_ENABLED;
assert(proCheckoutBlock('pro')?.code === 'PRO_UNAVAILABLE', 'clearing the flag refuses Pro again');
const samePrice = { plan: 'business' as const, interval: 'year' as const };
assert(priceChangeDecision({ previous: null, next: samePrice, viaCheckout: false, usage: 'personal' }).applyPrice, 'a first subscription is not a move');
assert(priceChangeDecision({ previous: samePrice, next: samePrice, viaCheckout: false, usage: 'personal' }).applyPrice, 'the same Business price still syncs');
assert(priceChangeDecision({ previous: samePrice, next: { plan: 'business', interval: 'month' }, viaCheckout: true, usage: 'both' }).applyPrice === false, 'Business cannot move to another price, even from Checkout');
assert(
  priceChangeDecision({ previous: samePrice, next: { plan: 'plus', interval: 'month' }, viaCheckout: false, usage: 'both' }).applyPrice === false,
  'Business cannot move to Plus',
);
assert(priceChangeDecision({ previous: { plan: 'pro', interval: 'year' }, next: { plan: 'plus', interval: 'month' }, viaCheckout: false, usage: 'personal' }).applyPrice, 'Plus and Pro can still change into each other');
const portalUpgrade = priceChangeDecision({ previous: { plan: 'plus', interval: 'month' }, next: samePrice, viaCheckout: false, usage: 'both' });
assert(portalUpgrade.applyPrice === false && portalUpgrade.reason === 'business_without_checkout', 'a portal move onto Business is refused');
const checkoutUpgrade = priceChangeDecision({ previous: { plan: 'plus', interval: 'month' }, next: samePrice, viaCheckout: true, usage: 'both' });
assert(checkoutUpgrade.applyPrice, 'Checkout can move Both onto Business');
assert(priceChangeDecision({ previous: { plan: 'plus', interval: 'month' }, next: samePrice, viaCheckout: true, usage: 'business' }).applyPrice, 'Checkout can move Business only onto Business');
const personalUpgrade = priceChangeDecision({ previous: { plan: 'plus', interval: 'month' }, next: samePrice, viaCheckout: true, usage: 'personal' });
assert(personalUpgrade.applyPrice === false && personalUpgrade.reason === 'business_without_checkout', 'Checkout does not grant Business to Personal');
const proFromPlus = priceChangeDecision({ previous: { plan: 'plus', interval: 'month' }, next: { plan: 'pro', interval: 'month' }, viaCheckout: false, usage: 'personal' });
assert(proFromPlus.applyPrice === false && proFromPlus.reason === 'pro_unavailable', 'a subscription update cannot grant Pro while PRO_PLAN_ENABLED is off');
assert(
  priceChangeDecision({ previous: { plan: 'pro', interval: 'month' }, next: { plan: 'pro', interval: 'year' }, viaCheckout: false, usage: 'personal' }).applyPrice,
  'a Pro subscriber can still switch Pro monthly and yearly while the flag is off',
);
assert(
  priceChangeDecision({ previous: { plan: 'plus', interval: 'month' }, next: { plan: 'pro', interval: 'year' }, viaCheckout: true, usage: 'both' }).applyPrice,
  'Checkout completion can still finish Pro',
);
process.env.PRO_PLAN_ENABLED = '1';
assert(
  priceChangeDecision({ previous: { plan: 'plus', interval: 'year' }, next: { plan: 'pro', interval: 'month' }, viaCheckout: false, usage: 'personal' }).applyPrice,
  'PRO_PLAN_ENABLED lets a subscription update grant Pro',
);
delete process.env.PRO_PLAN_ENABLED;
assert(personalPortalLookupKeys('standard', false).join() === 'koruledger_plus_monthly,koruledger_plus_yearly', 'Plus portal prices exclude Pro and Business');
assert(
  personalPortalLookupKeys('standard', true).join() === 'koruledger_plus_monthly,koruledger_plus_yearly,koruledger_pro_monthly,koruledger_pro_yearly',
  'Pro sales add Pro prices and still exclude Business',
);
assert(personalPortalLookupKeys('pro_holder', false).includes('koruledger_pro_yearly') && !personalPortalLookupKeys('pro_holder', false).some((key) => key.includes('business')), 'a Pro holder keeps Pro interval prices');
assert(priceIsBusiness({ lookup_key: 'koruledger_business_monthly' }, new Set()) && priceIsBusiness({ id: 'price_old', metadata: { plan: 'business' } }, new Set()), 'Business lookup keys and price metadata');
assert(priceIsBusiness({ id: 'price_koruledger_business_yearly', lookup_key: null }, new Set(['price_koruledger_business_yearly'])), 'a Business price id counts without a lookup key');
assert(!priceIsBusiness({ lookup_key: 'koruledger_plus_monthly', id: 'price_koruledger_plus_monthly' }, new Set(['price_koruledger_business_yearly'])), 'Plus is not a Business price');

// Portal configuration: lookup by metadata, repair a config that still allows plan changes, create once.
{
  const repaired: { id: string; features: { subscription_update?: { enabled?: boolean }; subscription_cancel?: { enabled?: boolean }; payment_method_update?: { enabled?: boolean } } }[] = [
    {
      id: 'bpc_old',
      features: { subscription_update: { enabled: true }, subscription_cancel: { enabled: false }, payment_method_update: { enabled: false } },
    },
  ];
  const updates: unknown[] = [];
  const repairStripe = {
    billingPortal: {
      configurations: {
        list: async () => ({
          data: repaired.map((c) => ({ ...c, active: true, metadata: { [BUSINESS_PORTAL_METADATA_KEY]: BUSINESS_PORTAL_METADATA_VALUE } })),
          has_more: false,
        }),
        create: async () => {
          throw new Error('repair should update, not create');
        },
        update: async (id: string, params: { features: (typeof repaired)[number]['features'] }) => {
          updates.push(params);
          const row = repaired.find((c) => c.id === id)!;
          row.features = params.features;
          return row;
        },
      },
    },
  };
  const repairedId = await findOrCreateBusinessCancelOnlyPortal(repairStripe as never);
  assert(repairedId.id === 'bpc_old' && repairedId.updated && !repairedId.created, 'a tagged portal config is updated in place');
  const repairedFeatures = repaired[0].features;
  assert(repairedFeatures.subscription_update?.enabled === false && repairedFeatures.subscription_cancel?.enabled === true && repairedFeatures.payment_method_update?.enabled === true, 'updated portal config is cancel-only');
  const again = await findOrCreateBusinessCancelOnlyPortal(repairStripe as never);
  assert(again.id === 'bpc_old' && !again.updated && updates.length === 1, 'a cancel-only config is reused');

  const stored: { id: string; active: boolean; metadata: Record<string, string>; features: unknown }[] = [];
  const creates: { metadata?: Record<string, string>; features?: { subscription_update?: { enabled?: boolean } }; name?: string }[] = [];
  const createStripe = {
    billingPortal: {
      configurations: {
        list: async () => ({ data: stored, has_more: false }),
        create: async (params: { metadata?: Record<string, string>; features?: unknown; name?: string }) => {
          creates.push(params);
          const row = { id: 'bpc_new', active: true, metadata: params.metadata ?? {}, features: params.features };
          stored.push(row);
          return row;
        },
        update: async () => {
          throw new Error('create path should not update');
        },
      },
    },
  };
  const created = await findOrCreateBusinessCancelOnlyPortal(createStripe as never);
  assert(created.created && created.id === 'bpc_new', 'missing portal config is created');
  assert(creates[0].metadata?.[BUSINESS_PORTAL_METADATA_KEY] === BUSINESS_PORTAL_METADATA_VALUE, 'created config is tagged');
  assert(creates[0].features?.subscription_update?.enabled === false, 'created config disables plan changes');
  const reused = await findOrCreateBusinessCancelOnlyPortal(createStripe as never);
  assert(reused.id === 'bpc_new' && !reused.created && creates.length === 1, 'the created config is looked up next time');
}

// Personal portal: Plus prices, Pro only when asked, never Business. Updated in place, then reused.
{
  const priceList = async ({ lookup_keys }: { lookup_keys: string[] }) => ({
    data: lookup_keys.map((key) => ({ id: `price_${key}`, lookup_key: key, active: true })),
  });
  const rows: { id: string; active: boolean; metadata: Record<string, string>; features: { subscription_update?: { enabled?: boolean; products?: { product: string; prices: string[] }[] } } }[] = [];
  let n = 0;
  const personalStripe = {
    prices: { list: priceList },
    billingPortal: {
      configurations: {
        list: async () => ({ data: rows, has_more: false }),
        create: async (params: { metadata?: Record<string, string>; features?: (typeof rows)[number]['features']; name?: string }) => {
          const row = { id: `bpc_p${++n}`, active: true, metadata: params.metadata ?? {}, features: params.features ?? {} };
          rows.push(row);
          return row;
        },
        update: async (id: string, params: { features?: (typeof rows)[number]['features'] }) => {
          const row = rows.find((c) => c.id === id)!;
          if (params.features) row.features = params.features;
          return row;
        },
      },
    },
  };
  const plusOnly = await findOrCreatePersonalPortal(personalStripe as never, { variant: 'standard', includePro: false });
  assert(plusOnly.created && plusOnly.id === 'bpc_p1', 'Plus portal is created');
  const plusPrices = [...portalProductPriceIds(rows[0].features).values()].flatMap((set) => [...set]);
  assert(plusPrices.includes('price_koruledger_plus_monthly') && plusPrices.includes('price_koruledger_plus_yearly'), 'Plus monthly and yearly');
  assert(!plusPrices.some((id) => id.includes('pro') || id.includes('business')), 'Pro sales off: no Pro or Business prices');
  assert(rows[0].metadata[PERSONAL_PORTAL_METADATA_KEY] === PERSONAL_PORTAL_METADATA_VALUE, 'tagged koruledger_personal_portal=1');
  assert(rows[0].features.subscription_update?.enabled === true, 'Plus portal can switch price');
  const again = await findOrCreatePersonalPortal(personalStripe as never, { variant: 'standard', includePro: false });
  assert(again.id === 'bpc_p1' && !again.updated && !again.created && n === 1, 'the Plus portal is reused');
  const withPro = await findOrCreatePersonalPortal(personalStripe as never, { variant: 'standard', includePro: true });
  assert(withPro.updated && withPro.id === 'bpc_p1' && n === 1, 'turning Pro on updates the same portal');
  const proPrices = [...portalProductPriceIds(rows[0].features).values()].flatMap((set) => [...set]);
  assert(proPrices.includes('price_koruledger_pro_monthly') && proPrices.includes('price_koruledger_pro_yearly') && !proPrices.some((id) => id.includes('business')), 'Pro prices added, Business still absent');
  const held = await findOrCreatePersonalPortal(personalStripe as never, { variant: 'pro_holder', includePro: true });
  assert(held.created && held.id === 'bpc_p2', 'Pro subscribers get their own portal');
  assert(rows[1].metadata[PERSONAL_PORTAL_METADATA_KEY] === PERSONAL_PORTAL_PRO_VALUE, 'tagged koruledger_personal_portal=pro');
  const heldPrices = [...portalProductPriceIds(rows[1].features).values()].flatMap((set) => [...set]);
  assert(heldPrices.includes('price_koruledger_pro_monthly') && heldPrices.includes('price_koruledger_pro_yearly') && !heldPrices.some((id) => id.includes('business')), 'Pro holder can switch Pro interval and not Business');
  const heldAgain = await findOrCreatePersonalPortal(personalStripe as never, { variant: 'pro_holder', includePro: true });
  assert(heldAgain.id === 'bpc_p2' && !heldAgain.updated && n === 2, 'the Pro holder portal is reused');
}
assert(
  catalogForSubscription({
    items: {
      data: [
        { price: { lookup_key: 'koruledger_plus_monthly' } },
        { price: { lookup_key: 'koruledger_business_yearly' } },
        { price: { lookup_key: 'koruledger_pro_monthly' } },
      ],
    },
  } as never)?.plan === 'business',
  'several prices on one subscription map to Business',
);

// --- A fake Stripe: subscriptions live in a map the tests change.
type FakeSub = {
  id: string;
  customer: string;
  status: string;
  lookupKey: string;
  metadata: Record<string, string>;
  cancel_at_period_end?: boolean;
  livemode?: boolean;
  priceId?: string;
  omitLookupKey?: boolean;
};
const subs = new Map<string, FakeSub>();
type FakeInvoiceItem = { id: string; customer: string; subscription: string; proration: boolean };
const invoiceItems = new Map<string, FakeInvoiceItem>();
const calls: {
  checkout: Record<string, unknown>[];
  portal: Record<string, unknown>[];
  cancelled: string[];
  customers: number;
  portalConfigs: Record<string, unknown>[];
  portalLists: number;
  subscriptionUpdates: Record<string, unknown>[];
  deletedInvoiceItems: string[];
} = {
  checkout: [],
  portal: [],
  cancelled: [],
  customers: 0,
  portalConfigs: [],
  portalLists: 0,
  subscriptionUpdates: [],
  deletedInvoiceItems: [],
};
type FakePortalConfig = {
  id: string;
  active: boolean;
  metadata: Record<string, string>;
  features: {
    subscription_update?: { enabled?: boolean; products?: { product: string; prices: string[] }[] };
    subscription_cancel?: { enabled?: boolean; mode?: string };
    payment_method_update?: { enabled?: boolean };
    invoice_history?: { enabled?: boolean };
  };
};
const portalConfigs: FakePortalConfig[] = [];
let failCancel = false;
let failRevert = false;
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
        items: {
          data: [
            {
              id: `si_${s.id}`,
              current_period_end: periodEnd,
              price: {
                id: s.omitLookupKey ? (s.priceId ?? `price_${s.lookupKey}`) : `price_${s.lookupKey}`,
                lookup_key: s.omitLookupKey ? null : s.lookupKey,
              },
            },
          ],
        },
      };
    },
    update: async (id: string, params: { items?: { id: string; price: string }[]; proration_behavior?: string }) => {
      calls.subscriptionUpdates.push({ id, ...params });
      if (failRevert) throw new Error('Stripe is down');
      const price = params.items?.[0]?.price;
      const row = subs.get(id);
      if (row && price) {
        row.priceId = price;
        row.omitLookupKey = false;
        if (price.startsWith('price_')) row.lookupKey = price.slice('price_'.length);
      }
      return { id };
    },
    cancel: async (id: string) => {
      if (failCancel) throw new Error('Stripe is down');
      calls.cancelled.push(id);
      subs.get(id)!.status = 'canceled';
      return { id, status: 'canceled' };
    },
  },
  invoiceItems: {
    list: async (params: { customer?: string; pending?: boolean; subscription?: string }) => ({
      data: [...invoiceItems.values()]
        .filter((item) => !params.customer || item.customer === params.customer)
        .filter((item) => !params.subscription || item.subscription === params.subscription)
        .map((item) => ({
          id: item.id,
          proration: item.proration,
          customer: item.customer,
          parent: { type: 'subscription_details', subscription_details: { subscription: item.subscription } },
        })),
    }),
    del: async (id: string) => {
      calls.deletedInvoiceItems.push(id);
      invoiceItems.delete(id);
      return { id, deleted: true };
    },
  },
  prices: {
    list: async ({ lookup_keys }: { lookup_keys?: string[] }) => ({
      data: (lookup_keys ?? []).flatMap((key) => (catalogByLookupKey(key) ? [{ id: `price_${key}`, lookup_key: key, active: true }] : [])),
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
    configurations: {
      list: async () => {
        calls.portalLists += 1;
        return { data: portalConfigs, has_more: false };
      },
      create: async (params: { metadata?: Record<string, string>; features?: FakePortalConfig['features'] }) => {
        calls.portalConfigs.push(params as Record<string, unknown>);
        const row: FakePortalConfig = {
          id: `bpc_${portalConfigs.length + 1}`,
          active: true,
          metadata: params.metadata ?? {},
          features: params.features ?? {},
        };
        portalConfigs.push(row);
        return row;
      },
      update: async (id: string, params: { features?: FakePortalConfig['features'] }) => {
        calls.portalConfigs.push(params as Record<string, unknown>);
        const row = portalConfigs.find((c) => c.id === id);
        if (!row) throw new Error('No such portal configuration');
        if (params.features) row.features = params.features;
        return row;
      },
    },
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
  ['pam', 'pam@example.com'],
  ['ned', 'ned@example.com'],
  ['ivy', 'ivy@example.com'],
]) {
  run(db, `INSERT INTO users (id, email, password_hash, first_name, created_at, updated_at) VALUES (?,?,?,?,?,?)`, [id, email, pw, 'X', now, now]);
}
// una is Both and wes is Business only, so the existing Business checkout still applies.
// vic has never chosen (Personal). pam chose Personal.
run(db, `UPDATE users SET preferences_json = ? WHERE id = ?`, [JSON.stringify({ usageMode: 'both' }), 'una']);
run(db, `UPDATE users SET preferences_json = ? WHERE id = ?`, [JSON.stringify({ usageMode: 'business' }), 'wes']);
run(db, `UPDATE users SET preferences_json = ? WHERE id = ?`, [JSON.stringify({ usageMode: 'personal' }), 'pam']);

const WHSEC = 'whsec_test_secret';
const app = express();
app.post('/api/billing/webhook', express.raw({ type: 'application/json' }), billingWebhook);
app.use(express.json());
app.use('/api', attachUser);
app.use('/api/billing', (req, res, next) => ((req as { user?: unknown }).user ? next() : res.status(401).json({})), billingRouter);
app.use('/api/auth', authRouter);

let server: Server | null = null;
try {
  resetPortalConfigCacheForTests();
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
  const webhook = async (type: string, object: Record<string, unknown>, opts: { id?: string; livemode?: boolean; secret?: string; signature?: string } = {}) => {
    const payload = JSON.stringify({ id: opts.id ?? `evt_${++evtN}`, object: 'event', type, livemode: opts.livemode ?? false, data: { object } });
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
  const pam = await cookie('pam');
  const captureWarns = async (run: () => Promise<unknown>): Promise<string[]> => {
    const lines: string[] = [];
    const orig = console.warn;
    console.warn = (...args: unknown[]) => {
      lines.push(args.map((a) => (typeof a === 'string' ? a : JSON.stringify(a))).join(' '));
    };
    try {
      await run();
      return lines;
    } finally {
      console.warn = orig;
    }
  };

  // Billing off: the page says so, checkout and the webhook refuse.
  let st = await call('GET', '/api/billing', una);
  assert(st.status === 200 && st.json.available === false && st.json.plan === 'free' && st.json.prices.length === 6 && st.json.proPlanEnabled === false, 'off: status shows prices, unavailable, Pro hidden');
  assert(
    st.json.prices.some((p: { plan: string; interval: string; amountCents: number }) => p.plan === 'business' && p.interval === 'month' && p.amountCents === 2999) &&
      st.json.prices.some((p: { plan: string; interval: string; amountCents: number }) => p.plan === 'business' && p.interval === 'year' && p.amountCents === 24999),
    'off: Business prices are listed',
  );
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
  assert((await call('POST', '/api/billing/checkout', una, { plan: 'enterprise', interval: 'month' })).json.code === 'BAD_PLAN', 'unknown plan refused');
  assert((await call('POST', '/api/billing/portal', una)).json.code === 'NO_CUSTOMER', 'no portal before a customer');

  const proOff = await call('POST', '/api/billing/checkout', una, { plan: 'pro', interval: 'year' });
  assert(proOff.status === 400 && proOff.json.error === 'Pro is not available yet' && proOff.json.code === 'PRO_UNAVAILABLE', 'pro checkout refused while PRO_PLAN_ENABLED is off');
  const proMonth = await call('POST', '/api/billing/checkout', una, { plan: 'pro', interval: 'month' });
  assert(proMonth.status === 400 && proMonth.json.code === 'PRO_UNAVAILABLE', 'pro monthly is refused too');
  const proBadInterval = await call('POST', '/api/billing/checkout', una, { plan: 'pro', interval: 'week' });
  assert(proBadInterval.status === 400 && proBadInterval.json.code === 'PRO_UNAVAILABLE', 'pro is refused before the interval is checked');
  for (const flag of ['0', 'false', 'no', 'off', '2', ' ']) {
    process.env.PRO_PLAN_ENABLED = flag;
    const refused = await call('POST', '/api/billing/checkout', pam, { plan: 'pro', interval: 'year' });
    assert(refused.status === 400 && refused.json.code === 'PRO_UNAVAILABLE' && refused.json.error === 'Pro is not available yet', `PRO_PLAN_ENABLED=${JSON.stringify(flag)} still refuses pro`);
  }
  delete process.env.PRO_PLAN_ENABLED;
  assert(calls.checkout.length === 0, 'a refused Pro checkout does not open Stripe');
  assert((await call('GET', '/api/billing', una)).json.proPlanEnabled === false, 'status says Pro is not for sale');
  process.env.PRO_PLAN_ENABLED = '1';
  assert((await call('GET', '/api/billing', una)).json.proPlanEnabled === true, 'PRO_PLAN_ENABLED=1 offers Pro');

  // Checkout: one customer per user, the price by lookup key, user id on the subscription.
  const co = await call('POST', '/api/billing/checkout', una, { plan: 'pro', interval: 'year' });
  assert(co.status === 200 && co.json.url === 'https://checkout.stripe.test/cs_1', 'checkout url');
  const params = calls.checkout[0] as any;
  assert(params.mode === 'subscription' && params.customer === 'cus_new1' && params.client_reference_id === 'una', 'checkout for una');
  assert(params.line_items[0].price === 'price_koruledger_pro_yearly' && !params.line_items[0].tax_rates, 'pro yearly price, no GST rate unless set');
  assert(params.subscription_data.metadata.user_id === 'una', 'subscription tagged with user');
  assert(params.success_url === 'https://app.example.test/settings?tab=account&billing=success', 'returns to settings on PUBLIC_URL');
  assert(params.cancel_url === 'https://app.example.test/settings?tab=account&billing=cancelled', 'cancel returns to settings');
  process.env.STRIPE_GST_TAX_RATE_ID = 'txr_gst';
  await call('POST', '/api/billing/checkout', una, { plan: 'pro', interval: 'year' });
  assert(calls.customers === 1 && (calls.checkout[1] as any).customer === 'cus_new1', 'customer reused');
  assert((calls.checkout[1] as any).line_items[0].tax_rates[0] === 'txr_gst', 'GST rate applied when set');
  const bizMonth = await call('POST', '/api/billing/checkout', una, { plan: 'business', interval: 'month' });
  assert(bizMonth.status === 200 && bizMonth.json.url === 'https://checkout.stripe.test/cs_1', 'business monthly checkout');
  const bizMonthParams = calls.checkout[2] as any;
  assert(bizMonthParams.mode === 'subscription' && bizMonthParams.customer === 'cus_new1' && bizMonthParams.client_reference_id === 'una', 'business checkout for una');
  assert(bizMonthParams.line_items[0].price === 'price_koruledger_business_monthly' && bizMonthParams.line_items[0].quantity === 1, 'business monthly price by lookup key');
  assert(bizMonthParams.subscription_data.metadata.user_id === 'una', 'business subscription tagged with user');
  assert(bizMonthParams.line_items[0].tax_rates[0] === 'txr_gst', 'business monthly includes the GST rate when set');
  const bizYear = await call('POST', '/api/billing/checkout', una, { plan: 'business', interval: 'year' });
  assert(bizYear.status === 200 && (calls.checkout[3] as any).line_items[0].price === 'price_koruledger_business_yearly', 'business yearly price by lookup key');
  assert(calls.customers === 1, 'business checkout reuses the customer');
  const checkoutsBeforePersonal = calls.checkout.length;
  const unsetBiz = await call('POST', '/api/billing/checkout', vic, { plan: 'business', interval: 'month' });
  assert(unsetBiz.status === 403 && unsetBiz.json.code === 'BUSINESS_PLAN_REQUIRES_BUSINESS_ACCOUNT' && unsetBiz.json.error === 'Business is for a business account. Personal accounts can choose Plus.', 'an account that never chose usage is Personal and cannot buy Business');
  const personalBiz = await call('POST', '/api/billing/checkout', pam, { plan: 'business', interval: 'year' });
  assert(personalBiz.status === 403 && personalBiz.json.code === 'BUSINESS_PLAN_REQUIRES_BUSINESS_ACCOUNT', 'explicit Personal cannot buy Business');
  const personalPlus = await call('POST', '/api/billing/checkout', pam, { plan: 'plus', interval: 'month' });
  assert(personalPlus.status === 200 && (calls.checkout.at(-1) as { line_items?: { price: string }[] }).line_items?.[0].price === 'price_koruledger_plus_monthly', 'Personal can check out Plus');
  assert(calls.checkout.length === checkoutsBeforePersonal + 1, 'refused Business checkouts do not open Stripe');
  assert(planOf(db, 'una') === 'free', 'no plan until Stripe says paid');
  const onboard = await call('POST', '/api/billing/checkout', una, { plan: 'plus', interval: 'month', returnTo: '/register' });
  assert(onboard.status === 200 && onboard.json.url === 'https://checkout.stripe.test/cs_1', 'onboarding checkout url');
  const onboardParams = calls.checkout.at(-1) as { success_url?: string; cancel_url?: string };
  assert(onboardParams.success_url === 'https://app.example.test/register?billing=success', 'onboarding success returns to register');
  assert(onboardParams.cancel_url === 'https://app.example.test/register?billing=cancelled', 'onboarding cancel returns to register');
  await call('POST', '/api/billing/checkout', una, { plan: 'plus', interval: 'month', returnTo: 'https://evil.test/phish' });
  assert((calls.checkout.at(-1) as { success_url?: string }).success_url === 'https://app.example.test/settings?tab=account&billing=success', 'an external returnTo is ignored');
  await call('POST', '/api/billing/checkout', una, { plan: 'plus', interval: 'month', returnTo: '//evil.test' });
  assert((calls.checkout.at(-1) as { success_url?: string }).success_url === 'https://app.example.test/settings?tab=account&billing=success', 'a protocol-relative returnTo is ignored');
  await call('POST', '/api/billing/checkout', una, { plan: 'business', interval: 'year', returnTo: '/business' });
  const bizReturn = calls.checkout.at(-1) as { success_url?: string; cancel_url?: string };
  assert(bizReturn.success_url === 'https://app.example.test/business?setup=1&billing=success', 'business setup success URL');
  assert(bizReturn.cancel_url === 'https://app.example.test/business?setup=1&billing=cancelled', 'business setup cancel URL');
  delete process.env.PRO_PLAN_ENABLED;
  assert((await call('GET', '/api/billing', una)).json.proPlanEnabled === false, 'Pro sales off again before the webhook');

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

  // Portal. Pro sales are off, so a Pro subscriber gets the Pro interval configuration, not the default portal.
  const portal = await call('POST', '/api/billing/portal', una);
  assert(portal.json.url === 'https://billing.stripe.test/p_1' && (calls.portal[0] as any).customer === 'cus_new1', 'portal for the customer');
  const proHolderConfig = portalConfigs.find((c) => c.metadata[PERSONAL_PORTAL_METADATA_KEY] === PERSONAL_PORTAL_PRO_VALUE);
  const proHolderPrices = [...portalProductPriceIds(proHolderConfig?.features).values()].flatMap((set) => [...set]);
  assert((calls.portal[0] as { configuration?: string }).configuration === proHolderConfig?.id, 'a Pro subscription uses the Pro holder portal');
  assert(proHolderPrices.includes('price_koruledger_pro_monthly') && proHolderPrices.includes('price_koruledger_pro_yearly'), 'a Pro holder can switch monthly and yearly');
  assert(!proHolderPrices.some((id) => id.includes('business')), 'the Pro holder portal has no Business price');
  assert(proHolderConfig?.features.invoice_history?.enabled === true && proHolderConfig.features.payment_method_update?.enabled === true, 'Pro holder portal shows invoices and the card');
  assert(proHolderConfig?.features.subscription_cancel?.enabled === true && proHolderConfig.features.subscription_cancel.mode === 'at_period_end', 'Pro holder portal cancels at period end');
  const proLists = calls.portalLists;
  const portalAgain = await call('POST', '/api/billing/portal', una);
  assert(portalAgain.status === 200 && calls.portalLists === proLists, 'the Pro holder portal id is cached');
  assert((calls.portal.at(-1) as { configuration?: string }).configuration === proHolderConfig?.id, 'the second Pro session reuses it');

  // A switch to Plus in the portal, then cancel at period end (keeps the plan), then failed payments.
  subs.get('sub_una')!.lookupKey = 'koruledger_plus_monthly';
  await webhook('customer.subscription.updated', { id: 'sub_una' });
  assert(planOf(db, 'una') === 'plus' && !hasFeature(db, 'una', 'crypto_pro') && hasFeature(db, 'una', 'household'), 'downgrade to Plus');
  assert(calls.subscriptionUpdates.length === 0, 'an allowed move off Pro is not reverted');
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
  assert(planOf(db, 'una') === 'business' && hasFeature(db, 'una', 'business_reports'), 'operator Business grant');
  setPlan(db, 'una', 'free', 'test');
  setPlan(db, 'una', 'pro', 'operator');
  assert(planOf(db, 'una') === 'pro' && hasFeature(db, 'una', 'crypto_pro'), 'plan:set Pro still applies while checkout is off');
  setPlan(db, 'una', 'free', 'test');

  // A Business subscription maps to the business tier and its reports, not Plus or Pro features.
  subs.set('sub_biz', { id: 'sub_biz', customer: 'cus_new1', status: 'active', lookupKey: 'koruledger_business_yearly', metadata: { user_id: 'una' } });
  assert((await webhook('customer.subscription.created', { id: 'sub_biz' })) === 200, 'business subscription webhook');
  assert(planOf(db, 'una') === 'business' && hasFeature(db, 'una', 'business_reports'), 'paid: Business grants business reports');
  assert(!hasFeature(db, 'una', 'household') && !hasFeature(db, 'una', 'crypto_pro') && !hasFeature(db, 'una', 'payslips'), 'Business subscription does not include Plus or Pro');
  st = await call('GET', '/api/billing', una);
  assert(st.json.plan === 'business' && st.json.subscription.plan === 'business' && st.json.subscription.interval === 'year' && st.json.subscription.status === 'active', 'GET /api/billing reports Business');

  // Business portal: cancel and card update, no plan change. Created once, then looked up.
  const bizPortal = await call('POST', '/api/billing/portal', una);
  assert(bizPortal.status === 200 && bizPortal.json.url === 'https://billing.stripe.test/p_1', 'business portal opens');
  const createdPortal = calls.portalConfigs.find((c) => (c as { metadata?: Record<string, string> }).metadata?.[BUSINESS_PORTAL_METADATA_KEY] === '1') as { metadata?: Record<string, string>; features?: { subscription_update?: { enabled?: boolean }; subscription_cancel?: { enabled?: boolean; mode?: string }; payment_method_update?: { enabled?: boolean } }; name?: string };
  const businessPortalId = portalConfigs.find((c) => c.metadata[BUSINESS_PORTAL_METADATA_KEY] === BUSINESS_PORTAL_METADATA_VALUE)?.id;
  assert(createdPortal.metadata?.[BUSINESS_PORTAL_METADATA_KEY] === '1', 'portal config is tagged koruledger_business_cancel_only');
  assert(createdPortal.features?.subscription_update?.enabled === false, 'business portal disables subscription updates');
  assert(createdPortal.features?.subscription_cancel?.enabled === true && createdPortal.features.subscription_cancel.mode === 'at_period_end', 'business portal can cancel at period end');
  assert(createdPortal.features?.payment_method_update?.enabled === true, 'business portal can update the card');
  assert((calls.portal.at(-1) as { configuration?: string }).configuration === businessPortalId, 'business portal session uses the cancel-only configuration');
  const writesAfterCreate = calls.portalConfigs.length;
  const listsAfterBusiness = calls.portalLists;
  const bizPortalAgain = await call('POST', '/api/billing/portal', una);
  assert(bizPortalAgain.status === 200 && calls.portalConfigs.length === writesAfterCreate && calls.portalLists === listsAfterBusiness, 'the cancel-only configuration is reused without listing');
  assert((calls.portal.at(-1) as { configuration?: string }).configuration === businessPortalId, 'the second session uses the same configuration');
  process.env.STRIPE_PORTAL_CONFIG_BUSINESS = 'bpc_pinned';
  const pinned = await call('POST', '/api/billing/portal', una);
  assert(pinned.status === 200 && (calls.portal.at(-1) as { configuration?: string }).configuration === 'bpc_pinned' && calls.portalConfigs.length === writesAfterCreate && calls.portalLists === listsAfterBusiness, 'STRIPE_PORTAL_CONFIG_BUSINESS pins the configuration');
  delete process.env.STRIPE_PORTAL_CONFIG_BUSINESS;

  subs.get('sub_biz')!.cancel_at_period_end = true;
  await webhook('customer.subscription.updated', { id: 'sub_biz' });
  assert(planOf(db, 'una') === 'business' && (await call('GET', '/api/billing', una)).json.subscription.cancelAtPeriodEnd === true && (await call('GET', '/api/billing', una)).json.subscription.interval === 'year', 'cancelling Business keeps the plan and the price');
  subs.get('sub_biz')!.cancel_at_period_end = false;
  subs.get('sub_biz')!.lookupKey = 'koruledger_business_monthly';
  const retryId = 'evt_biz_interval_retry';
  const priceIgnored = await captureWarns(() => webhook('customer.subscription.updated', { id: 'sub_biz' }, { id: retryId }));
  assert(planOf(db, 'una') === 'business' && (await call('GET', '/api/billing', una)).json.subscription.interval === 'year', 'a Business price change is not granted');
  assert(priceIgnored.some((line) => line.includes('billing_plan_change_ignored') && line.includes('business_price_change')), 'a Business price change is logged');
  assert(subs.get('sub_biz')!.lookupKey === 'koruledger_business_yearly', 'Stripe is put back on the granted Business price');
  const intervalRevert = calls.subscriptionUpdates.at(-1) as { proration_behavior?: string; items?: { price: string }[] };
  assert(intervalRevert.proration_behavior === 'none' && intervalRevert.items?.[0].price === 'price_koruledger_business_yearly', 'the revert does not prorate');
  const intervalAlert = queryOne<{ reason: string; from_interval: string; to_interval: string }>(
    db,
    `SELECT reason, from_interval, to_interval FROM billing_alerts WHERE stripe_event_id = ?`,
    [retryId],
  );
  assert(intervalAlert?.reason === 'business_price_change' && intervalAlert.from_interval === 'year' && intervalAlert.to_interval === 'month', 'the ignored change is stored on billing_alerts');
  subs.get('sub_biz')!.lookupKey = 'koruledger_business_monthly';
  const updatesAfterRetry = calls.subscriptionUpdates.length;
  await webhook('customer.subscription.updated', { id: 'sub_biz' }, { id: retryId });
  assert(calls.subscriptionUpdates.length === updatesAfterRetry, 'a webhook retry does not revert again');
  assert(planOf(db, 'una') === 'business' && (await call('GET', '/api/billing', una)).json.subscription.interval === 'year', 'the retry leaves the granted price');
  subs.get('sub_biz')!.lookupKey = 'koruledger_plus_monthly';
  const downgradeIgnored = await captureWarns(() => webhook('customer.subscription.updated', { id: 'sub_biz' }));
  assert(planOf(db, 'una') === 'business' && (await call('GET', '/api/billing', una)).json.subscription.plan === 'business' && (await call('GET', '/api/billing', una)).json.subscription.interval === 'year', 'Business cannot be moved to Plus from the portal');
  assert(downgradeIgnored.some((line) => line.includes('business_price_change')), 'the Plus move is logged');
  subs.get('sub_biz')!.lookupKey = 'koruledger_business_yearly';
  await webhook('customer.subscription.updated', { id: 'sub_biz' });
  assert((await call('GET', '/api/billing', una)).json.subscription.cancelAtPeriodEnd === false, 'a status-only Business update still applies');
  setPlan(db, 'una', 'business', 'test');
  subs.get('sub_biz')!.status = 'canceled';
  await webhook('customer.subscription.updated', { id: 'sub_biz' });
  assert(planOf(db, 'una') === 'business' && hasFeature(db, 'una', 'business_reports'), 'operator grant remains after the Business subscription ends');
  setPlan(db, 'una', 'free', 'test');
  assert(planOf(db, 'una') === 'free' && !hasFeature(db, 'una', 'business_reports'), 'clearing the grant drops Business');

  // Unknown customer and unknown prices are ignored, not retried.
  subs.set('sub_ghost', { id: 'sub_ghost', customer: 'cus_ghost', status: 'active', lookupKey: 'koruledger_pro_monthly', metadata: {} });
  assert((await webhook('customer.subscription.created', { id: 'sub_ghost' })) === 200, 'unknown customer 200');
  subs.set('sub_odd', { id: 'sub_odd', customer: 'cus_new1', status: 'active', lookupKey: 'something_else', metadata: { user_id: 'una' } });
  await webhook('customer.subscription.created', { id: 'sub_odd' });
  assert(planOf(db, 'una') === 'free', 'a price we do not sell grants nothing');

  // A portal change onto Business is not granted. Checkout completion is, for Both / Business only.
  subs.set('sub_move', { id: 'sub_move', customer: 'cus_new1', status: 'active', lookupKey: 'koruledger_plus_monthly', metadata: { user_id: 'una' } });
  assert((await webhook('customer.subscription.created', { id: 'sub_move' })) === 200, 'plus subscription to move');
  assert(planOf(db, 'una') === 'plus', 'the move starts on Plus');
  subs.get('sub_move')!.lookupKey = 'koruledger_business_monthly';
  const moveIgnored = await captureWarns(() => webhook('customer.subscription.updated', { id: 'sub_move' }));
  assert(planOf(db, 'una') === 'plus' && (await call('GET', '/api/billing', una)).json.subscription.plan === 'plus', 'subscription.updated onto Business is not granted');
  assert(moveIgnored.some((line) => line.includes('billing_plan_change_ignored') && line.includes('business_without_checkout')), 'a Business upgrade without checkout is logged');
  assert(subs.get('sub_move')!.lookupKey === 'koruledger_plus_monthly', 'the portal move onto Business is reverted');
  subs.get('sub_move')!.lookupKey = 'koruledger_business_monthly';
  assert(
    (await webhook('checkout.session.completed', { id: 'cs_move', mode: 'subscription', customer: 'cus_new1', client_reference_id: 'una', subscription: 'sub_move' })) === 200,
    'checkout completion for an allowed account',
  );
  assert(planOf(db, 'una') === 'business' && (await call('GET', '/api/billing', una)).json.subscription.plan === 'business', 'Checkout grants Business for Both');

  subs.set('sub_pam', { id: 'sub_pam', customer: 'cus_pam', status: 'active', lookupKey: 'koruledger_plus_yearly', metadata: { user_id: 'pam' } });
  await webhook('customer.subscription.created', { id: 'sub_pam' });
  assert(planOf(db, 'pam') === 'plus', 'Personal can be granted Plus');
  subs.get('sub_pam')!.lookupKey = 'koruledger_business_yearly';
  const pamPortal = await captureWarns(() => webhook('customer.subscription.updated', { id: 'sub_pam' }));
  assert(planOf(db, 'pam') === 'plus', 'Personal cannot be moved onto Business from the portal');
  assert(pamPortal.some((line) => line.includes('business_without_checkout')), 'the Personal portal move is logged');
  assert(subs.get('sub_pam')!.lookupKey === 'koruledger_plus_yearly', 'Personal is put back on Plus');
  subs.get('sub_pam')!.lookupKey = 'koruledger_business_yearly';
  const pamCheckout = await captureWarns(() => webhook('checkout.session.completed', { id: 'cs_pam', mode: 'subscription', customer: 'cus_pam', client_reference_id: 'pam', subscription: 'sub_pam' }));
  assert(planOf(db, 'pam') === 'plus' && (await call('GET', '/api/billing', pam)).json.subscription.plan === 'plus', 'Checkout completion does not grant Business to Personal');
  assert(pamCheckout.some((line) => line.includes('business_without_checkout')), 'the Personal checkout move is logged');

  assert((await webhook('invoice.paid', { id: 'in_1' })) === 200, 'other events acknowledged');

  // Stripe unreachable → 500 so Stripe retries.
  assert((await webhook('customer.subscription.updated', { id: 'sub_missing' })) === 500, 'fetch failure 500');

  // Account deletion cancels the subscription first; if that fails, nothing is deleted.
  subs.set('sub_vic', { id: 'sub_vic', customer: 'cus_vic', status: 'active', lookupKey: 'koruledger_plus_yearly', metadata: { user_id: 'vic' } });
  await webhook('customer.subscription.created', { id: 'sub_vic' });
  assert(planOf(db, 'vic') === 'plus', 'vic on Plus via subscription metadata');
  const portalWrites = calls.portalConfigs.length;
  const vicPortal = await call('POST', '/api/billing/portal', vic);
  assert(vicPortal.status === 200 && (calls.portal.at(-1) as { configuration?: string; customer?: string }).customer === 'cus_vic', 'plus portal opens');
  const plusPortalId = (calls.portal.at(-1) as { configuration?: string }).configuration;
  const plusConfig = portalConfigs.find((c) => c.id === plusPortalId);
  const plusPrices = [...portalProductPriceIds(plusConfig?.features).values()].flatMap((set) => [...set]);
  assert(plusPortalId && plusPortalId !== businessPortalId && plusConfig?.metadata[PERSONAL_PORTAL_METADATA_KEY] === PERSONAL_PORTAL_METADATA_VALUE, 'Plus uses the personal portal, not Business and not the default');
  assert(plusPrices.includes('price_koruledger_plus_monthly') && plusPrices.includes('price_koruledger_plus_yearly') && !plusPrices.some((id) => id.includes('pro') || id.includes('business')), 'Plus portal prices are Plus only while Pro sales are off');
  assert(calls.portalConfigs.length === portalWrites + 1, 'the Plus portal configuration is created once');
  const plusLists = calls.portalLists;
  const vicPortalAgain = await call('POST', '/api/billing/portal', vic);
  assert(vicPortalAgain.status === 200 && calls.portalLists === plusLists && (calls.portal.at(-1) as { configuration?: string }).configuration === plusPortalId, 'the Plus portal id is cached');
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
  const wesCookie = await cookie('wes');
  const wesPlus = await call('POST', '/api/billing/checkout', wesCookie, { plan: 'plus', interval: 'month' });
  assert(wesPlus.status === 200 && (calls.checkout.at(-1) as any).line_items[0].price === 'price_koruledger_plus_monthly', 'plus checkout while Pro is hidden');
  const wesBiz = await call('POST', '/api/billing/checkout', wesCookie, { plan: 'business', interval: 'year' });
  assert(wesBiz.status === 200 && (calls.checkout.at(-1) as any).line_items[0].price === 'price_koruledger_business_yearly', 'business checkout while Pro is hidden');
  const wesPro = await call('POST', '/api/billing/checkout', wesCookie, { plan: 'pro', interval: 'month' });
  assert(wesPro.status === 400 && wesPro.json.error === 'Pro is not available yet', 'pro checkout still refused after other plans');
  const checkoutsBeforePamPro = calls.checkout.length;
  const pamPro = await call('POST', '/api/billing/checkout', pam, { plan: 'pro', interval: 'month' });
  assert(pamPro.status === 400 && pamPro.json.code === 'PRO_UNAVAILABLE' && calls.checkout.length === checkoutsBeforePamPro, 'Personal pro checkout stays refused and does not open Stripe');

  // Subscription update must not grant Pro while the flag is off. The price is reverted, once per event.
  invoiceItems.set('ii_pro', { id: 'ii_pro', customer: 'cus_pam', subscription: 'sub_pam', proration: true });
  invoiceItems.set('ii_keep', { id: 'ii_keep', customer: 'cus_pam', subscription: 'sub_pam', proration: false });
  invoiceItems.set('ii_other', { id: 'ii_other', customer: 'cus_pam', subscription: 'sub_other', proration: true });
  subs.get('sub_pam')!.lookupKey = 'koruledger_pro_monthly';
  const proIgnored = await captureWarns(() => webhook('customer.subscription.updated', { id: 'sub_pam' }, { id: 'evt_pam_pro' }));
  assert(planOf(db, 'pam') === 'plus', 'a subscription update does not grant Pro while PRO_PLAN_ENABLED is off');
  assert(proIgnored.some((line) => line.includes('pro_unavailable') && line.includes('billing_plan_change_ignored')), 'the refused Pro grant is warned');
  assert(subs.get('sub_pam')!.lookupKey === 'koruledger_plus_yearly', 'the Plus price is restored');
  const proRevert = calls.subscriptionUpdates.at(-1) as { proration_behavior?: string; items?: { price: string }[] };
  assert(proRevert.proration_behavior === 'none' && proRevert.items?.[0].price === 'price_koruledger_plus_yearly', 'the Pro revert does not prorate');
  const proAlert = queryOne<{ reason: string; to_plan: string; detail: string }>(db, `SELECT reason, to_plan, detail FROM billing_alerts WHERE stripe_event_id = ?`, ['evt_pam_pro']);
  assert(proAlert?.reason === 'pro_unavailable' && proAlert.to_plan === 'pro', 'the refused Pro grant is on billing_alerts');
  assert(proAlert.detail.includes('removed pending prorations: ii_pro'), 'the alert records the removed proration');
  assert(calls.deletedInvoiceItems.includes('ii_pro') && invoiceItems.has('ii_keep') && invoiceItems.has('ii_other'), 'only that subscription’s pending proration is deleted');
  subs.get('sub_pam')!.lookupKey = 'koruledger_pro_yearly';
  const proUpdates = calls.subscriptionUpdates.length;
  await webhook('customer.subscription.updated', { id: 'sub_pam' }, { id: 'evt_pam_pro' });
  assert(calls.subscriptionUpdates.length === proUpdates && planOf(db, 'pam') === 'plus', 'retrying the Pro event does not update Stripe again');
  failRevert = true;
  subs.get('sub_pam')!.lookupKey = 'koruledger_pro_monthly';
  subs.get('sub_pam')!.status = 'past_due';
  const failedRevert = await webhook('customer.subscription.updated', { id: 'sub_pam' }, { id: 'evt_pam_pro_fail' });
  assert(failedRevert === 200, 'a revert failure still acknowledges the webhook');
  assert(planOf(db, 'pam') === 'plus', 'a failed revert does not grant Pro');
  const pamSaved = queryOne<{ status: string; plan: string }>(db, `SELECT status, plan FROM billing_subscriptions WHERE stripe_subscription_id = 'sub_pam'`);
  assert(pamSaved?.status === 'past_due' && pamSaved.plan === 'plus', 'the status is saved with the granted plan');
  const failAlert = queryOne<{ error: string }>(db, `SELECT error FROM billing_alerts WHERE stripe_event_id = ?`, ['evt_pam_pro_fail']);
  assert(failAlert?.error.includes('Stripe is down'), 'the alert records the revert error');
  failRevert = false;
  subs.get('sub_pam')!.status = 'active';
  subs.get('sub_pam')!.lookupKey = 'koruledger_plus_yearly';

  // A current Pro subscriber can still change interval. Checkout completion can still grant Pro.
  subs.set('sub_ivy', { id: 'sub_ivy', customer: 'cus_ivy', status: 'active', lookupKey: 'koruledger_pro_monthly', metadata: { user_id: 'ivy' } });
  assert(
    (await webhook('checkout.session.completed', { id: 'cs_ivy', mode: 'subscription', customer: 'cus_ivy', client_reference_id: 'ivy', subscription: 'sub_ivy' })) === 200,
    'ivy checkout completed',
  );
  assert(planOf(db, 'ivy') === 'pro', 'Checkout still grants Pro while the flag is off');
  const ivyCookie = await cookie('ivy');
  const ivyUpdates = calls.subscriptionUpdates.length;
  subs.get('sub_ivy')!.lookupKey = 'koruledger_pro_yearly';
  await webhook('customer.subscription.updated', { id: 'sub_ivy' });
  assert(planOf(db, 'ivy') === 'pro' && (await call('GET', '/api/billing', ivyCookie)).json.subscription.interval === 'year', 'Pro monthly to yearly is granted while Pro sales are off');
  assert(calls.subscriptionUpdates.length === ivyUpdates, 'an allowed Pro interval change is not reverted');
  process.env.STRIPE_PORTAL_CONFIG_PERSONAL = 'bpc_person_pin';
  const ivyLists = calls.portalLists;
  const ivyPortal = await call('POST', '/api/billing/portal', ivyCookie);
  const ivyConfig = (calls.portal.at(-1) as { configuration?: string }).configuration;
  assert(ivyPortal.status === 200 && ivyConfig === proHolderConfig?.id && ivyConfig !== 'bpc_person_pin', 'a Pro holder does not use a Plus-only pin while Pro sales are off');
  assert(calls.portalLists === ivyLists, 'the cached Pro holder portal is not listed again');
  const pamPinned = await call('POST', '/api/billing/portal', pam);
  assert(pamPinned.status === 200 && (calls.portal.at(-1) as { configuration?: string }).configuration === 'bpc_person_pin' && calls.portalLists === ivyLists, 'Plus uses STRIPE_PORTAL_CONFIG_PERSONAL and does not list configurations');
  delete process.env.STRIPE_PORTAL_CONFIG_PERSONAL;

  process.env.PRO_PLAN_ENABLED = '1';
  const flagged = await call('POST', '/api/billing/portal', pam);
  const standard = portalConfigs.find((c) => c.metadata[PERSONAL_PORTAL_METADATA_KEY] === PERSONAL_PORTAL_METADATA_VALUE);
  const standardPrices = [...portalProductPriceIds(standard?.features).values()].flatMap((set) => [...set]);
  assert(flagged.status === 200 && (calls.portal.at(-1) as { configuration?: string }).configuration === standard?.id, 'Pro sales on uses the standard personal portal');
  assert(standardPrices.includes('price_koruledger_pro_monthly') && standardPrices.includes('price_koruledger_plus_yearly') && !standardPrices.some((id) => id.includes('business')), 'that portal adds Pro prices and still excludes Business');
  const flaggedLists = calls.portalLists;
  await call('POST', '/api/billing/portal', pam);
  assert(calls.portalLists === flaggedLists, 'the updated personal portal id stays cached');
  delete process.env.PRO_PLAN_ENABLED;

  // Unpaid, incomplete, and past_due Business subscriptions use the cancel-only portal. So does a Business price id.
  subs.set('sub_ned', { id: 'sub_ned', customer: 'cus_ned', status: 'unpaid', lookupKey: 'koruledger_business_monthly', metadata: { user_id: 'ned' } });
  assert((await webhook('customer.subscription.created', { id: 'sub_ned' })) === 200, 'unpaid business subscription stored');
  assert(planOf(db, 'ned') === 'free', 'unpaid Business does not grant the plan');
  const nedCookie = await cookie('ned');
  const nedLists = calls.portalLists;
  const unpaidPortal = await call('POST', '/api/billing/portal', nedCookie);
  assert(unpaidPortal.status === 200 && (calls.portal.at(-1) as { configuration?: string }).configuration === businessPortalId, 'unpaid Business uses the cancel-only portal');
  assert(calls.portalLists === nedLists, 'the cached Business portal id is not listed again');
  subs.get('sub_ned')!.status = 'incomplete';
  await webhook('customer.subscription.updated', { id: 'sub_ned' });
  const incompletePortal = await call('POST', '/api/billing/portal', nedCookie);
  assert(incompletePortal.status === 200 && (calls.portal.at(-1) as { configuration?: string }).configuration === businessPortalId, 'incomplete Business uses the cancel-only portal');
  subs.get('sub_ned')!.status = 'past_due';
  await webhook('customer.subscription.updated', { id: 'sub_ned' });
  assert(planOf(db, 'ned') === 'business', 'past_due Business grants');
  const pastPortal = await call('POST', '/api/billing/portal', nedCookie);
  assert(pastPortal.status === 200 && (calls.portal.at(-1) as { configuration?: string }).configuration === businessPortalId, 'past_due Business uses the cancel-only portal');

  subs.get('sub_pam')!.omitLookupKey = true;
  subs.get('sub_pam')!.priceId = 'price_koruledger_business_yearly';
  const byPriceId = await call('POST', '/api/billing/portal', pam);
  assert(byPriceId.status === 200 && (calls.portal.at(-1) as { configuration?: string }).configuration === businessPortalId, 'a Business price id without a lookup key uses the cancel-only portal');
  subs.get('sub_pam')!.omitLookupKey = false;
  delete subs.get('sub_pam')!.priceId;

  // A deleted subscription whose Stripe price differs from the granted price must still be saved.
  const updatesBeforeDelete = calls.subscriptionUpdates.length;
  subs.get('sub_ned')!.status = 'canceled';
  subs.get('sub_ned')!.lookupKey = 'koruledger_plus_monthly';
  const deleted = await webhook('customer.subscription.deleted', { id: 'sub_ned' }, { id: 'evt_ned_deleted' });
  assert(deleted === 200, 'a deleted event with a different price is accepted');
  assert(calls.subscriptionUpdates.length === updatesBeforeDelete, 'a canceled subscription is not updated in Stripe');
  assert(planOf(db, 'ned') === 'free', 'cancel drops Business');
  const nedSaved = queryOne<{ status: string; plan: string }>(db, `SELECT status, plan FROM billing_subscriptions WHERE stripe_subscription_id = 'sub_ned'`);
  assert(nedSaved?.status === 'canceled' && nedSaved.plan === 'business', 'the cancel is saved and the granted plan is unchanged');
  const nedAlert = queryOne<{ reason: string; error: string; detail: string }>(
    db,
    `SELECT reason, error, detail FROM billing_alerts WHERE stripe_event_id = ?`,
    ['evt_ned_deleted'],
  );
  assert(nedAlert?.reason === 'business_price_change' && nedAlert.error === '' && nedAlert.detail.includes('canceled'), 'the closed subscription is alerted without a revert error');

  assert(process.env.STRIPE_LIVE_ENABLED == null, 'tests never set STRIPE_LIVE_ENABLED');
  assert(process.env.PRO_PLAN_ENABLED == null, 'tests leave Pro sales off');
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
