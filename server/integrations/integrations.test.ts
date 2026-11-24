/**
 * Invoice payment providers (KAN-73): connecting (Paddle key sealed, sandbox only), creating an
 * invoice in the provider, signed webhooks (Stripe Connect and Paddle) marking it paid with income,
 * idempotent events, user isolation, sync now. Providers are faked; signatures are real.
 * Run: npm run test:integrations
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createHmac } from 'node:crypto';
import type { AddressInfo } from 'node:net';
import type { Server } from 'node:http';
import express from 'express';
import Stripe from 'stripe';

function eq(actual: unknown, expected: unknown, msg: string): void {
  if (JSON.stringify(actual) !== JSON.stringify(expected)) throw new Error(`FAIL: ${msg} (got ${JSON.stringify(actual)}, expected ${JSON.stringify(expected)})`);
}

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'pt-integrations-'));
process.env.DATABASE_PATH = path.join(dir, 'portfolio.db');
process.env.NODE_ENV = 'test';
process.env.STRIPE_SECRET_KEY = 'sk_test_fake';
process.env.STRIPE_CONNECT_CLIENT_ID = 'ca_test';
process.env.STRIPE_CONNECT_WEBHOOK_SECRET = 'whsec_test_connect';

const { getDb, queryAll, queryOne, run } = await import('../db/index.ts');
const { seedCategoriesForUser } = await import('../lib/categories.ts');
const { parseInvoice } = await import('../invoices/model.ts');
const { createInvoice, markSent, getInvoice, getBusinessProfile, saveBusinessProfile } = await import('../invoices/store.ts');
const { saveConnection, getConnection } = await import('./store.ts');
const { verifyPaddleSignature, stripeEventStatus, paddleMode, setPaddleFetchForTest } = await import('./providers.ts');
const { createSession, SESSION_COOKIE } = await import('../auth/sessions.ts');
const { attachUser } = await import('../middleware/requireAuth.ts');
const routes = await import('../routes/integrations.ts');

// Signatures and mapping.
const body = Buffer.from('{"a":1}');
const ts = Math.floor(Date.now() / 1000);
const sig = (secret: string, t = ts, b = body) => `ts=${t};h1=${createHmac('sha256', secret).update(`${t}:`).update(b).digest('hex')}`;
eq(verifyPaddleSignature(sig('s3cret'), body, 's3cret'), true, 'Paddle signature ok');
eq(verifyPaddleSignature(sig('wrong'), body, 's3cret'), false, 'wrong secret');
eq(verifyPaddleSignature(sig('s3cret', ts - 600), body, 's3cret'), false, 'stale');
eq(verifyPaddleSignature(sig('s3cret'), Buffer.from('{"a":2}'), 's3cret'), false, 'tampered body');
eq(stripeEventStatus({ type: 'invoice.paid', data: { object: { id: 'in_1', status_transitions: { paid_at: 1_800_000_000 } } } })?.status, 'paid', 'invoice.paid');
eq(stripeEventStatus({ type: 'customer.created', data: { object: { id: 'cus' } } }), null, 'other events ignored');
eq([paddleMode('pdl_sdbx_abc'), paddleMode('pdl_live_abc'), paddleMode('nope')], ['test', null, null], 'sandbox keys only');

const db = await getDb();
const now = new Date().toISOString();
const TODAY = new Date().toISOString().slice(0, 10);
for (const [id, email] of [['ua', 'ua@example.com'], ['ub', 'ub@example.com']]) {
  run(db, `INSERT INTO users (id, email, password_hash, created_at, updated_at) VALUES (?,?,?,?,?)`, [id, email, 'h', now, now]);
  seedCategoriesForUser(db, id);
  saveBusinessProfile(db, id, { ...getBusinessProfile(db, id), businessName: `${id} Ltd` });
}
function sentInvoice(user: string, client: string) {
  const d = parseInvoice({ clientName: client, clientEmail: 'pay@client.nz', lines: [{ description: 'Work', quantity: 1, rate: 230 }] }, TODAY);
  if (!d.ok) throw new Error(d.error);
  const c = createInvoice(db, user, d.value, TODAY);
  if (!c.ok) throw new Error(c.error);
  const s = markSent(db, user, c.value.id, TODAY);
  if (!s.ok) throw new Error(s.error);
  return s.value;
}
const invA = sentInvoice('ua', 'Acme');
const invB = sentInvoice('ub', 'Bobco');

// Paddle key sealed at rest.
saveConnection(db, 'ua', 'paddle', 'paddle', 'test', { apiKey: 'pdl_sdbx_secretkey', webhookSecret: 'paddle-whsec' });
eq(JSON.stringify(queryAll(db, 'SELECT * FROM payment_connections')).includes('pdl_sdbx_secretkey'), false, 'API key never stored in the clear');
eq(getConnection(db, 'ua', 'paddle')?.apiKey, 'pdl_sdbx_secretkey', 'opened for use');
saveConnection(db, 'ua', 'stripe', 'acct_A', 'test');
saveConnection(db, 'ub', 'stripe', 'acct_B', 'test');
saveConnection(db, 'ub', 'paddle', 'paddle', 'test', { apiKey: 'pdl_sdbx_b', webhookSecret: 'bob-whsec' });

// Fake providers.
const remoteStatus: Record<string, 'open' | 'paid'> = {};
let n = 0;
routes.setProviderApisForTest({
  stripe: { createInvoice: async () => ({ providerInvoiceId: `in_${++n}`, paymentUrl: 'https://pay.stripe.test/x' }), fetchStatus: async (_c, id) => ({ status: remoteStatus[id] ?? 'open', paidOn: TODAY }) },
  paddle: { createInvoice: async () => ({ providerInvoiceId: `txn_${++n}`, paymentUrl: null }), fetchStatus: async (_c, id) => ({ status: remoteStatus[id] ?? 'open', paidOn: TODAY }) },
});

const app = express();
app.post('/api/integrations/stripe/webhook', express.raw({ type: 'application/json' }), routes.stripeConnectWebhook);
app.post('/api/integrations/paddle/webhook/:connectionId', express.raw({ type: 'application/json' }), routes.paddleWebhook);
app.use(express.json());
app.use('/api', attachUser);
app.use('/api/integrations', routes.default);
const server: Server = await new Promise((r) => {
  const s = app.listen(0, '127.0.0.1', () => r(s));
});
const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
try {
  const ca = `${SESSION_COOKIE}=${(await createSession('ua')).rawToken}`;
  const cb = `${SESSION_COOKIE}=${(await createSession('ub')).rawToken}`;
  const call = (method: string, p: string, cookie: string, b?: unknown) => fetch(`${base}/api/integrations${p}`, { method, headers: { Cookie: cookie, 'Content-Type': 'application/json' }, body: b === undefined ? undefined : JSON.stringify(b) });

  const st = (await (await call('GET', '', ca)).json()) as { stripe: { connected: boolean }; paddle: { webhookUrl: string } };
  eq(st.stripe.connected, true, 'status');
  eq((await call('PUT', '/paddle', ca, { apiKey: 'pdl_live_x', webhookSecret: 'w' })).status, 400, 'live Paddle key refused');
  setPaddleFetchForTest(async () => ({ ok: true, status: 200, json: async () => ({ data: [] }) }));
  eq((await call('PUT', '/paddle', ca, { apiKey: 'pdl_sdbx_new', webhookSecret: 'paddle-whsec' })).status, 200, 'Paddle connected with a checked key');

  // Push to Stripe; can't push twice; B can't push A's invoice.
  const pushed = await call('POST', `/invoices/${invA.id}/push`, ca, { provider: 'stripe' });
  eq(pushed.status, 200, 'pushed');
  const link = ((await pushed.json()) as { link: { providerInvoiceId: string; paymentUrl: string } }).link;
  eq(link.paymentUrl, 'https://pay.stripe.test/x', 'payment link stored');
  eq((await call('POST', `/invoices/${invA.id}/push`, ca, { provider: 'stripe' })).status, 409, 'not twice');
  eq((await call('POST', `/invoices/${invA.id}/push`, cb, { provider: 'stripe' })).status, 404, "B can't push A's invoice");

  // Stripe webhook: signed, from A's account → paid with income, once.
  const stripeEvent = (id: string, account: string, invoiceId: string) => JSON.stringify({ id, object: 'event', type: 'invoice.paid', livemode: false, account, data: { object: { id: invoiceId, status: 'paid', status_transitions: { paid_at: Math.floor(Date.now() / 1000) } } } });
  const postStripe = (payload: string, secret = 'whsec_test_connect') =>
    fetch(`${base}/api/integrations/stripe/webhook`, { method: 'POST', headers: { 'Content-Type': 'application/json', 'Stripe-Signature': Stripe.webhooks.generateTestHeaderString({ payload, secret }) }, body: payload });
  eq((await postStripe(stripeEvent('evt_bad', 'acct_A', link.providerInvoiceId), 'whsec_wrong')).status, 400, 'bad Stripe signature');
  eq(((await (await postStripe(stripeEvent('evt_x', 'acct_B', link.providerInvoiceId))).json()) as { ignored?: boolean }).ignored, true, "an event from B's account can't pay A's invoice");
  eq(getInvoice(db, 'ua', invA.id, TODAY)?.balanceNzd, invA.balanceNzd, 'still owed');
  eq((await postStripe(stripeEvent('evt_1', 'acct_A', link.providerInvoiceId))).status, 200, 'paid event');
  const paid = getInvoice(db, 'ua', invA.id, TODAY)!;
  eq([paid.balanceNzd, paid.payments.length, paid.payments[0]?.method], [0, 1, 'Stripe'], 'invoice paid in full by Stripe');
  eq(queryAll(db, `SELECT id FROM income_records WHERE user_id = 'ua' AND invoice_payment_id IS NOT NULL`).length, 1, 'income recorded once');
  eq(((await (await postStripe(stripeEvent('evt_1', 'acct_A', link.providerInvoiceId))).json()) as { duplicate?: boolean }).duplicate, true, 'same event twice: applied once');
  eq(getInvoice(db, 'ua', invA.id, TODAY)?.payments.length, 1, 'no second payment');

  // Paddle: B pushes, then a signed notification marks it paid; A's secret can't.
  const pb = await call('POST', `/invoices/${invB.id}/push`, cb, { provider: 'paddle' });
  const txnId = ((await pb.json()) as { link: { providerInvoiceId: string } }).link.providerInvoiceId;
  const bConn = getConnection(db, 'ub', 'paddle')!;
  const aConn = getConnection(db, 'ua', 'paddle')!;
  const note = Buffer.from(JSON.stringify({ event_id: 'ntf_1', event_type: 'transaction.completed', data: { id: txnId, status: 'completed', updated_at: `${TODAY}T01:00:00Z` } }));
  const postPaddle = (connId: string, secret: string, b = note) => fetch(`${base}/api/integrations/paddle/webhook/${connId}`, { method: 'POST', headers: { 'Content-Type': 'application/json', 'Paddle-Signature': sig(secret, Math.floor(Date.now() / 1000), b) }, body: b });
  eq((await postPaddle(bConn.id, 'wrong')).status, 400, 'bad Paddle signature');
  eq(((await (await postPaddle(aConn.id, 'paddle-whsec')).json()) as { ignored?: boolean }).ignored, true, "A's connection can't pay B's invoice");
  eq((await postPaddle(bConn.id, 'bob-whsec')).status, 200, 'Paddle paid');
  eq(getInvoice(db, 'ub', invB.id, TODAY)?.balanceNzd, 0, "B's invoice paid");
  eq(((await (await postPaddle(bConn.id, 'bob-whsec')).json()) as { duplicate?: boolean }).duplicate, true, 'Paddle event once');

  // Sync now catches a missed webhook.
  const invA2 = sentInvoice('ua', 'Acme 2');
  const p2 = ((await (await call('POST', `/invoices/${invA2.id}/push`, ca, { provider: 'stripe' })).json()) as { link: { providerInvoiceId: string } }).link;
  remoteStatus[p2.providerInvoiceId] = 'paid';
  const sy = (await (await call('POST', `/invoices/${invA2.id}/sync`, ca)).json()) as { changed: boolean; link: { status: string } };
  eq([sy.changed, sy.link.status, getInvoice(db, 'ua', invA2.id, TODAY)?.balanceNzd], [true, 'paid', 0], 'sync now marks it paid');

  eq((await call('DELETE', '/paddle', ca)).status, 200, 'disconnect');
  eq(getConnection(db, 'ua', 'paddle'), null, 'gone');
  eq((await fetch(`${base}/api/integrations`)).status, 401, 'signed out');
  eq(queryOne(db, `SELECT COUNT(*) AS n FROM provider_events`)?.n, 2, 'two events recorded');
  console.log('integrations tests passed');
} finally {
  server.close();
  fs.rmSync(dir, { recursive: true, force: true });
}
process.exit(0);
