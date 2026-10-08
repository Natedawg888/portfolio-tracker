/**
 * Financial health score API (KAN-55): auth, per-user data, not-enough-data, and the score
 * moving when the underlying data changes.
 * Run: npm run test:health-score
 *
 * Uses a throwaway sqlite file. Does not read or write data/portfolio.db.
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import type { AddressInfo } from 'node:net';
import type { Server } from 'node:http';
import express from 'express';

const dbPath = path.join(os.tmpdir(), `pt-health-${process.pid}-${Date.now()}.db`);
process.env.DATABASE_PATH = dbPath;
for (const suffix of ['', '.tmp', '-wal', '-shm']) {
  const p = `${dbPath}${suffix}`;
  if (fs.existsSync(p)) fs.unlinkSync(p);
}

function assert(cond: unknown, msg: string): void {
  if (!cond) throw new Error(`FAIL: ${msg}`);
}

const { getDb, run } = await import('../db/index.ts');
const { seedCategoriesForUser, resolveCategoryId } = await import('../lib/categories.ts');
const { createSession, SESSION_COOKIE } = await import('../auth/sessions.ts');
const { attachUser, requireAuth, isPublicApiPath } = await import('../middleware/requireAuth.ts');
const { aucklandToday } = await import('../debts/model.ts');
const { completeMonthsBefore } = await import('../projections/model.ts');
const { default: healthRouter } = await import('../routes/healthScore.ts');

const userA = 'health_a';
const userB = 'health_b';
const now = '2026-10-05T00:00:00.000Z';
const db = await getDb();
for (const [id, email] of [[userA, 'a@example.com'], [userB, 'b@example.com']]) {
  run(db, `INSERT INTO users (id, email, password_hash, created_at, updated_at) VALUES (?,?,?,?,?)`, [id, email, 'hash', now, now]);
  seedCategoriesForUser(db, id);
}
const salary = resolveCategoryId(db, userA, 'cat-income-salary');
const food = resolveCategoryId(db, userA, 'cat-food');
const inv = resolveCategoryId(db, userA, 'cat-investments');
run(
  db,
  `INSERT INTO bank_accounts (id, user_id, name, institution, account_type, currency, balance, created_at, updated_at)
   VALUES ('acct_h', ?, 'Everyday', 'Kiwibank', 'cheque', 'NZD', 24000, ?, ?)`,
  [userA, now, now],
);
// Six months: income 5000, spending 4000, 500 to Investments → 20% saved, 6 months cash, 10% invested.
for (const [i, ym] of completeMonthsBefore(aucklandToday(), 6).entries()) {
  run(db, `INSERT INTO income_records (id, user_id, date, amount_nzd, kind, description, category_id, created_at) VALUES (?,?,?,?,?,?,?,?)`, [`hi${i}`, userA, `${ym}-05`, 5000, 'cash', 'pay', salary, now]);
  run(db, `INSERT INTO transactions (id, user_id, account_id, date, description, amount, kind, category_id, currency, source, created_at) VALUES (?,?,?,?,?,?,?,?,?,?,?)`, [`hs${i}`, userA, 'acct_h', `${ym}-06`, 'food', -4000, 'debit', food, 'NZD', 'manual', now]);
  run(db, `INSERT INTO transactions (id, user_id, account_id, date, description, amount, kind, category_id, currency, source, created_at) VALUES (?,?,?,?,?,?,?,?,?,?,?)`, [`hv${i}`, userA, 'acct_h', `${ym}-07`, 'Sharesies', -500, 'debit', inv, 'NZD', 'manual', now]);
}

const app = express();
app.use(express.json());
app.use('/api', attachUser);
app.use('/api', (req, res, next) => (isPublicApiPath(req.path) ? next() : requireAuth(req, res, next)));
app.use('/api/health-score', healthRouter);
const server: Server = await new Promise((resolve) => {
  const s = app.listen(0, '127.0.0.1', () => resolve(s));
});
const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
async function get(cookie?: string): Promise<{ status: number; json: Record<string, any> }> {
  const res = await fetch(`${base}/api/health-score`, { headers: cookie ? { Cookie: cookie } : {} });
  return { status: res.status, json: (await res.json().catch(() => ({}))) as Record<string, any> };
}

try {
  assert((await get()).status === 401, 'signed out is 401');
  const A = `${SESSION_COOKIE}=${(await createSession(userA)).rawToken}`;
  const B = `${SESSION_COOKIE}=${(await createSession(userB)).rawToken}`;

  const a = await get(A);
  assert(a.status === 200, 'signed in is 200');
  assert(a.json.score === 100 && a.json.band === 'strong', `A scores 100 (got ${a.json.score})`);
  assert(a.json.checks.length === 5 && a.json.windowMonths === 6, 'five checks over six months');
  assert(typeof a.json.summary === 'string' && a.json.summary.length > 0, 'short explanation');

  const b = await get(B);
  assert(b.json.score === null && b.json.summary.startsWith('Not enough data'), 'user B has no data, no score, and is not given A’s');

  // A card balance and a personal debt bring the score down straight away.
  run(
    db,
    `INSERT INTO bank_accounts (id, user_id, name, institution, account_type, currency, balance, created_at, updated_at)
     VALUES ('card_h', ?, 'Card', 'Kiwibank', 'credit', 'NZD', -6000, ?, ?)`,
    [userA, now, now],
  );
  const afterCard = await get(A);
  const debt = afterCard.json.checks.find((c: Record<string, unknown>) => c.key === 'debt');
  // 6000 of 60,000 yearly income = 10% → 80 on the debt check.
  assert(debt.score === 80, `card debt counted (got ${debt.score})`);
  assert(afterCard.json.score < 100, 'overall score drops when debt is added');

  console.log('health score api tests ok');
} finally {
  await new Promise<void>((resolve, reject) => server.close((err) => (err ? reject(err) : resolve())));
  for (const suffix of ['', '.tmp', '-wal', '-shm']) {
    const p = `${dbPath}${suffix}`;
    if (fs.existsSync(p)) fs.unlinkSync(p);
  }
}
