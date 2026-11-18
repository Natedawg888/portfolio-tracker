/**
 * Linked business accounts: create, link, list, switch, billing isolation, deletion.
 * Run: npm run test:links
 *
 * Throwaway sqlite file. Does not read or write data/portfolio.db.
 * Stripe is faked. STRIPE_LIVE_ENABLED is not set.
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import type { AddressInfo } from 'node:net';
import type { Server } from 'node:http';
import express from 'express';
import type Stripe from 'stripe';

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'pt-links-'));
process.env.DATABASE_PATH = path.join(tmp, 'portfolio.db');
process.env.PUBLIC_URL = 'https://app.example.test';
delete process.env.STRIPE_SECRET_KEY;
delete process.env.STRIPE_WEBHOOK_SECRET;
delete process.env.STRIPE_LIVE_ENABLED;
delete process.env.STRIPE_GST_TAX_RATE_ID;
delete process.env.PRO_PLAN_ENABLED;
delete process.env.PLAN_PLUS_EMAILS;
delete process.env.PLAN_PRO_EMAILS;
delete process.env.PLAN_BUSINESS_EMAILS;

let passed = 0;
function check(cond: unknown, msg: string): void {
  if (!cond) throw new Error(`FAIL: ${msg}`);
  passed++;
}

const { getDb, queryAll, queryOne, run } = await import('../db/index.ts');
const { attachUser, requireAuth, isPublicApiPath } = await import('../middleware/requireAuth.ts');
const { default: authRouter } = await import('../routes/auth.ts');
const { default: settingsRouter } = await import('../routes/settings.ts');
const { default: accountsRouter } = await import('../routes/accounts.ts');
const { default: accountLinksRouter } = await import('../routes/accountLinks.ts');
const { default: billingRouter } = await import('../routes/billing.ts');
const { planOf, setPlan } = await import('../lib/entitlements.ts');
const { billingConfig } = await import('../billing/config.ts');
const { handleBillingEvent } = await import('../billing/service.ts');
const { setStripeClientForTests } = await import('../billing/client.ts');
const { grantingSubscriptions, saveSubscription, userIdForCustomer } = await import('../billing/store.ts');
const { settleMarkedLinkedAccounts } = await import('./linkedDeletion.ts');
const { createSession } = await import('./sessions.ts');
const { sendEmail, setEmailFetchForTest } = await import('../invoices/email.ts');
const { beginTotpSetup, confirmTotpSetup } = await import('./twoFactor.ts');
const { base32Decode, hotp, totpStep } = await import('./totp.ts');
const { NO_LOGIN } = await import('./users.ts');
const { LINKED_ACCOUNT_EMAIL_DOMAIN } = await import('./accountLinks.ts');
const { resetLoginRateLimitForTest } = await import('./loginRateLimit.ts');

const app = express();
app.use(express.json());
app.use('/api', attachUser);
app.use('/api', (req, res, next) => (isPublicApiPath(req.path) ? next() : requireAuth(req, res, next)));
app.use('/api/auth', authRouter);
app.use('/api/settings', settingsRouter);
app.use('/api/accounts', accountsRouter);
app.use('/api/account', accountLinksRouter);
app.use('/api/billing', billingRouter);

const server: Server = await new Promise((resolve) => {
  const s = app.listen(0, '127.0.0.1', () => resolve(s));
});
const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;

type Jar = Map<string, string>;
type Json = Record<string, unknown>;
async function call(jar: Jar, method: string, p: string, body?: unknown) {
  const res = await fetch(`${base}${p}`, {
    method,
    headers: { 'content-type': 'application/json', cookie: [...jar].map(([k, v]) => `${k}=${v}`).join('; ') },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  for (const c of res.headers.getSetCookie()) {
    const [kv] = c.split(';');
    const i = kv.indexOf('=');
    const value = kv.slice(i + 1);
    if (value && !/Max-Age=0/.test(c)) jar.set(kv.slice(0, i), value);
    else jar.delete(kv.slice(0, i));
  }
  const text = await res.text();
  let json: Json | null = null;
  try {
    json = text ? (JSON.parse(text) as Json) : null;
  } catch {
    json = null;
  }
  return { status: res.status, json, text };
}

const PASS = 'Link-test-12345';
async function register(email: string, firstName: string, lastName: string) {
  const jar: Jar = new Map();
  const r = await call(jar, 'POST', '/api/auth/register', { email, password: PASS, firstName, lastName });
  check(r.status === 201, `register ${email} (${r.status} ${r.text})`);
  const user = r.json!.user as Json;
  return { jar, id: String(user.id), email };
}

type Party = { id: string; displayName: string | null; usageMode: string; plan: string; isLinkedBusiness: boolean };
type Linked = { id: string; displayName: string | null; businessName: string | null; plan: string; hasOwnLogin: boolean; canUnlink: boolean };
type LinksBody = { current: Party; owner: Party | null; linked: Linked[] };

function linksOf(json: Json | null): LinksBody {
  return json as unknown as LinksBody;
}

const db = await getDb();

try {
  const linkCols = queryAll<{ name: string }>(db, `PRAGMA table_info(account_links)`).map((c) => c.name);
  check(
    ['id', 'owner_user_id', 'linked_user_id', 'created_at'].every((c) => linkCols.includes(c)),
    `account_links columns (${linkCols.join(',')})`,
  );
  const linkSql = String(queryOne<{ sql: string }>(db, `SELECT sql FROM sqlite_master WHERE name = 'account_links'`)?.sql ?? '');
  check(/linked_user_id[^,]*UNIQUE/i.test(linkSql), 'linked_user_id is unique');
  const sessionCols = queryAll<{ name: string }>(db, `PRAGMA table_info(sessions)`).map((c) => c.name);
  check(sessionCols.includes('origin_owner_user_id'), 'sessions.origin_owner_user_id');

  const pat = await register('pat@example.test', 'Pat', 'Ng');
  const bea = await register('bea@example.test', 'Bea', 'Bee');
  const vic = await register('vic@example.test', 'Vic', 'Out');
  check(
    queryOne<{ value: string }>(db, `SELECT value FROM meta WHERE key = 'data_owner_user_id'`)?.value === pat.id,
    'first account stays the data owner',
  );

  const patMe = await call(pat.jar, 'GET', '/api/auth/me');
  const patUser = patMe.json!.user as Json;
  const patActive = patUser.activeAccount as Json;
  check(patMe.json!.activeAccount && (patActive.isLinkedBusiness === false) && patActive.ownerId === null && patActive.id === pat.id, 'personal /me activeAccount');
  check(patUser.usageMode === 'personal', 'unset usage counts as personal');

  const created = await call(pat.jar, 'POST', '/api/account/business', { businessName: 'Koru Honey' });
  check(created.status === 201, `create linked business (${created.status} ${created.text})`);
  const createdAccount = (created.json!.account as Linked);
  const honeyId = createdAccount.id;
  check(createdAccount.businessName === 'Koru Honey' && createdAccount.plan === 'free', 'starter business on the free plan');
  check(createdAccount.hasOwnLogin === false && createdAccount.canUnlink === false, 'created account cannot be unlinked yet');
  check(createdAccount.displayName === 'Pat Ng', 'created account keeps the owner’s name');

  const honeyRow = queryOne<{ email: string; password_hash: string; preferences_json: string; first_name: string }>(
    db,
    `SELECT email, password_hash, preferences_json, first_name FROM users WHERE id = ?`,
    [honeyId],
  );
  check(Boolean(honeyRow?.email.endsWith(`@${LINKED_ACCOUNT_EMAIL_DOMAIN}`)) && honeyRow?.password_hash === NO_LOGIN, 'synthetic email and no-login sentinel');
  const honeyPrefs = JSON.parse(honeyRow!.preferences_json) as { usageMode?: string; runsBusiness?: boolean; starterBusinessCreated?: boolean };
  check(honeyPrefs.usageMode === 'business' && honeyPrefs.runsBusiness === true && honeyPrefs.starterBusinessCreated === true, 'business usage, no second starter later');
  check(
    queryOne<{ name: string }>(db, `SELECT name FROM businesses WHERE user_id = ?`, [honeyId])?.name === 'Koru Honey',
    'business row is the requested name',
  );
  check(planOf(db, honeyId) === 'free' && planOf(db, pat.id) === 'free', 'new account does not copy a plan');
  check(
    Number(queryOne<{ c: number }>(db, `SELECT COUNT(*) AS c FROM account_links WHERE owner_user_id = ? AND linked_user_id = ?`, [pat.id, honeyId])?.c) === 1,
    'one link row',
  );

  const fromPat = linksOf((await call(pat.jar, 'GET', '/api/account/links')).json);
  check(fromPat.owner === null && fromPat.current.id === pat.id && fromPat.current.isLinkedBusiness === false, 'owner list has no parent');
  check(fromPat.linked.length === 1 && fromPat.linked[0].id === honeyId && fromPat.linked[0].hasOwnLogin === false && fromPat.linked[0].canUnlink === false, 'owner list flags');

  const banks = await call(pat.jar, 'GET', '/api/accounts');
  check(banks.status === 200 && Array.isArray(banks.json), 'bank accounts route is not the link route');
  const personalBank = await call(pat.jar, 'POST', '/api/accounts', { name: 'Personal cheque', accountType: 'cheque', balance: 10, currency: 'NZD' });
  check(personalBank.status === 201, `personal bank account (${personalBank.status})`);

  const oldSid = pat.jar.get('pt_sid');
  const toHoney = await call(pat.jar, 'POST', '/api/account/switch', { accountId: honeyId });
  check(toHoney.status === 200, `switch to business (${toHoney.status} ${toHoney.text})`);
  const honeyUser = toHoney.json!.user as Json;
  const honeyActive = honeyUser.activeAccount as Json;
  check(honeyUser.id === honeyId && honeyUser.email === null && honeyActive.isLinkedBusiness === true && honeyActive.hasOwnLogin === false && honeyActive.ownerId === pat.id, 'switch response hides the synthetic email');
  check(!toHoney.text.includes(LINKED_ACCOUNT_EMAIL_DOMAIN), 'switch body has no synthetic address');
  const honeyMe = await call(pat.jar, 'GET', '/api/auth/me');
  check((honeyMe.json!.user as Json).email === null && (honeyMe.json!.activeAccount as Json).hasOwnLogin === false, '/me hides the synthetic email');
  check(!honeyMe.text.includes(LINKED_ACCOUNT_EMAIL_DOMAIN), '/me body has no synthetic address');
  check((toHoney.json!.activeAccount as Json).id === honeyId, 'switch activeAccount matches');
  check(pat.jar.get('pt_sid') !== oldSid, 'session cookie rotated');

  const stale = await call(new Map([['pt_sid', oldSid!]]), 'GET', '/api/auth/me');
  check((stale.json!.user as Json | null) == null, 'old session no longer authenticates');
  const honeySession = queryOne<{ origin_owner_user_id: string | null }>(
    db,
    `SELECT origin_owner_user_id FROM sessions WHERE user_id = ?`,
    [honeyId],
  );
  check(honeySession?.origin_owner_user_id === pat.id, 'session remembers the personal owner');
  check(!queryOne(db, `SELECT id FROM sessions WHERE user_id = ?`, [pat.id]), 'owner session was rotated away');
  check(
    Number(queryOne<{ c: number }>(db, `SELECT COUNT(*) AS c FROM auth_events WHERE user_id = ? AND kind = 'account_switch'`, [honeyId])?.c) >= 1,
    'audit log records the switch',
  );

  const fromHoney = linksOf((await call(pat.jar, 'GET', '/api/account/links')).json);
  check(fromHoney.current.id === honeyId && fromHoney.current.isLinkedBusiness === true && fromHoney.current.canUnlink === false, 'list current is the business without a login');
  check(fromHoney.owner?.id === pat.id && fromHoney.owner.usageMode === 'personal' && fromHoney.linked.length === 0, 'business sees its owner and no children');

  const honeyBanks = (await call(pat.jar, 'GET', '/api/accounts')).json as { name?: string }[];
  check(Array.isArray(honeyBanks) && honeyBanks.every((a) => a.name !== 'Personal cheque'), 'switched session does not see the personal bank account');
  const shop = await call(pat.jar, 'POST', '/api/accounts', { name: 'Shop till', accountType: 'cheque', balance: 4, currency: 'NZD' });
  check(shop.status === 201, `business bank account (${shop.status} ${shop.text})`);

  const back = await call(pat.jar, 'POST', '/api/account/switch', { accountId: pat.id });
  check(back.status === 200 && (back.json!.user as Json).id === pat.id, 'switch back to the owner without a password');
  const backActive = (back.json!.user as Json).activeAccount as Json;
  check(backActive.isLinkedBusiness === false && backActive.ownerId === null, 'owner activeAccount after switch back');
  const patSession = queryOne<{ origin_owner_user_id: string | null }>(db, `SELECT origin_owner_user_id FROM sessions WHERE user_id = ?`, [pat.id]);
  check(patSession?.origin_owner_user_id == null, 'owner session has no origin owner');
  check(!queryOne(db, `SELECT id FROM sessions WHERE user_id = ?`, [honeyId]), 'business session rotated away');
  const patBanks = (await call(pat.jar, 'GET', '/api/accounts')).json as { name?: string }[];
  check(patBanks.length === 1 && patBanks[0].name === 'Personal cheque', 'owner does not see the business bank account');
  await call(pat.jar, 'POST', '/api/account/switch', { accountId: honeyId });
  const shopBanks = (await call(pat.jar, 'GET', '/api/accounts')).json as { name?: string }[];
  check(shopBanks.length === 1 && shopBanks[0].name === 'Shop till', 'business still has only its own account');
  await call(pat.jar, 'POST', '/api/account/switch', { accountId: pat.id });

  const refused = await call(pat.jar, 'POST', '/api/account/switch', { accountId: vic.id });
  check(refused.status === 403 && refused.json!.code === 'SWITCH_NOT_ALLOWED', 'non-linked switch refused');
  check((await call(pat.jar, 'GET', '/api/auth/me')).json!.user && ((await call(pat.jar, 'GET', '/api/auth/me')).json!.user as Json).id === pat.id, 'refused switch leaves the session');

  const vicLinks = linksOf((await call(vic.jar, 'GET', '/api/account/links')).json);
  check(vicLinks.linked.length === 0 && vicLinks.owner === null, 'another user does not see the link');

  setPlan(db, pat.id, 'plus');
  check(planOf(db, pat.id) === 'plus' && planOf(db, honeyId) === 'free', 'planOf does not read the other account');
  const plans = linksOf((await call(pat.jar, 'GET', '/api/account/links')).json);
  check(plans.current.plan === 'plus' && plans.linked[0].plan === 'free', 'list shows each account’s own plan');

  // Billing: fake Stripe. Live mode stays off.
  process.env.STRIPE_SECRET_KEY = 'sk_test_linked_accounts';
  process.env.STRIPE_WEBHOOK_SECRET = 'whsec_linked_accounts';
  delete process.env.STRIPE_LIVE_ENABLED;
  const cfg = billingConfig();
  check(cfg.ok && cfg.config.live === false, 'test key, live stays off');
  type FakeSub = { id: string; customer: string; status: string; lookupKey: string; metadata: Record<string, string> };
  const subs = new Map<string, FakeSub>();
  const checkoutCalls: Record<string, unknown>[] = [];
  const createdCustomers: { id: string; email?: string; metadata?: { user_id?: string } }[] = [];
  const stripeCancels: string[] = [];
  let failStripeCancel = false;
  const fake = {
    customers: {
      create: async (params: { email?: string; metadata?: { user_id?: string } }) => {
        const row = { id: `cus_${createdCustomers.length + 1}`, email: params.email, metadata: params.metadata };
        createdCustomers.push(row);
        return row;
      },
    },
    prices: {
      list: async ({ lookup_keys }: { lookup_keys: string[] }) => ({ data: [{ id: `price_${lookup_keys[0]}`, lookup_key: lookup_keys[0] }] }),
    },
    checkout: {
      sessions: {
        create: async (params: Record<string, unknown>) => {
          checkoutCalls.push(params);
          return { url: 'https://checkout.stripe.test/cs_1', id: 'cs_1' };
        },
      },
    },
    subscriptions: {
      cancel: async (id: string) => {
        stripeCancels.push(id);
        if (failStripeCancel) throw new Error('stripe down');
        return { id, status: 'canceled' };
      },
      retrieve: async (id: string) => {
        const s = subs.get(id);
        if (!s) throw new Error(`missing ${id}`);
        return {
          id: s.id,
          customer: s.customer,
          status: s.status,
          livemode: false,
          metadata: s.metadata,
          cancel_at_period_end: false,
          cancel_at: null,
          items: { data: [{ current_period_end: 1_800_000_000, price: { lookup_key: s.lookupKey } }] },
        };
      },
    },
  };
  setStripeClientForTests(fake as never);

  await call(pat.jar, 'POST', '/api/account/switch', { accountId: honeyId });
  const honeyCheckout = await call(pat.jar, 'POST', '/api/billing/checkout', { plan: 'business', interval: 'month' });
  check(honeyCheckout.status === 200 && honeyCheckout.json!.url === 'https://checkout.stripe.test/cs_1', `linked business checkout (${honeyCheckout.status} ${honeyCheckout.text})`);
  const honeyParams = checkoutCalls[0] as { customer?: string; client_reference_id?: string; subscription_data?: { metadata?: { user_id?: string } }; line_items?: { price: string }[] };
  check(honeyParams.client_reference_id === honeyId && honeyParams.subscription_data?.metadata?.user_id === honeyId, 'checkout is tagged with the business user');
  check(honeyParams.line_items?.[0].price === 'price_koruledger_business_monthly', 'Business monthly NZD price');
  check(createdCustomers[0].metadata?.user_id === honeyId && createdCustomers[0].email == null, 'Stripe customer has metadata and no synthetic email');
  check(userIdForCustomer(db, createdCustomers[0].id) === honeyId, 'customer row maps to the business user');

  await call(pat.jar, 'POST', '/api/account/switch', { accountId: pat.id });
  const beforePersonal = checkoutCalls.length;
  const personalBiz = await call(pat.jar, 'POST', '/api/billing/checkout', { plan: 'business', interval: 'year' });
  check(personalBiz.status === 403 && personalBiz.json!.code === 'BUSINESS_PLAN_REQUIRES_BUSINESS_ACCOUNT', 'personal still cannot buy Business');
  check(checkoutCalls.length === beforePersonal, 'refused checkout does not open Stripe');
  const personalPlus = await call(pat.jar, 'POST', '/api/billing/checkout', { plan: 'plus', interval: 'month' });
  check(personalPlus.status === 200, `personal plus checkout (${personalPlus.status} ${personalPlus.text})`);
  check(createdCustomers[1].metadata?.user_id === pat.id && createdCustomers[1].id !== createdCustomers[0].id, 'personal Stripe customer is a different user');

  subs.set('sub_honey', { id: 'sub_honey', customer: createdCustomers[0].id, status: 'active', lookupKey: 'koruledger_business_monthly', metadata: {} });
  if (!cfg.ok) throw new Error('billing config');
  await handleBillingEvent(db, cfg.config, { type: 'customer.subscription.created', livemode: false, data: { object: { id: 'sub_honey' } } } as Stripe.Event);
  check(planOf(db, honeyId) === 'business' && planOf(db, pat.id) === 'plus', 'webhook grants Business only to the mapped customer');
  check(grantingSubscriptions(db, pat.id).every((s) => s.plan !== 'business'), 'owner subscriptions do not include the business price');

  subs.set('sub_pat', { id: 'sub_pat', customer: createdCustomers[1].id, status: 'active', lookupKey: 'koruledger_plus_monthly', metadata: {} });
  await handleBillingEvent(db, cfg.config, { type: 'customer.subscription.updated', livemode: false, data: { object: { id: 'sub_pat' } } } as Stripe.Event);
  check(planOf(db, pat.id) === 'plus' && planOf(db, honeyId) === 'business', 'each webhook stays on its own user');
  check(userIdForCustomer(db, createdCustomers[0].id) === honeyId && userIdForCustomer(db, createdCustomers[1].id) === pat.id, 'customer map unchanged');
  const subRows = queryAll<{ user_id: string; plan: string }>(db, `SELECT user_id, plan FROM billing_subscriptions ORDER BY plan`);
  check(subRows.some((r) => r.user_id === honeyId && r.plan === 'business') && subRows.some((r) => r.user_id === pat.id && r.plan === 'plus'), 'subscription rows are per user');

  const both = await call(pat.jar, 'PUT', '/api/settings/usage-mode', { mode: 'both' });
  check(both.status === 200 && both.json!.usageMode === 'both', 'both may own links');
  const second = await call(pat.jar, 'POST', '/api/account/business', { businessName: 'Second Shop' });
  check(second.status === 201, `second business (${second.status} ${second.text})`);
  const secondId = (second.json!.account as Linked).id;
  await call(pat.jar, 'POST', '/api/account/switch', { accountId: secondId });
  const sibling = await call(pat.jar, 'POST', '/api/account/switch', { accountId: honeyId });
  check(sibling.status === 403 && sibling.json!.code === 'SWITCH_NOT_ALLOWED', 'cannot switch from one linked business to another');
  const backFromSecond = await call(pat.jar, 'POST', '/api/account/switch', { accountId: pat.id });
  check(backFromSecond.status === 200, 'linked business switches back to the owner');
  const ownerSid = pat.jar.get('pt_sid');
  run(db, `DELETE FROM users WHERE id = ?`, [secondId]);
  const missingUser = await call(pat.jar, 'POST', '/api/account/switch', { accountId: secondId });
  check(missingUser.status === 404 && missingUser.json!.code === 'NOT_FOUND', 'missing target does not switch');
  check(pat.jar.get('pt_sid') === ownerSid && queryOne(db, `SELECT id FROM sessions WHERE user_id = ?`, [pat.id]), 'failed switch leaves the original session');

  const wrong = await call(pat.jar, 'POST', '/api/account/links', { email: bea.email, password: 'not-the-password' });
  check(wrong.status === 401 && wrong.json!.code === 'INVALID_CREDENTIALS', 'wrong password refused');
  check(!queryOne(db, `SELECT id FROM account_links WHERE linked_user_id = ?`, [bea.id]), 'wrong password does not link');
  const notBiz = await call(pat.jar, 'POST', '/api/account/links', { email: vic.email, password: PASS });
  check(notBiz.status === 403 && notBiz.json!.code === 'NOT_BUSINESS_ACCOUNT', 'personal account cannot be linked');
  await call(bea.jar, 'PUT', '/api/settings/usage-mode', { mode: 'business' });
  const linked = await call(pat.jar, 'POST', '/api/account/links', { email: bea.email, password: PASS });
  check(linked.status === 200, `link existing business (${linked.status} ${linked.text})`);
  const beaItem = linksOf(linked.json!.links as Json).linked.find((l) => l.id === bea.id);
  check(Boolean(beaItem && beaItem.hasOwnLogin && beaItem.canUnlink && beaItem.plan === 'free'), 'linked existing account can be unlinked');
  const beaView = linksOf((await call(bea.jar, 'GET', '/api/account/links')).json);
  check(beaView.owner?.id === pat.id && beaView.owner.canUnlink === false && beaView.current.isLinkedBusiness === true && beaView.current.canUnlink === true && beaView.linked.length === 0, 'existing business lists its owner and can unlink itself');
  const toBea = await call(pat.jar, 'POST', '/api/account/switch', { accountId: bea.id });
  check(toBea.status === 200 && (toBea.json!.user as Json).id === bea.id, 'switch to a linked existing account');
  check((await call(pat.jar, 'POST', '/api/account/switch', { accountId: pat.id })).status === 200, 'switch back from the linked account');

  const nia = await register('nia@example.test', 'Nia', 'Ng');
  const stolen = await call(nia.jar, 'POST', '/api/account/links', { email: bea.email, password: PASS });
  check(stolen.status === 409 && stolen.json!.code === 'ALREADY_LINKED', 'already linked to one owner');

  run(db, `UPDATE users SET totp_secret_enc = 'sealed', totp_enabled_at = ? WHERE id = ?`, [new Date().toISOString(), bea.id]);
  const patSid = pat.jar.get('pt_sid');
  const twoFactorSwitch = await call(pat.jar, 'POST', '/api/account/switch', { accountId: bea.id });
  check(twoFactorSwitch.status === 403 && twoFactorSwitch.json!.code === 'TWO_FACTOR_REQUIRED', 'cannot switch into a business with 2FA');
  check(pat.jar.get('pt_sid') === patSid && ((await call(pat.jar, 'GET', '/api/auth/me')).json!.user as Json).id === pat.id, 'refused 2FA switch keeps the owner session');
  run(db, `UPDATE users SET totp_secret_enc = NULL, totp_enabled_at = NULL WHERE id = ?`, [bea.id]);
  const selfFromBea = await call(bea.jar, 'DELETE', `/api/account/links/${bea.id}`);
  check(selfFromBea.status === 200 && !linksOf(selfFromBea.json!.links as Json).owner, 'linked business with a login unlinks itself');
  check((await call(pat.jar, 'POST', '/api/account/links', { email: bea.email, password: PASS })).status === 200, 'owner can link the business again');
  const setup = beginTotpSetup(db, bea.id, bea.email);
  const enabled = confirmTotpSetup(db, bea.id, hotp(base32Decode(setup.secret)!, totpStep()));
  check(enabled.ok === true && !queryOne(db, `SELECT id FROM account_links WHERE linked_user_id = ?`, [bea.id]), 'turning 2FA on removes the link');
  check((await call(pat.jar, 'POST', '/api/account/switch', { accountId: bea.id })).json!.code === 'SWITCH_NOT_ALLOWED', 'no link left to switch into');
  const relink = await call(pat.jar, 'POST', '/api/account/links', { email: bea.email, password: PASS });
  check(relink.status === 403 && relink.json!.code === 'TWO_FACTOR_REQUIRED', 'cannot re-link while 2FA is on');

  await call(pat.jar, 'POST', '/api/account/switch', { accountId: honeyId });
  const selfUnlink = await call(pat.jar, 'DELETE', `/api/account/links/${honeyId}`);
  check(selfUnlink.status === 409 && selfUnlink.json!.code === 'LINKED_ACCOUNT_HAS_NO_LOGIN', 'a no-login business cannot unlink itself');
  await call(pat.jar, 'POST', '/api/account/switch', { accountId: pat.id });
  const blockedUnlink = await call(pat.jar, 'DELETE', `/api/account/links/${honeyId}`);
  check(blockedUnlink.status === 409 && blockedUnlink.json!.code === 'LINKED_ACCOUNT_HAS_NO_LOGIN', 'no-login account cannot be unlinked');

  await call(pat.jar, 'POST', '/api/account/switch', { accountId: honeyId });
  const setPw = await call(pat.jar, 'POST', '/api/auth/change-password', { newPassword: 'Honey-login-123' });
  check(setPw.status === 200, `set a password on the created account (${setPw.status} ${setPw.text})`);
  await call(pat.jar, 'POST', '/api/account/switch', { accountId: pat.id });
  const afterPw = linksOf((await call(pat.jar, 'GET', '/api/account/links')).json).linked.find((l) => l.id === honeyId);
  check(Boolean(afterPw?.hasOwnLogin && afterPw.canUnlink), 'canUnlink once it has a login');
  const signedInHoney = await call(pat.jar, 'POST', '/api/account/switch', { accountId: honeyId });
  check((signedInHoney.json!.user as Json).email === null && (signedInHoney.json!.activeAccount as Json).hasOwnLogin === true, 'a login does not reveal the synthetic email');
  const downloaded = await call(pat.jar, 'GET', '/api/auth/export');
  check(downloaded.status === 200 && !downloaded.text.includes(LINKED_ACCOUNT_EMAIL_DOMAIN), 'account download omits the synthetic address');
  check((downloaded.json!.profile as Json).email === null, 'download profile email is null');
  check((await call(pat.jar, 'POST', '/api/account/switch', { accountId: pat.id })).status === 200, 'back to the owner before unlink');
  const honeyEmail = queryOne<{ email: string }>(db, `SELECT email FROM users WHERE id = ?`, [honeyId])!.email;
  const direct = new Map<string, string>();
  check((await call(direct, 'POST', '/api/auth/login', { email: honeyEmail, password: 'Honey-login-123' })).status === 200, 'business signs in with its own password');
  const directSwitch = await call(direct, 'POST', '/api/account/switch', { accountId: pat.id });
  check(directSwitch.status === 403 && directSwitch.json!.code === 'SWITCH_NOT_ALLOWED', 'own-login session cannot switch to the owner');
  check(((await call(direct, 'GET', '/api/auth/me')).json!.user as Json).id === honeyId, 'refused switch leaves the business signed in');
  check((await call(pat.jar, 'POST', '/api/account/switch', { accountId: honeyId })).status === 200, 'owner can still switch in');
  check((await call(pat.jar, 'POST', '/api/account/switch', { accountId: pat.id })).status === 200, 'owner-originated session can switch back');

  const switchedByOwner = new Map<string, string>();
  check((await call(pat.jar, 'POST', '/api/account/switch', { accountId: honeyId })).status === 200, 'switch in to capture the session');
  switchedByOwner.set('pt_sid', pat.jar.get('pt_sid')!);
  check((await call(pat.jar, 'POST', '/api/account/switch', { accountId: pat.id })).status === 200, 'owner returns');
  const unlinked = await call(pat.jar, 'DELETE', `/api/account/links/${honeyId}`);
  check(unlinked.status === 200 && unlinked.json!.ok === true, 'owner unlinks');
  check(!linksOf(unlinked.json!.links as Json).linked.some((l) => l.id === honeyId), 'unlinked account leaves the list');
  check((await call(switchedByOwner, 'GET', '/api/accounts')).status === 401, 'owner-switched session dies when the owner unlinks');
  const orphan = await createSession(honeyId, { originOwnerUserId: pat.id });
  check((await call(new Map([['pt_sid', orphan.rawToken]]), 'GET', '/api/accounts')).status === 401, 'a switched-in session with no link is destroyed');
  check(!queryOne(db, `SELECT id FROM sessions WHERE id = ?`, [orphan.id]), 'orphan switch session row is gone');

  check((await call(pat.jar, 'POST', '/api/account/links', { email: honeyEmail, password: 'Honey-login-123' })).status === 200, 'relink honey');
  const switchedForSelf = new Map<string, string>();
  check((await call(pat.jar, 'POST', '/api/account/switch', { accountId: honeyId })).status === 200, 'switch in before self-unlink');
  switchedForSelf.set('pt_sid', pat.jar.get('pt_sid')!);
  check((await call(pat.jar, 'POST', '/api/account/switch', { accountId: pat.id })).status === 200, 'owner returns before self-unlink');
  check((await call(direct, 'DELETE', `/api/account/links/${honeyId}`)).status === 200, 'business unlinks itself');
  check((await call(switchedForSelf, 'GET', '/api/accounts')).status === 401, 'owner-switched session dies when the business unlinks');

  check((await call(pat.jar, 'POST', '/api/account/links', { email: honeyEmail, password: 'Honey-login-123' })).status === 200, 'relink honey for 2FA');
  const switchedFor2fa = new Map<string, string>();
  check((await call(pat.jar, 'POST', '/api/account/switch', { accountId: honeyId })).status === 200, 'switch in before 2FA');
  switchedFor2fa.set('pt_sid', pat.jar.get('pt_sid')!);
  check((await call(pat.jar, 'POST', '/api/account/switch', { accountId: pat.id })).status === 200, 'owner returns before 2FA');
  const honeySetup = beginTotpSetup(db, honeyId, honeyEmail);
  const honeyEnabled = confirmTotpSetup(db, honeyId, hotp(base32Decode(honeySetup.secret)!, totpStep()));
  check(honeyEnabled.ok === true, '2FA enabled on the linked business');
  check((await call(switchedFor2fa, 'GET', '/api/accounts')).status === 401, 'owner-switched session dies when 2FA is enabled');
  check(((await call(pat.jar, 'GET', '/api/auth/me')).json!.user as Json).id === pat.id, 'owner session is untouched by 2FA on the business');

  resetLoginRateLimitForTest();
  let limited = 0;
  for (let i = 0; i < 10; i++) {
    const attempt = await call(pat.jar, 'POST', '/api/account/links', { email: 'nobody-rate@example.test', password: 'nope-1234' });
    if (attempt.status === 401) limited++;
  }
  const blocked = await call(pat.jar, 'POST', '/api/account/links', { email: 'nobody-rate@example.test', password: 'nope-1234' });
  check(limited === 10 && blocked.status === 429 && blocked.json!.code === 'TOO_MANY_ATTEMPTS', 'link endpoint rate limit matches login');

  const bizOnly = await register('bizonly@example.test', 'Biz', 'Only');
  await call(bizOnly.jar, 'PUT', '/api/settings/usage-mode', { mode: 'business' });
  const bizCreate = await call(bizOnly.jar, 'POST', '/api/account/business', { businessName: 'Nope' });
  check(bizCreate.status === 403 && bizCreate.json!.code === 'NOT_PERSONAL_ACCOUNT', 'business-only cannot create a linked account');

  const max = await register('max@example.test', 'Max', 'Owner');
  for (let i = 0; i < 5; i++) {
    const made = await call(max.jar, 'POST', '/api/account/business', { businessName: `Shop ${i + 1}` });
    check(made.status === 201, `cap slot ${i + 1} (${made.status} ${made.text})`);
  }
  const over = await call(max.jar, 'POST', '/api/account/business', { businessName: 'Shop 6' });
  check(over.status === 409 && over.json!.code === 'LINK_LIMIT', 'sixth business refused');

  const del = await register('del@example.test', 'Del', 'Owner');
  const dee = await register('dee@example.test', 'Dee', 'Books');
  await call(dee.jar, 'PUT', '/api/settings/usage-mode', { mode: 'business' });
  const deeBank = await call(dee.jar, 'POST', '/api/accounts', { name: 'Dee trading', accountType: 'cheque', balance: 20, currency: 'NZD' });
  check(deeBank.status === 201, 'dee bank account');
  const made = await call(del.jar, 'POST', '/api/account/business', { businessName: 'Del Honey' });
  check(made.status === 201, 'del creates a business');
  const delChild = (made.json!.account as Linked).id;
  check((await call(del.jar, 'POST', '/api/account/links', { email: dee.email, password: PASS })).status === 200, 'del links dee');
  const removed = await call(del.jar, 'POST', '/api/auth/delete-account', { password: PASS, confirm: 'DELETE' });
  check(removed.status === 200, `delete personal account (${removed.status} ${removed.text})`);
  const deleted = removed.json!.deleted as Json;
  const detached = (deleted.linkedAccountsDetached as string[]) ?? [];
  const marked = (deleted.linkedAccountsMarkedForDeletion as string[]) ?? [];
  const purgedNow = (deleted.linkedAccountsPurged as string[]) ?? [];
  check(detached.includes(delChild) && detached.includes(dee.id), 'both links are removed');
  check(marked.includes(delChild) && !marked.includes(dee.id), 'only the no-login business is marked');
  check(purgedNow.length === 0, 'delete response does not wait for the purge');
  await settleMarkedLinkedAccounts(db, [delChild]);
  check(!queryOne(db, `SELECT id FROM users WHERE id = ?`, [del.id]), 'personal user row is gone');
  check(!queryOne(db, `SELECT id FROM users WHERE id = ?`, [delChild]), 'purged business user is gone');
  check(!queryOne(db, `SELECT id FROM businesses WHERE user_id = ?`, [delChild]), 'purged business books are gone');
  check(!queryOne(db, `SELECT id FROM account_links WHERE owner_user_id = ? OR linked_user_id IN (?, ?)`, [del.id, delChild, dee.id]), 'links removed');
  const deePrefs = JSON.parse(queryOne<{ preferences_json: string }>(db, `SELECT preferences_json FROM users WHERE id = ?`, [dee.id])!.preferences_json) as {
    pendingDeletion?: unknown;
  };
  check(deePrefs.pendingDeletion == null, 'login-capable business is not marked for deletion');
  check(Boolean(queryOne(db, `SELECT id FROM bank_accounts WHERE user_id = ? AND name = 'Dee trading'`, [dee.id])), 'linked account books kept');
  const deeLogin = await call(new Map(), 'POST', '/api/auth/login', { email: dee.email, password: PASS });
  check(deeLogin.status === 200, 'login-capable business can still sign in');
  check((await call(pat.jar, 'GET', '/api/auth/me')).json && ((await call(pat.jar, 'GET', '/api/auth/me')).json!.user as Json).id === pat.id, 'other users stay signed in');
  check(queryOne<{ value: string }>(db, `SELECT value FROM meta WHERE key = 'data_owner_user_id'`)?.value === pat.id, 'data owner unchanged');
  check(process.env.STRIPE_LIVE_ENABLED == null, 'STRIPE_LIVE_ENABLED stays unset');

  process.env.RESEND_API_KEY = 're_test';
  process.env.INVOICE_EMAIL_FROM = 'hello@mail.example.test';
  const postedTo: string[] = [];
  setEmailFetchForTest(async (_url, init) => {
    const body = JSON.parse(String(init?.body ?? '{}')) as { to?: string[]; reply_to?: string };
    postedTo.push(...(body.to ?? []));
    check(body.reply_to == null || !String(body.reply_to).includes(LINKED_ACCOUNT_EMAIL_DOMAIN), 'reply-to is not synthetic');
    return { ok: true, status: 200, json: async () => ({ id: 'msg_1' }) };
  });
  const honeyAddress = queryOne<{ email: string }>(db, `SELECT email FROM users WHERE id = ?`, [honeyId])!.email;
  const skipped = await sendEmail({
    fromName: 'KoruLedger',
    replyTo: honeyAddress,
    to: [honeyAddress],
    subject: 'skip',
    text: 'skip',
    html: 'skip',
    attachment: null,
    idempotencyKey: 'skip-synthetic',
  });
  check(skipped.ok === true && postedTo.length === 0, 'mail to the synthetic address is not sent');
  const mixed = await sendEmail({
    fromName: 'KoruLedger',
    replyTo: honeyAddress,
    to: ['person@example.test', honeyAddress],
    subject: 'mixed',
    text: 'mixed',
    html: 'mixed',
    attachment: null,
    idempotencyKey: 'mixed-synthetic',
  });
  check(mixed.ok === true && postedTo.join() === 'person@example.test', 'only a real recipient is sent');
  setEmailFetchForTest(null);
  delete process.env.RESEND_API_KEY;
  delete process.env.INVOICE_EMAIL_FROM;

  const bill = await register('bill@example.test', 'Bill', 'Owner');
  const withSub = (await call(bill.jar, 'POST', '/api/account/business', { businessName: 'Billed Shop' })).json!.account as Linked;
  const liveOnly = (await call(bill.jar, 'POST', '/api/account/business', { businessName: 'Live Shop' })).json!.account as Linked;
  saveSubscription(db, {
    id: 'sub_marked',
    userId: withSub.id,
    customerId: 'cus_marked',
    plan: 'business',
    interval: 'month',
    status: 'active',
    cancelAtPeriodEnd: false,
    currentPeriodEnd: null,
    live: false,
  });
  saveSubscription(db, {
    id: 'sub_live_only',
    userId: liveOnly.id,
    customerId: 'cus_live_only',
    plan: 'business',
    interval: 'month',
    status: 'active',
    cancelAtPeriodEnd: false,
    currentPeriodEnd: null,
    live: true,
  });
  failStripeCancel = true;
  const beforeCancels = stripeCancels.length;
  const billGone = await call(bill.jar, 'POST', '/api/auth/delete-account', { password: PASS, confirm: 'DELETE' });
  check(billGone.status === 200, `personal deletion proceeds when Stripe cancel fails (${billGone.status} ${billGone.text})`);
  check(stripeCancels.includes('sub_marked') && !stripeCancels.includes('sub_live_only'), 'test-mode subscription is cancelled; live mode is not, while the key is a test key');
  check(stripeCancels.length === beforeCancels + 1, 'one cancel attempt');
  check(Boolean(queryOne(db, `SELECT id FROM users WHERE id = ?`, [withSub.id])), 'failed cancel leaves the marked user');
  check(!((billGone.json!.deleted as Json).linkedAccountsPurged as string[]).includes(withSub.id), 'failed cancel does not purge');
  check(!((billGone.json!.deleted as Json).linkedAccountsPurged as string[]).includes(liveOnly.id), 'live subscription blocks purge');
  const stillWaiting = await settleMarkedLinkedAccounts(db);
  check(stillWaiting.waiting.includes(withSub.id) && stillWaiting.waiting.includes(liveOnly.id) && stripeCancels.filter((id) => id === 'sub_marked').length === 2, 'sweep retries the failed cancel');
  failStripeCancel = false;
  const settled = await settleMarkedLinkedAccounts(db);
  check(settled.purged.includes(withSub.id) && !queryOne(db, `SELECT id FROM users WHERE id = ?`, [withSub.id]), 'sweep purges after cancel succeeds');
  check(settled.waiting.includes(liveOnly.id) && Boolean(queryOne(db, `SELECT id FROM users WHERE id = ?`, [liveOnly.id])), 'live subscription still blocks purge');
  check(!stripeCancels.includes('sub_live_only'), 'live subscription is never sent to the test-mode client');

  const parked = await register('park@example.test', 'Park', 'Owner');
  const unpaidBiz = (await call(parked.jar, 'POST', '/api/account/business', { businessName: 'Unpaid Shop' })).json!.account as Linked;
  const goneBiz = (await call(parked.jar, 'POST', '/api/account/business', { businessName: 'Gone Shop' })).json!.account as Linked;
  saveSubscription(db, {
    id: 'sub_unpaid',
    userId: unpaidBiz.id,
    customerId: 'cus_unpaid',
    plan: 'business',
    interval: 'month',
    status: 'unpaid',
    cancelAtPeriodEnd: false,
    currentPeriodEnd: null,
    live: false,
  });
  saveSubscription(db, {
    id: 'sub_missing',
    userId: goneBiz.id,
    customerId: 'cus_missing',
    plan: 'business',
    interval: 'month',
    status: 'paused',
    cancelAtPeriodEnd: false,
    currentPeriodEnd: null,
    live: false,
  });
  const missingError = Object.assign(new Error('No such subscription'), { code: 'resource_missing' });
  fake.subscriptions.cancel = async (id: string) => {
    stripeCancels.push(id);
    if (id === 'sub_missing') throw missingError;
    return { id, status: 'canceled' };
  };
  check((await call(parked.jar, 'POST', '/api/auth/delete-account', { password: PASS, confirm: 'DELETE' })).status === 200, 'owner of non-terminal subs deletes');
  await settleMarkedLinkedAccounts(db, [unpaidBiz.id, goneBiz.id]);
  check(stripeCancels.includes('sub_unpaid') && !queryOne(db, `SELECT id FROM users WHERE id = ?`, [unpaidBiz.id]), 'unpaid subscription is cancelled and the user is purged');
  check(stripeCancels.includes('sub_missing') && !queryOne(db, `SELECT id FROM users WHERE id = ?`, [goneBiz.id]), 'resource_missing counts as canceled and the user is purged');
} finally {
  setStripeClientForTests(null);
  server.close();
  fs.rmSync(tmp, { recursive: true, force: true });
}

console.log(`account links: ${passed} checks passed`);
