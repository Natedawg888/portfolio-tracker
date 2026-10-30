/**
 * Accountant and viewer access (KAN-129): an invited accountant works in the one business they
 * were let into, as its owner would, and nowhere else; a viewer only reads; strangers see nothing;
 * removal takes effect on the next request; the accountant's Business plan unlocks reports there.
 * Run: node --import tsx server/business/members.test.ts
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

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'pt-bizmembers-'));
process.env.DATABASE_PATH = path.join(dir, 'portfolio.db');
process.env.NODE_ENV = 'test';
delete process.env.ALLOW_EXISTING_DATA_CLAIM;
delete process.env.RESEND_API_KEY;
process.env.AKAHU_TOKEN_ENCRYPTION_KEY = crypto.randomBytes(32).toString('base64');

const { getDb, queryAll, queryOne, run } = await import('../db/index.ts');
const { default: authRouter } = await import('../routes/auth.ts');
const { default: businessRouter } = await import('../routes/business.ts');
const { setPlan } = await import('../lib/entitlements.ts');
const { removeUserFromBusinesses } = await import('./members.ts');
const { attachUser, requireAuth, isPublicApiPath } = await import('../middleware/requireAuth.ts');
const { uploadsGate, UPLOADS_DIR } = await import('../lib/uploads.ts');

const app = express();
app.use(express.json({ limit: '2mb' }));
app.use('/api', attachUser);
app.use('/api', (req, res, next) => (isPublicApiPath(req.path) ? next() : requireAuth(req, res, next)));
app.use('/api/auth', authRouter);
app.use('/api/business', businessRouter);
app.use('/api/uploads', uploadsGate(), express.static(UPLOADS_DIR));

const server: Server = await new Promise((resolve) => {
  const s = app.listen(0, '127.0.0.1', () => resolve(s));
});
const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;

type Res = { status: number; json: any; cookie?: string };
async function call(method: string, pathname: string, cookie?: string, body?: unknown): Promise<Res> {
  const headers: Record<string, string> = { Accept: 'application/json' };
  if (body !== undefined) headers['Content-Type'] = 'application/json';
  if (cookie) headers.Cookie = cookie;
  const res = await fetch(`${base}${pathname}`, { method, headers, body: body !== undefined ? JSON.stringify(body) : undefined });
  const json = await res.json().catch(() => null);
  return { status: res.status, json, cookie: res.headers.get('set-cookie')?.split(';')[0] };
}

async function register(email: string, first: string) {
  const res = await call('POST', '/api/auth/register', undefined, { email, password: 'SmokeTest1a', firstName: first, lastName: 'Test' });
  assert(res.status === 201 && res.cookie, `register ${email}: ${res.status}`);
  return { id: String(res.json.user.id), cookie: res.cookie!, email };
}

const tokenOf = (link: string) => link.split('#token=')[1];

try {
  const owner = await register('owner@example.test', 'Olive');
  const acct = await register('acct@example.test', 'Andy');
  const viewer = await register('viewer@example.test', 'Vera');
  const stranger = await register('stranger@example.test', 'Sam');
  const db = await getDb();

  // The owner's two businesses, each with records of every kind a route can name.
  const make = async (name: string) => {
    const biz = String((await call('POST', '/api/business', owner.cookie, { name, type: 'sole_trader' })).json.id);
    const asset = String((await call('POST', `/api/business/${biz}/assets`, owner.cookie, { category: 'other', name: `${name} van`, quantity: 1 })).json.id);
    const employee = String((await call('POST', `/api/business/${biz}/employees`, owner.cookie, { name: `${name} worker` })).json.id);
    const item = String((await call('POST', `/api/business/${biz}/stock`, owner.cookie, { name: `${name} jar` })).json.id);
    const withBatch = await call('POST', `/api/business/stock/${item}/batches`, owner.cookie, { quantity: 5, unitCostNzd: 4 });
    const batch = String(withBatch.json.batches[0].id);
    const supplier = String((await call('POST', `/api/business/${biz}/suppliers`, owner.cookie, { name: `${name} supplier` })).json.id);
    const bill = await call('POST', `/api/business/${biz}/bills`, owner.cookie, { supplierId: supplier, kind: 'stock', invoiceDate: '2026-01-05', dueDate: '2026-01-20', amountNzd: 99 });
    assert(bill.status === 201, `bill in ${name}: ${bill.status}`);
    return { biz, asset, employee, item, batch, supplier, bill: String(bill.json.id) };
  };
  const shared = await make('Shared Books');
  const other = await make('Private Books');

  // A personal transaction of the owner's, never tagged to a business.
  const now = new Date().toISOString();
  run(db, `INSERT INTO bank_accounts (id, user_id, name, institution, account_type, currency, balance, notes, created_at, updated_at) VALUES (?,?,?,?,?,?,?,?,?,?)`, [
    'acct_owner', owner.id, 'Owner everyday', '', 'checking', 'NZD', 100, null, now, now,
  ]);
  run(db, `INSERT INTO transactions (id, user_id, account_id, date, description, amount, kind, created_at) VALUES (?,?,?,?,?,?,?,?)`, [
    'txn_personal', owner.id, 'acct_owner', '2026-10-01', 'Owner Personal Secret', -42, 'debit', now,
  ]);

  // Only the owner invites; the invite is for one email address.
  assert((await call('POST', `/api/business/${shared.biz}/members/invites`, acct.cookie, { email: 'acct@example.test', role: 'accountant' })).status === 404, 'a stranger can’t invite');
  const inv = await call('POST', `/api/business/${shared.biz}/members/invites`, owner.cookie, { email: 'ACCT@example.test', role: 'accountant' });
  assert(inv.status === 201 && inv.json.invite.link.includes('/business/join#token='), `owner invites the accountant: ${inv.status}`);
  assert(inv.json.invites.length === 1 && inv.json.invites[0].email === 'acct@example.test', 'the owner sees the pending invite');
  const acctToken = tokenOf(inv.json.invite.link);
  assert((await call('POST', '/api/business/invites/preview', stranger.cookie, { token: acctToken })).status === 403, 'the wrong account can’t use the invite');
  const preview = await call('POST', '/api/business/invites/preview', acct.cookie, { token: acctToken });
  assert(preview.status === 200 && preview.json.businessName === 'Shared Books' && preview.json.role === 'accountant', 'the accountant previews it');
  assert((await call('POST', '/api/business/invites/accept', acct.cookie, { token: acctToken })).status === 200, 'the accountant accepts');
  assert((await call('POST', '/api/business/invites/accept', acct.cookie, { token: acctToken })).status === 410, 'an invite works once');

  const vInv = await call('POST', `/api/business/${shared.biz}/members/invites`, owner.cookie, { email: 'viewer@example.test', role: 'viewer' });
  assert((await call('POST', '/api/business/invites/accept', viewer.cookie, { token: tokenOf(vInv.json.invite.link) })).status === 200, 'the viewer accepts');

  // The accountant's client list holds the shared business only.
  const list = await call('GET', '/api/business/shared', acct.cookie);
  assert(list.json.length === 1 && list.json[0].id === shared.biz && list.json[0].role === 'accountant', 'shared list has the one business');
  assert(!JSON.stringify((await call('GET', '/api/business', acct.cookie)).json).includes('Books'), 'the owner’s businesses aren’t in the accountant’s own list');

  // In the shared business the accountant reads and edits as the owner would.
  const detail = await call('GET', `/api/business/${shared.biz}`, acct.cookie);
  assert(detail.status === 200 && detail.json.access.role === 'accountant', 'the accountant opens the business');
  assert((await call('PUT', `/api/business/assets/${shared.asset}`, acct.cookie, { category: 'other', name: 'Renamed van', quantity: 1 })).status === 200, 'edits an asset');
  const added = await call('POST', `/api/business/${shared.biz}/assets`, acct.cookie, { category: 'other', name: 'Ladder', quantity: 2 });
  assert(added.status === 201, 'adds an asset');
  assert(queryOne<{ user_id: string }>(db, `SELECT user_id FROM business_assets WHERE id = ?`, [added.json.id])?.user_id === owner.id, 'new rows belong to the owner');
  assert((await call('PUT', `/api/business/employees/${shared.employee}`, acct.cookie, { name: 'Renamed worker' })).status === 200, 'edits an employee');
  assert((await call('PUT', `/api/business/stock/${shared.item}`, acct.cookie, { name: 'Renamed jar' })).status === 200, 'edits stock');
  assert((await call('GET', `/api/business/${shared.biz}/bills`, acct.cookie)).json.length === 1, 'reads bills');
  assert((await call('POST', `/api/business/bills/${shared.bill}/batches`, acct.cookie, { batchId: shared.batch })).status === 200, 'links a bill to a batch');

  // Owner-only actions stay with the owner.
  assert((await call('DELETE', `/api/business/${shared.biz}`, acct.cookie)).status === 403, 'the accountant can’t delete the business');
  assert((await call('POST', `/api/business/${shared.biz}/archive`, acct.cookie)).status === 403, 'or archive it');
  assert((await call('POST', `/api/business/${shared.biz}/members/invites`, acct.cookie, { email: 'x@example.test' })).status === 403, 'or invite people');
  assert((await call('DELETE', `/api/business/${shared.biz}/members/${viewer.id}`, acct.cookie)).status === 403, 'or remove people');

  // Nothing outside that business: the owner's other business, its records, or personal money.
  for (const [method, p, body] of [
    ['GET', `/api/business/${other.biz}`],
    ['GET', `/api/business/${other.biz}/members`],
    ['PUT', `/api/business/assets/${other.asset}`, { category: 'other', name: 'x', quantity: 1 }],
    ['PUT', `/api/business/employees/${other.employee}`, { name: 'x' }],
    ['PUT', `/api/business/stock/${other.item}`, { name: 'x' }],
    ['DELETE', `/api/business/stock/batches/${other.batch}`],
    ['PUT', `/api/business/suppliers/${other.supplier}`, { name: 'x' }],
    ['DELETE', `/api/business/bills/${other.bill}`],
    // Two records from different businesses on one route.
    ['POST', `/api/business/bills/${shared.bill}/batches`, { batchId: other.batch }],
    ['DELETE', `/api/business/bills/${shared.bill}/batches/${other.batch}`],
  ] as [string, string, unknown?][]) {
    const r = await call(method, p, acct.cookie, body);
    assert(r.status === 404, `accountant ${method} ${p} → ${r.status}, want 404`);
  }
  // Sales (KAN-120) follow the same scope.
  const sold = await call('POST', `/api/business/${shared.biz}/sales`, acct.cookie, { lines: [{ itemId: shared.item, quantity: 1, unitPriceNzd: 5 }] });
  assert(sold.status === 201, `the accountant records a sale: ${sold.status}`);
  const otherSale = await call('POST', `/api/business/${other.biz}/sales`, owner.cookie, { lines: [{ itemId: other.item, quantity: 1, unitPriceNzd: 5 }] });
  assert((await call('DELETE', `/api/business/sales/${otherSale.json.id}`, acct.cookie)).status === 404, 'but not touch the other business’s sales');
  assert((await call('POST', `/api/business/${shared.biz}/sales`, acct.cookie, { lines: [{ itemId: other.item, quantity: 1, unitPriceNzd: 5 }] })).status === 404, 'or sell its stock');
  // Wages and the budget (KAN-121) too.
  assert((await call('POST', `/api/business/${shared.biz}/wages`, acct.cookie, { employeeName: 'Casual', amountNzd: 50 })).status === 201, 'the accountant records wages');
  assert((await call('GET', `/api/business/${shared.biz}/budget`, acct.cookie)).status === 200, 'and reads the budget');
  const otherWage = await call('POST', `/api/business/${other.biz}/wages`, owner.cookie, { employeeName: 'Casual', amountNzd: 50 });
  assert((await call('DELETE', `/api/business/wages/${otherWage.json.id}`, acct.cookie)).status === 404, 'not the other business’s wages');
  const otherCats = (await call('GET', `/api/business/${other.biz}/budget`, owner.cookie)).json.expenses;
  assert((await call('PUT', `/api/business/budget/categories/${otherCats[0].id}`, acct.cookie, { name: 'x', kind: 'expense' })).status === 404, 'or its budget');
  const candidates = await call('GET', '/api/business/money/candidates', acct.cookie);
  assert(!JSON.stringify(candidates.json).includes('Owner Personal Secret'), 'the owner’s personal transactions stay hidden');

  // The viewer reads only, and can leave.
  assert((await call('GET', `/api/business/${shared.biz}`, viewer.cookie)).json.access.role === 'viewer', 'the viewer opens it');
  assert((await call('GET', `/api/business/${shared.biz}/stock`, viewer.cookie)).status === 200, 'the viewer reads stock');
  const viewerPut = await call('PUT', `/api/business/assets/${shared.asset}`, viewer.cookie, { category: 'other', name: 'x', quantity: 1 });
  assert(viewerPut.status === 403 && viewerPut.json.code === 'BUSINESS_VIEWER', 'the viewer can’t edit');
  assert((await call('POST', `/api/business/${shared.biz}/assets`, viewer.cookie, { category: 'other', name: 'x', quantity: 1 })).status === 403, 'or add');
  const members = await call('GET', `/api/business/${shared.biz}/members`, viewer.cookie);
  assert(members.json.members.length === 2 && members.json.invites.length === 0, 'members see who has access, not pending invites');
  assert(members.json.members.find((m: { userId: string }) => m.userId === acct.id).email === null, 'or other people’s email addresses');

  // A stranger gets 404s everywhere, as before.
  for (const p of [`/api/business/${shared.biz}`, `/api/business/${shared.biz}/members`, `/api/business/assets/${shared.asset}`]) {
    const r = await call(p.includes('assets/') ? 'DELETE' : 'GET', p, stranger.cookie);
    assert(r.status === 404, `stranger ${p} → ${r.status}`);
  }

  // Reports: nobody has the Business plan yet; the accountant's plan unlocks this business only.
  assert((await call('GET', `/api/business/${shared.biz}/profit-loss`, owner.cookie)).status === 402, 'reports locked without a Business plan');
  setPlan(db, acct.id, 'business');
  assert((await call('GET', `/api/business/${shared.biz}/profit-loss`, acct.cookie)).status === 200, 'the accountant runs the P&L');
  assert((await call('GET', `/api/business/${shared.biz}/gst`, owner.cookie)).status === 200, 'the owner gets reports through their accountant');
  assert((await call('GET', `/api/business/${shared.biz}/export.csv`, viewer.cookie)).status === 200, 'so does the viewer');
  assert((await call('GET', `/api/business/${other.biz}/profit-loss`, owner.cookie)).status === 402, 'but not on the business without an accountant');

  // Files of the shared business open for its members, not for strangers.
  const pdf = `data:application/pdf;base64,${Buffer.from(`%PDF-1.4 CONTRACT ${'x'.repeat(40)}`).toString('base64')}`;
  const signed = await call('POST', `/api/business/employees/${shared.employee}/contract`, acct.cookie, { fileBase64: pdf, fileName: 'contract.pdf' });
  assert(signed.status === 200, `the accountant uploads a contract: ${signed.status} ${JSON.stringify(signed.json)}`);
  const contractUrl = String(signed.json.contract.url);
  const fileStatus = async (cookie: string) => (await fetch(`${base}${contractUrl}`, { headers: { Cookie: cookie } })).status;
  assert((await fileStatus(owner.cookie)) === 200, 'the owner opens the contract');
  assert((await fileStatus(viewer.cookie)) === 200, 'so does the viewer');
  assert((await fileStatus(stranger.cookie)) === 404, 'a stranger can’t');

  // Role change and removal take effect on the next request.
  assert((await call('PATCH', `/api/business/${shared.biz}/members/${acct.id}`, owner.cookie, { role: 'viewer' })).status === 200, 'owner makes the accountant a viewer');
  assert((await call('PUT', `/api/business/stock/${shared.item}`, acct.cookie, { name: 'x' })).status === 403, 'who can no longer edit');
  assert((await call('DELETE', `/api/business/${shared.biz}/members/${acct.id}`, owner.cookie)).status === 200, 'owner removes them');
  assert((await call('GET', `/api/business/${shared.biz}`, acct.cookie)).status === 404, 'removed: the business is gone for them');
  assert((await call('GET', '/api/business/shared', acct.cookie)).json.length === 0, 'and from their list');
  assert((await fileStatus(acct.cookie)) === 404, 'and its files');
  assert((await call('DELETE', `/api/business/${shared.biz}/members/${viewer.id}`, viewer.cookie)).status === 200, 'the viewer leaves');
  assert((await call('GET', `/api/business/${shared.biz}/stock`, viewer.cookie)).status === 404, 'and loses access');
  const log = (await call('GET', `/api/business/${shared.biz}/members`, owner.cookie)).json.activity.map((a: { action: string }) => a.action);
  assert(log.includes('left') && log.some((a: string) => a.startsWith('removed')), `activity log: ${log.join(' / ')}`);

  // Cancelled invites stop working; deleting an account clears its access rows.
  const again = await call('POST', `/api/business/${shared.biz}/members/invites`, owner.cookie, { email: 'acct@example.test', role: 'accountant' });
  const inviteId = again.json.invites[0].id;
  assert((await call('DELETE', `/api/business/${shared.biz}/members/invites/${inviteId}`, owner.cookie)).status === 200, 'owner cancels the invite');
  assert((await call('POST', '/api/business/invites/accept', acct.cookie, { token: tokenOf(again.json.invite.link) })).status === 404, 'a cancelled invite is refused');
  const last = await call('POST', `/api/business/${shared.biz}/members/invites`, owner.cookie, { email: 'acct@example.test', role: 'accountant' });
  await call('POST', '/api/business/invites/accept', acct.cookie, { token: tokenOf(last.json.invite.link) });
  removeUserFromBusinesses(db, owner.id);
  assert(queryAll(db, `SELECT 1 FROM business_members WHERE business_id IN (?, ?)`, [shared.biz, other.biz]).length === 0, 'owner deleting their account clears members');
  assert(queryAll(db, `SELECT 1 FROM business_invites WHERE business_id IN (?, ?)`, [shared.biz, other.biz]).length === 0, 'and invites');

  console.log('OK: business members: invites, accountant scope, viewer read-only, owner-only actions, no cross-business or personal access, plan via accountant, removal');
} finally {
  await new Promise<void>((resolve) => server.close(() => resolve()));
}
