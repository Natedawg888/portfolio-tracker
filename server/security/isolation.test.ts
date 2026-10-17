/**
 * A second signed-in user cannot change another user's BTC quantity, read their
 * income or upload, or rewrite their GoMining / collectable settings.
 * Income summary scoping is already on this branch; this test keeps it that way.
 * Run: npm run test:isolation
 */
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import type { AddressInfo } from 'node:net';
import type { Server } from 'node:http';
import express from 'express';

function assert(cond: unknown, msg: string): void {
  if (!cond) throw new Error(`FAIL: ${msg}`);
}

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'pt-iso-'));
process.env.DATABASE_PATH = path.join(dir, 'portfolio.db');
process.env.NODE_ENV = 'test';
delete process.env.ALLOW_EXISTING_DATA_CLAIM;
process.env.AKAHU_TOKEN_ENCRYPTION_KEY = crypto.randomBytes(32).toString('base64');

const { getDb, queryOne, run } = await import('../db/index.ts');
const { default: authRouter } = await import('../routes/auth.ts');
const { default: accountsRouter } = await import('../routes/accounts.ts');
const { default: incomeRouter } = await import('../routes/income.ts');
const { default: settingsRouter } = await import('../routes/settings.ts');
const { default: householdRouter } = await import('../routes/household.ts');
const { default: payslipsRouter } = await import('../routes/payslips.ts');
const { default: bondsRouter } = await import('../routes/bonds.ts');
const { default: commoditiesRouter } = await import('../routes/commodities.ts');
const { default: businessRouter } = await import('../routes/business.ts');
const { default: invoicesRouter } = await import('../routes/invoices.ts');
const { setPlan } = await import('../lib/entitlements.ts');
const { uploadsGate, UPLOADS_DIR } = await import('../lib/uploads.ts');
const { applyBtcLink, reverseBtcDelta } = await import('../lib/txnBtcLink.ts');
const { attachUser, requireAuth, isPublicApiPath } = await import('../middleware/requireAuth.ts');

const app = express();
app.use(express.json());
app.use('/api', attachUser);
app.use('/api', (req, res, next) => {
  if (isPublicApiPath(req.path)) return next();
  return requireAuth(req, res, next);
});
app.use('/api/auth', authRouter);
app.use('/api/uploads', uploadsGate());
app.use('/api/accounts', accountsRouter);
app.use('/api/income', incomeRouter);
app.use('/api/settings', settingsRouter);
app.use('/api/household', householdRouter);
app.use('/api/payslips', payslipsRouter);
app.use('/api/bonds', bondsRouter);
app.use('/api/commodities', commoditiesRouter);
app.use('/api/business', businessRouter);
app.use('/api/invoices', invoicesRouter);

const server: Server = await new Promise((resolve) => {
  const s = app.listen(0, '127.0.0.1', () => resolve(s));
});
const port = (server.address() as AddressInfo).port;
const base = `http://127.0.0.1:${port}`;

async function req(
  method: string,
  pathname: string,
  opts?: { cookie?: string; body?: unknown; raw?: boolean },
) {
  const headers: Record<string, string> = {};
  if (!opts?.raw) headers.Accept = 'application/json';
  if (opts?.body !== undefined) headers['Content-Type'] = 'application/json';
  if (opts?.cookie) headers.Cookie = opts.cookie;
  const res = await fetch(`${base}${pathname}`, {
    method,
    headers,
    body: opts?.body !== undefined ? JSON.stringify(opts.body) : undefined,
  });
  const setCookie = res.headers.get('set-cookie') ?? undefined;
  const cookie = setCookie?.split(';')[0] ?? opts?.cookie;
  if (opts?.raw) {
    const buf = Buffer.from(await res.arrayBuffer());
    return { status: res.status, cookie, buf, text: buf.toString('utf8'), json: null as unknown };
  }
  const json = await res.json().catch(() => null);
  return { status: res.status, cookie, json, buf: Buffer.alloc(0), text: '' };
}

