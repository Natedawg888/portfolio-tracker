/**
 * CSV / PDF export (KAN-63): budget (plan vs actual by month), portfolio / assets as in net worth,
 * KiwiSaver accounts and history; CSV safety; the summary PDF; isolation; HTTP.
 * Run: npm run test:export
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import type { AddressInfo } from 'node:net';
import type { Server } from 'node:http';
import express from 'express';

function eq(actual: unknown, expected: unknown, msg: string): void {
  if (JSON.stringify(actual) !== JSON.stringify(expected)) throw new Error(`FAIL: ${msg} (got ${JSON.stringify(actual)}, expected ${JSON.stringify(expected)})`);
}
const ok = (c: unknown, msg: string) => eq(Boolean(c), true, msg);

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'pt-export-'));
process.env.DATABASE_PATH = path.join(dir, 'portfolio.db');
process.env.NODE_ENV = 'test';

const { getDb, run } = await import('../db/index.ts');
const { seedCategoriesForUser, resolveCategoryId } = await import('../lib/categories.ts');
const { cell, monthsBetween, exportCsv, exportPdf } = await import('./userExport.ts');
const { createSession, SESSION_COOKIE } = await import('../auth/sessions.ts');
const { attachUser } = await import('../middleware/requireAuth.ts');
const { default: exportRouter } = await import('../routes/export.ts');

eq(monthsBetween('2026-11', '2027-02'), ['2026-11', '2026-12', '2027-01', '2027-02'], 'months across a year end');
eq([cell('=SUM(A1)'), cell('-12.5'), cell('a,b'), cell('say "hi"'), cell(3.456)], ["'=SUM(A1)", '-12.5', '"a,b"', '"say ""hi"""', '3.46'], 'CSV cells: formulas neutralised, numbers kept, quoting');

const db = await getDb();
const now = new Date().toISOString();
for (const [id, e] of [['ex', 'ex@example.com'], ['ot', 'ot@example.com']]) {
  run(db, `INSERT INTO users (id, email, password_hash, created_at, updated_at) VALUES (?,?,?,?,?)`, [id, e, 'h', now, now]);
  seedCategoriesForUser(db, id);
}
const food = resolveCategoryId(db, 'ex', 'cat-food')!;
const salary = resolveCategoryId(db, 'ex', 'cat-income')!;
run(db, `INSERT INTO budgets (id, user_id, category_id, period_start, period_end, amount_nzd) VALUES ('b1','ex',?,'2026-10-01','2026-10-31',500)`, [food]);
run(db, `INSERT INTO transactions (id, user_id, date, description, amount, kind, category_id, created_at, source) VALUES ('t1','ex','2026-10-03','Countdown',-120.5,'debit',?,?,'manual')`, [food, now]);
run(db, `INSERT INTO transactions (id, user_id, date, description, amount, kind, category_id, created_at, source) VALUES ('t2','ex','2026-10-15','Pay',4000,'credit',?,?,'manual')`, [salary, now]);
run(db, `INSERT INTO transactions (id, user_id, date, description, amount, kind, created_at, source) VALUES ('t3','ot','2026-10-03','Secret',-999,'debit',?,'manual')`, [now]);
run(db, `INSERT INTO holdings (id, user_id, asset_class, name, property_value_nzd, created_at, updated_at) VALUES ('h1','ex','real_estate','Flat',500000,?,?)`, [now, now]);
run(db, `INSERT INTO kiwisaver_accounts (id, user_id, name, provider, balance_nzd, returns_nzd, observed_at, created_at, updated_at) VALUES ('k1','ex','Growth','sharesies',30000,2500,'2026-10-31',?,?)`, [now, now]);
run(db, `INSERT INTO kiwisaver_balance_history (id, account_id, observed_at, balance_nzd, returns_nzd, source) VALUES ('kh1','k1','2026-10-01',29000,2000,'manual'),('kh2','k1','2026-12-01',31000,2600,'manual')`, []);
const noWallets = async () => ({ ok: false as const, error: 'none', code: 'none', retryAfterSec: null });

const budget = await exportCsv(db, 'ex', 'budget', '2026-10', '2026-10');
ok(budget.includes('Month,Category,Type,Planned NZD,Actual NZD'), 'budget header');
ok(budget.includes('2026-10,Food & groceries,spending,500,120.5'), `food planned vs actual (${budget})`);
ok(/2026-10,[^,]*,income,,4000/.test(budget), 'income actual with no plan');
ok(!budget.includes('999'), "another user's spending never in the file");
const assets = await exportCsv(db, 'ex', 'assets', '2026-10', '2026-10', noWallets);
ok(assets.includes('Property,Flat,500000'), 'holding valued as in net worth');
ok(/Net worth,,\d/.test(assets), 'net worth total');
const ks = await exportCsv(db, 'ex', 'kiwisaver', '2026-10', '2026-11', noWallets);
ok(ks.includes('Growth,sharesies,30000,2500,2026-10-31'), 'KiwiSaver account');
ok(ks.includes('2026-10-01,Growth,29000') && !ks.includes('2026-12-01'), 'history follows the month range');
const all = await exportCsv(db, 'ex', 'all', '2026-10', '2026-10', noWallets);
ok(['Budget', 'Portfolio and assets', 'KiwiSaver accounts', 'KiwiSaver balance history'].every((t) => all.includes(`\r\n${t}\r\n`) || all.startsWith(`${t}\r\n`)), 'all: titled tables');

const pdf = await exportPdf(db, 'ex', '2026-10', '2026-10', '2026-11-23', noWallets);
ok(Buffer.from(pdf.subarray(0, 5)).toString() === '%PDF-' && pdf.length > 1000, 'summary PDF');

const app = express();
app.use('/api', attachUser);
app.use('/api/export', exportRouter);
const server: Server = await new Promise((r) => {
  const s = app.listen(0, '127.0.0.1', () => r(s));
});
const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
try {
  const cookie = `${SESSION_COOKIE}=${(await createSession('ex')).rawToken}`;
  const r = await fetch(`${base}/api/export/csv?section=budget&from=2026-10&to=2026-10`, { headers: { Cookie: cookie } });
  eq(r.status, 200, 'CSV 200');
  ok(r.headers.get('content-disposition')?.includes('koruledger-budget-2026-10-to-2026-10.csv'), 'file name');
  ok((await r.text()).includes('120.5'), 'CSV body');
  eq((await fetch(`${base}/api/export/csv?section=nope`, { headers: { Cookie: cookie } })).status, 400, 'bad section');
  eq((await fetch(`${base}/api/export/csv?from=2026-12&to=2026-01`, { headers: { Cookie: cookie } })).status, 400, 'from after to');
  const p = await fetch(`${base}/api/export/pdf?from=2026-10&to=2026-10`, { headers: { Cookie: cookie } });
  eq([p.status, p.headers.get('content-type')], [200, 'application/pdf'], 'PDF 200');
  eq((await fetch(`${base}/api/export/csv`)).status, 401, 'signed out');
  console.log('export tests passed');
} finally {
  server.close();
  fs.rmSync(dir, { recursive: true, force: true });
}
process.exit(0);
