/**
 * Payslips API (KAN-78): add a payslip, the PAYE check, year-to-date totals, net pay into
 * Income linked to the right bank deposit (counted once), deleting a payslip leaves the bank
 * deposit, one payslip per period per source, no negative amounts, the free plan limit, the
 * uploaded file is private and goes with the payslip and the account.
 * Run: npm run test:payslips
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import type { AddressInfo } from 'node:net';
import type { Server } from 'node:http';
import express from 'express';

const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'pt-payslips-'));
process.env.DATABASE_PATH = path.join(dataDir, 'portfolio.db');
process.env.AUTH_ENCRYPTION_KEY = 'a'.repeat(64);
process.env.PLAN_PLUS_EMAILS = 'ana@example.com';

function assert(cond: unknown, msg: string): void {
  if (!cond) throw new Error(`FAIL: ${msg}`);
}

const { getDb, run, queryAll, queryOne } = await import('../db/index.ts');
const { createSession, SESSION_COOKIE } = await import('../auth/sessions.ts');
const { attachUser, requireAuth, isPublicApiPath } = await import('../middleware/requireAuth.ts');
const { uploadsGate, UPLOADS_DIR } = await import('../lib/uploads.ts');
const { deleteScopedDataForUser } = await import('../lib/userScope.ts');
const { default: payslipsRouter } = await import('../routes/payslips.ts');

const now = '2026-10-05T00:00:00.000Z';
const db = await getDb();
for (const id of ['ana', 'ben']) {
  run(db, `INSERT INTO users (id, email, password_hash, first_name, last_name, created_at, updated_at) VALUES (?,?,?,?,?,?,?)`, [id, `${id}@example.com`, 'h', id, 'Test', now, now]);
}
run(db, `INSERT INTO bank_accounts (id, user_id, name, account_type, currency, balance, created_at, updated_at) VALUES ('acc_ana', 'ana', 'Everyday', 'cheque', 'NZD', 0, ?, ?)`, [now, now]);
const txn = (id: string, date: string, amount: number, desc: string) =>
  run(db, `INSERT INTO transactions (id, user_id, account_id, date, description, amount, kind, currency, source, created_at) VALUES (?, 'ana', 'acc_ana', ?, ?, ?, ?, 'NZD', 'manual', ?)`, [id, date, desc, amount, amount < 0 ? 'debit' : 'credit', now]);
// The pay lands two days after the pay date; another credit of the same amount is too far away.
txn('t_pay', '2026-10-10', 1196.53, 'ACME LTD SALARY');
txn('t_other', '2026-11-30', 1196.53, 'REFUND');

const app = express();
app.use(express.json({ limit: '10mb' }));
app.use('/api', attachUser);
app.use('/api', (req, res, next) => (isPublicApiPath(req.path) ? next() : requireAuth(req, res, next)));
app.use('/api/uploads', uploadsGate());
app.use('/api/payslips', payslipsRouter);
const server: Server = await new Promise((resolve) => {
  const s = app.listen(0, '127.0.0.1', () => resolve(s));
});
const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
type Json = Record<string, any>;
async function call(method: string, p: string, cookie: string, body?: unknown): Promise<{ status: number; json: Json }> {
  const headers: Record<string, string> = { Accept: 'application/json', Cookie: cookie };
  if (body !== undefined) headers['Content-Type'] = 'application/json';
  const res = await fetch(`${base}${p}`, { method, headers, body: body !== undefined ? JSON.stringify(body) : undefined });
  return { status: res.status, json: (await res.json().catch(() => ({}))) as Json };
}

// Weekly $1,500, M SL, 3.5% KiwiSaver (2026/27): PAYE 300.39, ACC 26.25, KiwiSaver 52.50,
// student loan 124.32, plus a $199.99 non-taxable allowance → net $1,196.53.
const slip = {
  employer: 'Acme Ltd',
  frequency: 'weekly',
  periodStart: '2026-10-01',
  periodEnd: '2026-10-07',
  payDate: '2026-10-08',
  taxCode: 'M SL',
  hours: 40,
  hourlyRate: 37.5,
  grossNzd: 1500,
  payeNzd: 300.39,
  accNzd: 26.25,
  kiwiSaverEmployeeNzd: 52.5,
  kiwiSaverEmployerNzd: 52.5,
  esctNzd: 9.19,
  studentLoanNzd: 124.32,
  otherDeductionsNzd: 0,
  allowancesNzd: 199.99,
  netNzd: 1196.53,
};

try {
  const A = `${SESSION_COOKIE}=${(await createSession('ana')).rawToken}`;
  const B = `${SESSION_COOKIE}=${(await createSession('ben')).rawToken}`;

  // Validation.
  assert((await call('POST', '/api/payslips', A, { ...slip, payeNzd: -1 })).status === 400, 'negative amounts are rejected');
  assert((await call('POST', '/api/payslips', A, { ...slip, grossNzd: '' })).status === 400, 'gross is required');
  assert((await call('POST', '/api/payslips', A, { ...slip, periodEnd: '2026-09-01' })).status === 400, 'period must end after it starts');
  assert((await call('POST', '/api/payslips', A, { ...slip, employer: '' })).status === 400, 'employer or source required');

  // Add a payslip: the PAYE check passes, net adds up, net goes into Income linked to the deposit.
  let r = await call('POST', '/api/payslips', A, slip);
  assert(r.status === 201, `created (${r.status} ${JSON.stringify(r.json)})`);
  const p = r.json;
  assert(p.check.status === 'checked' && p.check.allOk && p.check.items.length === 4, `PAYE check passes ${JSON.stringify(p.check)}`);
  assert(p.netCheck.matches && p.netCheck.expected === 1196.53, 'net adds up');
  assert(p.income.inIncome && p.income.bankMatch?.transactionId === 't_pay', 'linked to the right bank deposit');
  const incomeRows = queryAll<{ transaction_id: string | null }>(db, `SELECT transaction_id FROM income_records WHERE user_id = 'ana'`);
  assert(incomeRows.length === 1 && incomeRows[0].transaction_id === 't_pay', 'one income row, linked: the deposit isn’t counted twice');

  // One payslip per period per source.
  assert((await call('POST', '/api/payslips', A, { ...slip, employer: 'ACME LTD' })).status === 409, 'same period, same employer is refused');
  assert((await call('POST', '/api/payslips', A, { ...slip, employer: 'Second job', addToIncome: false })).status === 201, 'another employer for the same period is fine');

  // A wrong deduction is flagged.
  r = await call('POST', '/api/payslips', A, { ...slip, periodStart: '2026-10-08', periodEnd: '2026-10-14', payDate: '2026-10-15', payeNzd: 340, netNzd: 1156.92, addToIncome: false });
  assert(r.json.check.allOk === false && r.json.check.items.find((i: Json) => i.key === 'paye').difference === 39.61, 'PAYE difference flagged');
  assert(!r.json.income.inIncome && r.json.income.reason === 'Not added to Income.', 'left out of Income when asked');

  // Year-to-date and missing periods (8 Oct, 15 Oct, then 29 Oct → 22 Oct missing).
  await call('POST', '/api/payslips', A, { ...slip, periodStart: '2026-10-22', periodEnd: '2026-10-28', payDate: '2026-10-29', addToIncome: false });
  r = await call('GET', '/api/payslips?year=2026', A);
  assert(r.json.ytd.count === 4 && r.json.payslips.length === 4, 'four payslips this year');
  assert(r.json.ytd.netNzd === 4746.51 && r.json.ytd.grossNzd === 6799.96, `YTD totals ${r.json.ytd.netNzd} ${r.json.ytd.grossNzd}`);
  const acme = r.json.ytd.bySource.find((s: Json) => s.employer === 'Acme Ltd');
  assert(acme.count === 3 && acme.missing.length === 1 && acme.missing[0].after === '2026-10-15', 'a missing week is spotted');
  assert(r.json.history[0].payDate === '2026-10-08', 'history oldest first');
  assert((await call('GET', '/api/payslips?year=2025', A)).json.ytd.count === 0, 'other tax years are separate');

  // Editing the date or amount relinks; moving it far away unlinks.
  r = await call('PUT', `/api/payslips/${p.id}`, A, { ...slip, payDate: '2026-11-28' });
  assert(r.json.income.bankMatch?.transactionId === 't_other', 'relinked to the deposit near the new date');
  r = await call('PUT', `/api/payslips/${p.id}`, A, slip);
  assert(r.json.income.bankMatch?.transactionId === 't_pay', 'and back');

  // A file: private to its owner.
  const png = 'data:image/png;base64,' + Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.alloc(64, 1)]).toString('base64');
  r = await call('POST', `/api/payslips/${p.id}/file`, A, { fileBase64: png });
  assert(r.status === 200 && r.json.fileUrl === `/api/uploads/payslips/${p.id}.png`, 'file saved');
  const fileAbs = path.join(UPLOADS_DIR, 'payslips', `${p.id}.png`);
  assert(fs.existsSync(fileAbs), 'file on disk');
  assert((await fetch(`${base}${r.json.fileUrl}`, { headers: { Cookie: A } })).status === 200, 'owner can open it');
  assert((await fetch(`${base}${r.json.fileUrl}`, { headers: { Cookie: B } })).status === 404, 'another user can’t');

  // Isolation: Ben sees and changes nothing of Ana's.
  assert((await call('GET', '/api/payslips', B)).json.payslips.length === 0, 'Ben sees none of Ana’s payslips');
  assert((await call('PUT', `/api/payslips/${p.id}`, B, slip)).status === 404, 'Ben can’t edit');
  assert((await call('DELETE', `/api/payslips/${p.id}`, B)).status === 404, 'Ben can’t delete');
  assert((await call('POST', `/api/payslips/${p.id}/file`, B, { fileBase64: png })).status === 404, 'Ben can’t upload to it');

  // Deleting the payslip removes its Income row and file; the bank deposit stays.
  assert((await call('DELETE', `/api/payslips/${p.id}`, A)).status === 200, 'deleted');
  assert(!queryOne(db, `SELECT 1 FROM income_records WHERE payslip_id = ?`, [p.id]), 'income row gone');
  assert(queryOne(db, `SELECT 1 FROM transactions WHERE id = 't_pay'`), 'the bank deposit is still there');
  assert(!fs.existsSync(fileAbs), 'file gone');

  // Free plan: no check, no Income, 12 a tax year.
  r = await call('POST', '/api/payslips', B, slip);
  assert(r.status === 201 && r.json.check === null && !r.json.income.inIncome && r.json.income.reason.includes('Plus'), 'free: recorded only');
  for (let i = 1; i < 12; i++) {
    const s = await call('POST', '/api/payslips', B, { ...slip, periodStart: `2026-11-${String(i + 10).padStart(2, '0')}`, periodEnd: `2026-11-${String(i + 10).padStart(2, '0')}`, payDate: '2026-11-28' });
    assert(s.status === 201, `free payslip ${i + 1}`);
  }
  r = await call('POST', '/api/payslips', B, { ...slip, periodStart: '2026-12-01', periodEnd: '2026-12-07', payDate: '2026-12-08' });
  assert(r.status === 402 && r.json.code === 'PLAN_LIMIT', 'the 13th is refused on the free plan');
  assert((await call('POST', '/api/payslips', B, { ...slip, periodStart: '2027-04-01', periodEnd: '2027-04-07', payDate: '2027-04-08' })).status === 201, 'a new tax year starts a new count');
  r = await call('GET', '/api/payslips', B);
  assert(r.json.plan.plus === false && r.json.plan.usedThisYear === 12 && r.json.plan.freeLimit === 12, 'plan shown');

  // Account deletion removes payslips and files.
  const q = await call('POST', '/api/payslips', A, { ...slip, periodStart: '2027-01-01', periodEnd: '2027-01-07', payDate: '2027-01-08' });
  await call('POST', `/api/payslips/${q.json.id}/file`, A, { fileBase64: png });
  const qFile = path.join(UPLOADS_DIR, 'payslips', `${q.json.id}.png`);
  assert(fs.existsSync(qFile), 'second file on disk');
  deleteScopedDataForUser(db, 'ana');
  assert(queryAll(db, `SELECT * FROM payslips WHERE user_id = 'ana'`).length === 0 && !fs.existsSync(qFile), 'account delete removes payslips and files');
  assert(queryAll(db, `SELECT * FROM payslips WHERE user_id = 'ben'`).length === 13, 'other users keep theirs');
  console.log('payslips tests passed');
} finally {
  server.close();
  fs.rmSync(dataDir, { recursive: true, force: true });
}