async function register(email: string, first: string, last: string) {
  const res = await req('POST', '/api/auth/register', {
    body: { email, password: 'SmokeTest1a', firstName: first, lastName: last },
  });
  assert(res.status === 201, `register ${email} status ${res.status}`);
  const user = (res.json as { user?: { id?: string }; claimedExistingData?: boolean }).user;
  assert(typeof user?.id === 'string', `register ${email} missing id`);
  assert(res.cookie, `register ${email} missing cookie`);
  return {
    id: user.id as string,
    cookie: res.cookie as string,
    claimedExistingData: Boolean((res.json as { claimedExistingData?: boolean }).claimedExistingData),
  };
}

function holdingAmount(db: Awaited<ReturnType<typeof getDb>>, id: string): number {
  const row = queryOne<{ amount: number }>(db, `SELECT amount FROM holdings WHERE id = ?`, [id]);
  return Number(row?.amount);
}

try {
  const a = await register('iso-a@example.test', 'Iso', 'Alpha');
  assert(a.claimedExistingData, 'empty install still lets the first account claim (nothing to steal)');
  const b = await register('iso-b@example.test', 'Iso', 'Bravo');
  assert(!b.claimedExistingData, 'second account does not claim the first');

  const db = await getDb();
  const now = new Date().toISOString();
  run(
    db,
    `INSERT INTO holdings (id, user_id, asset_class, name, created_at, updated_at, asset, amount, source)
     VALUES (?,?,?,?,?,?,?,?,?)`,
    ['hld_a', a.id, 'crypto', 'Alpha Secret BTC', now, now, 'BTC', 1.5, 'manual'],
  );
  run(
    db,
    `INSERT INTO bank_accounts
       (id, user_id, name, institution, account_type, currency, balance, notes, created_at, updated_at)
     VALUES (?,?,?,?,?,?,?,?,?,?)`,
    ['acct_b', b.id, 'Bravo cash', '', 'checking', 'NZD', 100, null, now, now],
  );
  run(
    db,
    `INSERT INTO bank_accounts
       (id, user_id, name, institution, account_type, currency, balance, notes, created_at, updated_at)
     VALUES (?,?,?,?,?,?,?,?,?,?)`,
    ['acct_a', a.id, 'Alpha cash', '', 'checking', 'NZD', 100, null, now, now],
  );

  const noHolding = await applyBtcLink(db, {
    userId: b.id,
    affectsBtc: true,
    amountNzd: -80,
    kind: 'debit',
  });
  assert(!noHolding.ok, 'user with no BTC holding cannot apply a link');
  assert(holdingAmount(db, 'hld_a') === 1.5, 'missing btcHoldingId must not change another user');
  assert(!JSON.stringify(noHolding).includes('Alpha Secret'), 'error must not name the other holding');

  const named = await applyBtcLink(db, {
    userId: b.id,
    affectsBtc: true,
    amountNzd: -80,
    kind: 'debit',
    btcHoldingId: 'hld_a',
  });
  assert(!named.ok, 'explicit foreign btcHoldingId is rejected');
  assert(holdingAmount(db, 'hld_a') === 1.5, 'foreign btcHoldingId must not change the holding');

  const unspec = await req('POST', '/api/accounts/transactions', {
    cookie: b.cookie,
    body: {
      accountId: 'acct_b',
      date: '2026-10-05',
      amount: -40,
      kind: 'debit',
      description: 'unspecified btc',
      affectsBtc: true,
    },
  });
  assert(unspec.status === 400, `unspecified Use BTC status ${unspec.status}`);
  assert(holdingAmount(db, 'hld_a') === 1.5, 'omitted btcHoldingId must not change another user');
  assert(!JSON.stringify(unspec.json).includes('Alpha Secret'), 'omitted holding id must not name the other holding');

  run(
    db,
    `INSERT INTO holdings (id, user_id, asset_class, name, created_at, updated_at, asset, amount, source)
     VALUES (?,?,?,?,?,?,?,?,?)`,
    ['hld_b', b.id, 'crypto', 'Bravo Hidden BTC', now, now, 'BTC', 4, 'manual'],
  );
  const picked = await applyBtcLink(db, {
    userId: b.id,
    affectsBtc: true,
    amountNzd: -80,
    kind: 'debit',
    btcHoldingId: 'hld_a',
  });
  assert(!picked.ok, 'a user who has BTC still cannot target another user');
  assert(holdingAmount(db, 'hld_a') === 1.5, 'targeted foreign holding quantity stays put');
  assert(!JSON.stringify(picked).includes('Alpha Secret'), 'rejection must not reveal the other name');

  reverseBtcDelta(
    db,
    {
      affectsBtc: true,
      btcHoldingId: 'hld_a',
      btcDeltaApplied: 0.25,
      btcNzdRate: 100000,
      btcAppliedAt: now,
    },
    b.id,
  );
  assert(holdingAmount(db, 'hld_a') === 1.5, 'reverse by another user is a no-op');
  reverseBtcDelta(
    db,
    {
      affectsBtc: true,
      btcHoldingId: 'hld_a',
      btcDeltaApplied: 0.25,
      btcNzdRate: 100000,
      btcAppliedAt: now,
    },
    a.id,
  );
  assert(holdingAmount(db, 'hld_a') === 1.25, 'owner can still reverse their own delta');

  const attack = await req('POST', '/api/accounts/transactions', {
    cookie: b.cookie,
    body: {
      accountId: 'acct_b',
      date: '2026-10-05',
      amount: -40,
      kind: 'debit',
      description: 'cross-user btc',
      affectsBtc: true,
      btcHoldingId: 'hld_a',
    },
  });
  assert(attack.status === 400, `foreign holding txn status ${attack.status}`);
  assert(holdingAmount(db, 'hld_a') === 1.25, 'API txn must not change the other holding');
  assert(!JSON.stringify(attack.json).includes('Alpha Secret'), 'API error must not reveal the holding name');

  run(
    db,
    `INSERT INTO transactions (
       id, user_id, account_id, date, description, amount, kind, currency, created_at, source,
       affects_btc, btc_holding_id
     ) VALUES (?,?,?,?,?,?,?,?,?,?,?,?)`,
    ['txn_a', a.id, 'acct_a', '2026-10-05', 'alpha spend', -10, 'debit', 'NZD', now, 'manual', 1, 'hld_b'],
  );
  const txns = await req('GET', '/api/accounts/transactions?from=2026-10-01&to=2026-10-31', {
    cookie: a.cookie,
  });
  assert(txns.status === 200, `txn list status ${txns.status}`);
  assert(!JSON.stringify(txns.json).includes('Bravo Hidden'), 'txn list must not show another user holding name');

  run(
    db,
    `INSERT INTO income_records
       (id, user_id, date, amount_nzd, kind, description, created_at)
     VALUES (?,?,?,?,?,?,?)`,
    ['inc_a', a.id, '2026-10-06', 400, 'cash', 'Payee Alpha Secret', now],
  );
  run(
    db,
    `INSERT INTO income_records
       (id, user_id, date, amount_nzd, kind, description, created_at)
     VALUES (?,?,?,?,?,?,?)`,
    ['inc_b', b.id, '2026-10-06', 50, 'cash', 'Payee Bravo Secret', now],
  );
  const sumA = await req('GET', '/api/income/summary?month=2026-10', { cookie: a.cookie });
  const sumB = await req('GET', '/api/income/summary?month=2026-10', { cookie: b.cookie });
  const listA = await req('GET', '/api/income?month=2026-10', { cookie: a.cookie });
  const listB = await req('GET', '/api/income?month=2026-10', { cookie: b.cookie });
  assert(sumA.status === 200 && sumB.status === 200, 'income summary responds for each user');
  const actualA = Number((sumA.json as { actualNzd?: number }).actualNzd);
  const actualB = Number((sumB.json as { actualNzd?: number }).actualNzd);
  assert(actualA === 400, `A summary actual ${actualA} should be only A's 400`);
  assert(actualB === 50, `B summary actual ${actualB} should be only B's 50`);
  assert(!JSON.stringify(sumA.json).includes('Payee Bravo'), 'A summary must not include B payee');
  assert(!JSON.stringify(sumB.json).includes('Payee Alpha'), 'B summary must not include A payee');
  assert(JSON.stringify(listA.json).includes('Payee Alpha Secret'), 'A can read their own description');
  assert(!JSON.stringify(listA.json).includes('Payee Bravo'), 'A list must not include B description');
  assert(!JSON.stringify(listB.json).includes('Payee Alpha'), 'B list must not include A description');

  run(
    db,
    `INSERT INTO app_settings (key, value) VALUES (?, ?)
     ON CONFLICT(key) DO UPDATE SET value = excluded.value`,
    ['gominingDiscountPct', '15'],
  );
  run(
    db,
    `INSERT INTO app_settings (key, value) VALUES (?, ?)
     ON CONFLICT(key) DO UPDATE SET value = excluded.value`,
    ['collectableTypes', JSON.stringify([{ id: 'legacy-figs', title: 'Owner Legacy Figs', kind: 'manual' }])],
  );
  const settingsA = await req('GET', '/api/settings', { cookie: a.cookie });
  const settingsB = await req('GET', '/api/settings', { cookie: b.cookie });
  const discA = Number((settingsA.json as { gomining?: { discountPct?: number } }).gomining?.discountPct);
  const discB = Number((settingsB.json as { gomining?: { discountPct?: number } }).gomining?.discountPct);
  assert(discA === 15, `data owner still sees legacy discount, got ${discA}`);
  assert(discB === 0, `other user must not see the owner's discount, got ${discB}`);
  const typesA = await req('GET', '/api/settings/collectable-types', { cookie: a.cookie });
  const typesB = await req('GET', '/api/settings/collectable-types', { cookie: b.cookie });
  assert(JSON.stringify(typesA.json).includes('Owner Legacy Figs'), 'data owner keeps legacy collectable types');
  assert(!JSON.stringify(typesB.json).includes('Owner Legacy Figs'), 'other user must not see those types');

  const putB = await req('PUT', '/api/settings/collectable-types', {
    cookie: b.cookie,
    body: { types: [{ id: 'bravo-figs', title: 'Bravo Secret Figs', kind: 'manual' }] },
  });
  assert(putB.status === 200, `B collectable save status ${putB.status}`);
  const typesA2 = await req('GET', '/api/settings/collectable-types', { cookie: a.cookie });
  const typesB2 = await req('GET', '/api/settings/collectable-types', { cookie: b.cookie });
  assert(JSON.stringify(typesB2.json).includes('Bravo Secret Figs'), 'B sees their own types');
  assert(!JSON.stringify(typesA2.json).includes('Bravo Secret Figs'), 'A must not see B types');
  assert(JSON.stringify(typesA2.json).includes('Owner Legacy Figs'), 'A legacy types stay A-only');

  const patchB = await req('PATCH', '/api/settings/gomining', {
    cookie: b.cookie,
    body: { discountPct: 40 },
  });
  assert(patchB.status === 200, `B gomining patch status ${patchB.status}`);
  const afterA = await req('GET', '/api/settings', { cookie: a.cookie });
  const afterB = await req('GET', '/api/settings', { cookie: b.cookie });
  assert(
    Number((afterB.json as { gomining?: { discountPct?: number } }).gomining?.discountPct) === 40,
    'B keeps their own discount',
  );
  assert(
    Number((afterA.json as { gomining?: { discountPct?: number } }).gomining?.discountPct) === 15,
    'B patch must not change A discount',
  );
  const globalDisc = queryOne<{ value: string }>(
    db,
    `SELECT value FROM app_settings WHERE key = 'gominingDiscountPct'`,
  );
  assert(globalDisc?.value === '15', 'shared app_settings discount was not overwritten');

  fs.mkdirSync(path.join(UPLOADS_DIR, 'receipts'), { recursive: true });
  fs.mkdirSync(path.join(UPLOADS_DIR, 'avatars'), { recursive: true });
  fs.mkdirSync(path.join(UPLOADS_DIR, 'properties'), { recursive: true });
  const receiptBody = 'SECRET_RECEIPT_BYTES_ALPHA';
  const avatarBody = 'SECRET_AVATAR_BYTES_ALPHA';
  const photoBody = 'SECRET_PROPERTY_BYTES_ALPHA';
  fs.writeFileSync(path.join(UPLOADS_DIR, 'receipts', 'txn_a.pdf'), receiptBody);
  fs.writeFileSync(path.join(UPLOADS_DIR, 'receipts', 'orphan.pdf'), 'SECRET_ORPHAN');
  fs.writeFileSync(path.join(UPLOADS_DIR, 'avatars', `${a.id}.png`), avatarBody);
  fs.writeFileSync(path.join(UPLOADS_DIR, 'properties', 'hld_a.jpg'), photoBody);
  run(db, `UPDATE transactions SET receipt_path = ? WHERE id = ? AND user_id = ?`, [
    'receipts/txn_a.pdf',
    'txn_a',
    a.id,
  ]);
  run(db, `UPDATE users SET avatar_url = ? WHERE id = ?`, [`avatars/${a.id}.png`, a.id]);
  run(db, `UPDATE holdings SET photo_path = ? WHERE id = ? AND user_id = ?`, [
    'properties/hld_a.jpg',
    'hld_a',
    a.id,
  ]);

  const ownReceipt = await req('GET', '/api/uploads/receipts/txn_a.pdf', { cookie: a.cookie, raw: true });
  const otherReceipt = await req('GET', '/api/uploads/receipts/txn_a.pdf', { cookie: b.cookie, raw: true });
  const anonReceipt = await req('GET', '/api/uploads/receipts/txn_a.pdf', { raw: true });
  assert(ownReceipt.status === 200 && ownReceipt.text.includes(receiptBody), 'owner can fetch their receipt');
  assert(otherReceipt.status === 404 && !otherReceipt.text.includes(receiptBody), 'other user cannot fetch the receipt');
  assert(anonReceipt.status === 401, 'uploads stay unavailable without a session');

  const ownAvatar = await req('GET', `/api/uploads/avatars/${a.id}.png`, { cookie: a.cookie, raw: true });
  const otherAvatar = await req('GET', `/api/uploads/avatars/${a.id}.png`, { cookie: b.cookie, raw: true });
  assert(ownAvatar.status === 200 && ownAvatar.text.includes(avatarBody), 'owner can fetch their avatar');
  assert(otherAvatar.status === 404 && !otherAvatar.text.includes(avatarBody), 'other user cannot fetch the avatar');

  const ownPhoto = await req('GET', '/api/uploads/properties/hld_a.jpg', { cookie: a.cookie, raw: true });
  const otherPhoto = await req('GET', '/api/uploads/properties/hld_a.jpg', { cookie: b.cookie, raw: true });
  assert(ownPhoto.status === 200 && ownPhoto.text.includes(photoBody), 'owner can fetch their property photo');
  assert(otherPhoto.status === 404 && !otherPhoto.text.includes(photoBody), 'other user cannot fetch the property photo');

  const orphan = await req('GET', '/api/uploads/receipts/orphan.pdf', { cookie: a.cookie, raw: true });
  assert(orphan.status === 404 && !orphan.text.includes('SECRET_ORPHAN'), 'unlinked uploads are not served');
  const traversal = await req('GET', '/api/uploads/receipts/..%2F..%2F..%2Fetc%2Fpasswd', {
    cookie: a.cookie,
    raw: true,
  });
  assert(traversal.status === 404, 'path traversal is rejected');

  // Households (KAN-77): joining a household shares nothing personal by itself.
  setPlan(db, a.id, 'plus');
  const hh = await req('POST', '/api/household', { cookie: a.cookie, body: { name: 'Iso home' } });
  assert(hh.status === 201, 'A creates a household');
  const outsider = await req('GET', '/api/household', { cookie: b.cookie });
  assert((outsider.json as { household: unknown }).household === null, 'B is not in A’s household');
  const inv = await req('POST', '/api/household/invites', { cookie: a.cookie, body: { email: 'iso-b@example.test', role: 'adult' } });
  const token = String((inv.json as { invite: { link: string } }).invite.link).split('#token=')[1];
  const joined = await req('POST', '/api/household/invites/accept', { cookie: b.cookie, body: { token } });
  assert(joined.status === 200, 'B joins');
  const bTxns = await req('GET', '/api/accounts/transactions?from=2026-10-01&to=2026-10-31', { cookie: b.cookie });
  assert(!JSON.stringify(bTxns.json).includes('alpha spend'), 'a household member still can’t see the other’s transactions');
  const bIncome = await req('GET', '/api/income', { cookie: b.cookie });
  assert(!JSON.stringify(bIncome.json).includes(a.id), 'or their income');
  const removed = await req('DELETE', `/api/household/members/${b.id}`, { cookie: a.cookie });
  assert(removed.status === 200, 'A removes B');
  const afterRemoval = await req('GET', '/api/household', { cookie: b.cookie });
  assert((afterRemoval.json as { household: unknown }).household === null, 'B loses access at once');

  // Payslips (KAN-78): another user can't list, change, delete or open A's payslip or its file.
  const slip = await req('POST', '/api/payslips', {
    cookie: a.cookie,
    body: { employer: 'Alpha Secret Employer', frequency: 'weekly', periodStart: '2026-10-01', periodEnd: '2026-10-07', payDate: '2026-10-08', taxCode: 'M', grossNzd: 1000, payeNzd: 150, netNzd: 850 },
  });
  assert(slip.status === 201, 'A adds a payslip');
  const slipId = String((slip.json as { id: string }).id);
  const fileBody = 'SECRET_PAYSLIP_FILE';
  const up = await req('POST', `/api/payslips/${slipId}/file`, { cookie: a.cookie, body: { fileBase64: `data:application/pdf;base64,${Buffer.from(`%PDF-1.4 ${fileBody} ${'x'.repeat(40)}`).toString('base64')}` } });
  assert(up.status === 200, 'A uploads the payslip');
  const bSlips = await req('GET', '/api/payslips', { cookie: b.cookie });
  assert(!JSON.stringify(bSlips.json).includes('Alpha Secret Employer'), 'B can’t list A’s payslips');
  assert((await req('PUT', `/api/payslips/${slipId}`, { cookie: b.cookie, body: { employer: 'x', frequency: 'weekly', periodStart: '2026-10-01', periodEnd: '2026-10-07', payDate: '2026-10-08', grossNzd: 1, netNzd: 1 } })).status === 404, 'B can’t edit it');
  assert((await req('DELETE', `/api/payslips/${slipId}`, { cookie: b.cookie })).status === 404, 'B can’t delete it');
  const otherSlipFile = await req('GET', `/api/uploads/payslips/${slipId}.pdf`, { cookie: b.cookie, raw: true });
  assert(otherSlipFile.status === 404 && !otherSlipFile.text.includes(fileBody), 'B can’t open the payslip file');
  const ownSlipFile = await req('GET', `/api/uploads/payslips/${slipId}.pdf`, { cookie: a.cookie, raw: true });
  assert(ownSlipFile.status === 200 && ownSlipFile.text.includes(fileBody), 'A can');

  // Bonds (KAN-80): another user can't list, change or delete A's bond.
  const bond = await req('POST', '/api/bonds', {
    cookie: a.cookie,
    body: { name: 'Alpha Secret Bond', kind: 'govt', faceValue: 1000, purchasePrice: 1000, purchaseDate: '2026-10-01', ratePct: 4, frequency: 'yearly', maturityDate: '2030-10-01' },
  });
  assert(bond.status === 201, 'A adds a bond');
  const bondId = String((bond.json as { bonds: { id: string }[] }).bonds[0].id);
  assert(!JSON.stringify((await req('GET', '/api/bonds', { cookie: b.cookie })).json).includes('Alpha Secret Bond'), 'B can’t list A’s bonds');
  assert((await req('PUT', `/api/bonds/${bondId}`, { cookie: b.cookie, body: { name: 'x', kind: 'govt', faceValue: 1, purchasePrice: 1, purchaseDate: '2026-10-01', ratePct: 1, frequency: 'yearly', maturityDate: '2027-10-01' } })).status === 404, 'B can’t edit it');
  assert((await req('DELETE', `/api/bonds/${bondId}`, { cookie: b.cookie })).status === 404, 'B can’t delete it');
  assert((await req('POST', `/api/bonds/${bondId}/repaid`, { cookie: b.cookie, body: {} })).status === 404, 'B can’t close it');

  // Commodities (KAN-81): another user can't list, change or delete A's commodity.
  const cmdBody = { name: 'Alpha Secret Wool', preset: null, category: 'agriculture', quantity: 10, unit: 'bale', costNzd: null, priceNzd: null, priceBasis: 'unit', valueOn: null, notes: '' };
  const cmd = await req('POST', '/api/commodities', { cookie: a.cookie, body: cmdBody });
  assert(cmd.status === 201, 'A adds a commodity');
  const cmdId = String((cmd.json as { commodities: { id: string }[] }).commodities[0].id);
  assert(!JSON.stringify((await req('GET', '/api/commodities', { cookie: b.cookie })).json).includes('Alpha Secret Wool'), 'B can’t list A’s commodities');
  assert((await req('PUT', `/api/commodities/${cmdId}`, { cookie: b.cookie, body: { ...cmdBody, name: 'x' } })).status === 404, 'B can’t edit it');
  assert((await req('DELETE', `/api/commodities/${cmdId}`, { cookie: b.cookie })).status === 404, 'B can’t delete it');

  // Business (KAN-84): another user can't read or change A's business, its assets or clients.
  const biz = await req('POST', '/api/business', { cookie: a.cookie, body: { name: 'Alpha Secret Apiary', type: 'sole_trader' } });
  assert(biz.status === 201, 'A adds a business');
  const bizId = String((biz.json as { id: string }).id);
  const hives = await req('POST', `/api/business/${bizId}/assets`, { cookie: a.cookie, body: { category: 'beehives', name: 'Hives', quantity: 40 } });
  assert(hives.status === 201, 'A adds hives');
  const hiveId = String((hives.json as { id: string }).id);
  const client = await req('POST', '/api/invoices/clients', { cookie: a.cookie, body: { businessId: bizId, name: 'Alpha Secret Client' } });
  assert(client.status === 201, 'A adds a client');
  const clientId = String((client.json as { id: string }).id);
  assert(!JSON.stringify((await req('GET', '/api/business', { cookie: b.cookie })).json).includes('Alpha Secret'), 'B can’t list A’s businesses');
  assert(!JSON.stringify((await req('GET', '/api/invoices/clients', { cookie: b.cookie })).json).includes('Alpha Secret Client'), 'B can’t list A’s clients');
  assert((await req('GET', `/api/business/${bizId}`, { cookie: b.cookie })).status === 404, 'B can’t open it');
  assert((await req('PUT', `/api/business/${bizId}`, { cookie: b.cookie, body: { name: 'x' } })).status === 404, 'B can’t edit it');
  assert((await req('DELETE', `/api/business/${bizId}`, { cookie: b.cookie })).status === 404, 'B can’t delete it');
  assert((await req('POST', `/api/business/${bizId}/assets`, { cookie: b.cookie, body: { category: 'other', name: 'x', quantity: 1 } })).status === 404, 'B can’t add assets');
  assert((await req('POST', `/api/business/assets/${hiveId}/movements`, { cookie: b.cookie, body: { kind: 'sale', quantity: 1 } })).status === 404, 'B can’t move A’s stock');
  assert((await req('DELETE', `/api/business/assets/${hiveId}`, { cookie: b.cookie })).status === 404, 'B can’t delete A’s assets');
  assert((await req('GET', `/api/business/clients/${clientId}`, { cookie: b.cookie })).status === 404, 'B can’t open A’s client');
  assert((await req('POST', '/api/invoices/clients', { cookie: b.cookie, body: { businessId: bizId, name: 'x' } })).status === 404, 'B can’t add to A’s business');

  console.log('OK: cross-user BTC, income, uploads, settings, households, payslips, bonds, commodities, and businesses');
} finally {
  await new Promise<void>((resolve) => server.close(() => resolve()));
}
