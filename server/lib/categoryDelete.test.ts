/**
 * Deleting a category moves everything that uses it; nothing else is deleted.
 * Run: npm run test:settings-categories
 *
 * Uses a throwaway data dir. Does not touch data/.
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'pt-catdelete-'));
process.env.DATABASE_PATH = path.join(dataDir, 'portfolio.db');
process.env.AUTH_ENCRYPTION_KEY = 'a'.repeat(64);

function assert(cond: unknown, msg: string): void {
  if (!cond) throw new Error(`FAIL: ${msg}`);
}

const { getDb, run, queryOne } = await import('../db/index.ts');
const { categoryUsage, deleteCategory } = await import('./categoryDelete.ts');

const db = await getDb();
const now = '2026-10-16T00:00:00.000Z';
const cat = (id: string, user: string, name: string, type = 'spending') =>
  run(db, `INSERT INTO budget_categories (id, user_id, name, type, is_income) VALUES (?,?,?,?,?)`, [id, user, name, type, type === 'income' ? 1 : 0]);
cat('u1-mining', 'u1', 'Mining');
cat('u1-hobbies', 'u1', 'Hobbies');
cat('u1-salary', 'u1', 'Salary', 'income');
cat('u1-side', 'u1', 'Side income', 'income');
cat('u1-empty', 'u1', 'Unused');
cat('u2-other', 'u2', 'Not yours');

run(db, `INSERT INTO transactions (id, user_id, date, amount, description, category_id, created_at) VALUES ('t1','u1','2026-10-03',-500.61,'GoMining','u1-mining',?)`, [now]);
run(db, `INSERT INTO transactions (id, user_id, date, amount, description, category_id, created_at) VALUES ('t2','u1','2026-10-04',-20,'Paint','u1-hobbies',?)`, [now]);
run(db, `INSERT INTO budgets (id, user_id, category_id, period_start, period_end, amount_nzd, notes) VALUES ('b1','u1','u1-mining','2026-10-01','2026-10-31',300,'Miners')`);
run(db, `INSERT INTO budgets (id, user_id, category_id, period_start, period_end, amount_nzd, notes) VALUES ('b2','u1','u1-hobbies','2026-10-01','2026-10-31',100.25,NULL)`);
run(db, `INSERT INTO budgets (id, user_id, category_id, period_start, period_end, amount_nzd, notes) VALUES ('b3','u1','u1-mining','2026-11-01','2026-11-30',250,NULL)`);
run(db, `INSERT INTO payee_settings (id, user_id, name, name_key, category_id, created_at, updated_at) VALUES ('p1','u1','GoMining','gomining','u1-mining',?,?)`, [now, now]);
run(db, `INSERT INTO recurring_items (id, user_id, name, amount_nzd, cadence, next_due, category_id, created_at, updated_at) VALUES ('r1','u1','Miner fee',12,'monthly','2026-11-01','u1-mining',?,?)`, [now, now]);
run(db, `INSERT INTO income_records (id, user_id, date, amount_nzd, kind, description, category_id, created_at) VALUES ('i1','u1','2026-10-10',90,'cash','Side job','u1-side',?)`, [now]);
run(db, `INSERT INTO income_plans (id, user_id, year_month, category_id, amount_nzd, notes, created_at, updated_at) VALUES ('ip1','u1','2026-10','u1-side',100,'Tutoring',?,?)`, [now, now]);
run(db, `INSERT INTO income_plans (id, user_id, year_month, category_id, amount_nzd, notes, created_at, updated_at) VALUES ('ip2','u1','2026-10','u1-salary',5000,'Pay',?,?)`, [now, now]);

const u = categoryUsage(db, 'u1', 'u1-mining');
assert(u.transactions === 1 && u.budgetPlans === 2 && u.payeeRules === 1 && u.recurring === 1 && u.total === 5, `usage counted (${JSON.stringify(u)})`);
assert(categoryUsage(db, 'u1', 'u1-empty').total === 0, 'unused category');

// In use, no target: refused, nothing changed.
let r = deleteCategory(db, 'u1', 'u1-mining', null);
assert(!r.ok && r.status === 409 && r.usage?.total === 5, 'in use needs a target');
assert(queryOne(db, `SELECT id FROM budget_categories WHERE id='u1-mining'`), 'still there after refusal');
// Bad targets.
assert(!deleteCategory(db, 'u1', 'u1-mining', 'u1-mining').ok, 'not into itself');
assert(!deleteCategory(db, 'u1', 'u1-mining', 'u2-other').ok, "not into someone else's category");
assert(!deleteCategory(db, 'u2', 'u1-mining', 'u2-other').ok, "can't delete someone else's category");

// Different type: refused.
assert(!deleteCategory(db, 'u1', 'u1-mining', 'u1-salary').ok, 'not into a category of another type');

// Hobbies already has an October plan: refused, and nothing moved or changed.
r = deleteCategory(db, 'u1', 'u1-mining', 'u1-hobbies');
assert(!r.ok && r.status === 409 && r.clashMonths?.join() === '2026-10', `plan clash refused (${JSON.stringify(r)})`);
assert(queryOne<{ category_id: string }>(db, `SELECT category_id FROM transactions WHERE id='t1'`)?.category_id === 'u1-mining', 'nothing moved on a clash');
assert(queryOne<{ amount_nzd: number }>(db, `SELECT amount_nzd FROM budgets WHERE id='b2'`)?.amount_nzd === 100.25, "target's plan unchanged");
assert(Number(queryOne<{ n: number }>(db, `SELECT COUNT(*) AS n FROM budgets WHERE user_id='u1'`)?.n) === 3, 'no plan removed on a clash');

// Into a category with no plans: everything moves, every plan kept as it was.
cat('u1-crypto', 'u1', 'Crypto costs');
r = deleteCategory(db, 'u1', 'u1-mining', 'u1-crypto');
assert(r.ok, 'deleted with a target');
assert(!queryOne(db, `SELECT id FROM budget_categories WHERE id='u1-mining'`), 'category gone');
assert(queryOne<{ category_id: string }>(db, `SELECT category_id FROM transactions WHERE id='t1'`)?.category_id === 'u1-crypto', 'transaction moved');
const b1 = queryOne<{ category_id: string; amount_nzd: number; notes: string }>(db, `SELECT category_id, amount_nzd, notes FROM budgets WHERE id='b1'`);
assert(b1?.category_id === 'u1-crypto' && b1.amount_nzd === 300 && b1.notes === 'Miners', `October plan moved unchanged (${JSON.stringify(b1)})`);
assert(queryOne<{ category_id: string }>(db, `SELECT category_id FROM budgets WHERE id='b3'`)?.category_id === 'u1-crypto', 'November plan moved');
assert(Number(queryOne<{ n: number }>(db, `SELECT COUNT(*) AS n FROM budgets WHERE user_id='u1'`)?.n) === 3, 'no plan removed');
assert(queryOne<{ category_id: string }>(db, `SELECT category_id FROM payee_settings WHERE id='p1'`)?.category_id === 'u1-crypto', 'payee rule moved');
assert(queryOne<{ category_id: string }>(db, `SELECT category_id FROM recurring_items WHERE id='r1'`)?.category_id === 'u1-crypto', 'recurring moved');

// Income: same-month plan clash refused; with the clash gone, records and plans move.
r = deleteCategory(db, 'u1', 'u1-side', 'u1-salary');
assert(!r.ok && r.clashMonths?.join() === '2026-10', 'income plan clash refused');
assert(Number(queryOne<{ n: number }>(db, `SELECT COUNT(*) AS n FROM income_plans WHERE user_id='u1'`)?.n) === 2, 'income plans untouched');
cat('u1-tutor', 'u1', 'Tutoring', 'income');
r = deleteCategory(db, 'u1', 'u1-side', 'u1-tutor');
assert(r.ok, 'income category deleted');
assert(queryOne<{ category_id: string }>(db, `SELECT category_id FROM income_records WHERE id='i1'`)?.category_id === 'u1-tutor', 'income record moved');
const ip = queryOne<{ category_id: string; amount_nzd: number }>(db, `SELECT category_id, amount_nzd FROM income_plans WHERE id='ip1'`);
assert(ip?.category_id === 'u1-tutor' && ip.amount_nzd === 100, `income plan moved unchanged (${JSON.stringify(ip)})`);

// Built in: refused.
run(db, `INSERT INTO budget_categories (id, user_id, slug, name, type, is_income) VALUES ('u1-debt','u1','cat-debt','Debt','spending',0)`);
assert(!deleteCategory(db, 'u1', 'u1-debt', null).ok, 'built-in category stays');

// Unused: deleted without a target.
assert(deleteCategory(db, 'u1', 'u1-empty', null).ok, 'unused deletes directly');
assert(queryOne(db, `SELECT id FROM budget_categories WHERE id='u2-other'`), "other user's category untouched");

console.log('categoryDelete.test.ts ok');
fs.rmSync(dataDir, { recursive: true, force: true });
