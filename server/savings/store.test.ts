/**
 * Savings goals stay on the user who saved them, and the HTTP API matches
 * the counted figures. Run: npm run test:savings-goals
 *
 * Uses a throwaway sqlite file. Does not read or write data/portfolio.db.
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import type { AddressInfo } from 'node:net';
import type { Server } from 'node:http';
import express from 'express';

const dbPath = path.join(os.tmpdir(), `pt-savings-${process.pid}-${Date.now()}.db`);
process.env.DATABASE_PATH = dbPath;
for (const suffix of ['', '.tmp', '-wal', '-shm']) {
  const p = `${dbPath}${suffix}`;
  if (fs.existsSync(p)) fs.unlinkSync(p);
}

function assert(cond: unknown, msg: string): void {
  if (!cond) throw new Error(`FAIL: ${msg}`);
}

function eq(actual: number | null | undefined, expected: number, msg: string): void {
  if (actual == null || Math.abs(actual - expected) > 1e-9) {
    throw new Error(`FAIL: ${msg} (got ${actual}, expected ${expected})`);
  }
}

const { getDb, queryOne, run } = await import('../db/index.ts');
const { claimUnscopedRowsForOwner, deleteScopedDataForUser } = await import('../lib/userScope.ts');
const { createSession, SESSION_COOKIE } = await import('../auth/sessions.ts');
const { attachUser, requireAuth, isPublicApiPath } = await import('../middleware/requireAuth.ts');
const { aucklandToday } = await import('../debts/model.ts');
const { savingsGoalProgress } = await import('./model.ts');
const { createSavingsGoal, getSavingsGoal, listSavingsGoals, updateSavingsGoal } = await import('./store.ts');
const { default: savingsGoalsRouter } = await import('../routes/savingsGoals.ts');

const userA = 'savings_user_a';
const userB = 'savings_user_b';
const now = '2026-10-05T00:00:00.000Z';
const asOf = '2026-10-05';

const db = await getDb();
const table = queryOne<{ name?: string }>(
  db,
  `SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'savings_goals'`,
);
assert(table?.name === 'savings_goals', 'schema creates savings_goals');

run(
  db,
  `INSERT INTO users (id, email, password_hash, created_at, updated_at) VALUES (?,?,?,?,?)`,
  [userA, 'a@example.com', 'hash', now, now],
);
run(
  db,
  `INSERT INTO users (id, email, password_hash, created_at, updated_at) VALUES (?,?,?,?,?)`,
  [userB, 'b@example.com', 'hash', now, now],
);

const goalA = createSavingsGoal(
  db,
  userA,
  {
    name: 'Holiday',
    notes: 'Queenstown',
    targetNzd: 10000,
    currentAmountNzd: 2500,
    deadline: '2027-04-05',
  },
  asOf,
);
assert(goalA.id.startsWith('sgoal_'), 'ids use the sgoal prefix');
eq(goalA.targetNzd, 10000, 'stored target');
eq(goalA.currentAmountNzd, 2500, 'stored current amount');
assert(goalA.deadline === '2027-04-05', 'stored deadline');
eq(goalA.requiredWeeklySavingNzd, 288.46, 'store returns the weekly figure');
eq(goalA.requiredMonthlySavingNzd, 1254.29, 'store returns the monthly figure');
eq(goalA.percentComplete, 25, 'store returns percent complete');
assert(goalA.estimatedCompletion === '2027-04-05', 'store returns estimated completion');

const goalB = createSavingsGoal(
  db,
  userB,
  {
    name: 'Emergency',
    notes: null,
    targetNzd: 5000,
    currentAmountNzd: 500,
    deadline: null,
  },
  asOf,
);
assert(getSavingsGoal(db, userA, goalB.id, asOf) == null, 'user A cannot read user B');
assert(getSavingsGoal(db, userB, goalA.id, asOf) == null, 'user B cannot read user A');
assert(listSavingsGoals(db, userA, asOf).every((g) => g.id !== goalB.id), 'user A list hides user B');
assert(updateSavingsGoal(db, userB, goalA.id, { currentAmountNzd: 9999 }, asOf) == null, 'user B cannot patch user A');
eq(getSavingsGoal(db, userA, goalA.id, asOf)!.currentAmountNzd, 2500, 'failed patch leaves user A unchanged');

const later = createSavingsGoal(
  db,
  userA,
  { name: 'House', notes: null, targetNzd: 80000, currentAmountNzd: 0, deadline: '2028-01-01' },
  asOf,
);
createSavingsGoal(
  db,
  userA,
  { name: 'alpha fund', notes: null, targetNzd: 100, currentAmountNzd: 10, deadline: null },
  asOf,
);
const order = listSavingsGoals(db, userA, asOf).map((g) => g.name);
assert(
  JSON.stringify(order) === JSON.stringify(['Holiday', 'House', 'alpha fund']),
  `deadlines sort first, blank last (got ${order.join(', ')})`,
);

const patched = updateSavingsGoal(db, userA, goalA.id, { currentAmountNzd: 10000 }, asOf);
assert(patched != null, 'owner can update current amount');
eq(patched!.percentComplete, 100, 'updating current amount recomputes percent');
eq(patched!.requiredWeeklySavingNzd, 0, 'a met goal requires no weekly saving');
assert(patched!.estimatedCompletion === asOf, 'a met goal estimates completion on asOf');

const cleared = updateSavingsGoal(db, userA, later.id, { deadline: null, notes: 'someday' }, asOf);
assert(cleared!.deadline == null, 'deadline can be cleared');
assert(cleared!.requiredWeeklySavingNzd == null, 'clearing the deadline clears the weekly pace');
assert(cleared!.notes === 'someday', 'notes can be set');

run(
  db,
  `INSERT INTO savings_goals (
     id, user_id, name, notes, target_nzd, current_amount_nzd, deadline, created_at, updated_at
   ) VALUES (?,?,?,?,?,?,?,?,?)`,
  ['sgoal_unscoped', null, 'Legacy', null, 20, 5, null, now, now],
);
claimUnscopedRowsForOwner(db, userA);
const claimed = getSavingsGoal(db, userA, 'sgoal_unscoped', asOf);
assert(claimed?.name === 'Legacy', 'unscoped goals are claimed by the data owner');
assert(getSavingsGoal(db, userB, 'sgoal_unscoped', asOf) == null, 'the other user does not receive the claim');

const removed = deleteScopedDataForUser(db, userA);
assert((removed.tables.savings_goals ?? 0) >= 1, 'account delete counts savings goals');
assert(listSavingsGoals(db, userA, asOf).length === 0, 'account delete removes that user’s goals');
assert(getSavingsGoal(db, userB, goalB.id, asOf)?.name === 'Emergency', 'account delete leaves the other user');

const freshA = createSavingsGoal(
  db,
  userA,
  { name: 'Holiday', notes: null, targetNzd: 10000, currentAmountNzd: 2500, deadline: '2027-04-05' },
  asOf,
);

const app = express();
app.use(express.json());
app.use('/api', attachUser);
app.use('/api', (req, res, next) => {
  if (isPublicApiPath(req.path)) return next();
  return requireAuth(req, res, next);
});
app.use('/api/savings-goals', savingsGoalsRouter);

const server: Server = await new Promise((resolve) => {
  const listening = app.listen(0, '127.0.0.1', () => resolve(listening));
});
const port = (server.address() as AddressInfo).port;
const base = `http://127.0.0.1:${port}`;

async function call(
  method: string,
  pathname: string,
  cookie?: string,
  body?: unknown,
): Promise<{ status: number; json: Record<string, unknown> }> {
  const headers: Record<string, string> = { Accept: 'application/json' };
  if (body !== undefined) headers['Content-Type'] = 'application/json';
  if (cookie) headers.Cookie = cookie;
  const res = await fetch(`${base}${pathname}`, {
    method,
    headers,
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
  const json = (await res.json().catch(() => ({}))) as Record<string, unknown>;
  return { status: res.status, json };
}

const KEYS = [
  'asOf',
  'createdAt',
  'currency',
  'currentAmountNzd',
  'daysRemaining',
  'deadline',
  'estimatedCompletion',
  'id',
  'name',
  'notes',
  'percentComplete',
  'remainingNzd',
  'requiredMonthlySavingNzd',
  'requiredWeeklySavingNzd',
  'targetNzd',
  'timezone',
  'updatedAt',
];

function assertShape(body: Record<string, unknown>, label: string): void {
  const keys = Object.keys(body).sort();
  assert(JSON.stringify(keys) === JSON.stringify([...KEYS].sort()), `${label}: unexpected fields ${keys.join(',')}`);
  for (const key of keys) {
    assert(!/score|health/i.test(key), `${label}: score field ${key}`);
  }
  assert(body.currency === 'NZD', `${label}: currency is NZD`);
  assert(body.timezone === 'Pacific/Auckland', `${label}: timezone is Pacific/Auckland`);
}

try {
  const sessionA = await createSession(userA);
  const sessionB = await createSession(userB);
  const cookieA = `${SESSION_COOKIE}=${sessionA.rawToken}`;
  const cookieB = `${SESSION_COOKIE}=${sessionB.rawToken}`;
  const today = aucklandToday();

  const signedOut = await call('GET', '/api/savings-goals');
  assert(signedOut.status === 401, 'signed-out list is 401');
  assert(signedOut.json.error === 'Authentication required', '401 error text');
  assert(signedOut.json.code === 'UNAUTHORIZED', '401 code');

  const listed = await call('GET', '/api/savings-goals', cookieA);
  assert(listed.status === 200, 'list is 200');
  const rows = listed.json as unknown as Array<Record<string, unknown>>;
  assert(Array.isArray(rows), 'list is an array');
  assert(rows.length === 1, 'user A has the goal recreated after account delete');
  assertShape(rows[0], 'list item');
  assert(rows[0].id === freshA.id, 'list returns the saved id');

  const otherList = await call('GET', '/api/savings-goals', cookieB);
  const otherRows = otherList.json as unknown as Array<Record<string, unknown>>;
  assert(otherList.status === 200 && otherRows.length === 1, 'user B still has their own goal');
  assert(otherRows[0].name === 'Emergency', 'user B sees only their goal');
  assert(otherRows[0].requiredWeeklySavingNzd == null, 'user B goal has no deadline pace');

  const hidden = await call('GET', `/api/savings-goals/${encodeURIComponent(freshA.id)}`, cookieB);
  assert(hidden.status === 404, 'user B cannot open user A');
  assert(hidden.json.error === 'Savings goal not found', 'cross-user read is not found');

  const missing = await call('POST', '/api/savings-goals', cookieA, { name: 'Nope' });
  assert(missing.status === 400, 'missing target is 400');
  assert(missing.json.error === 'targetNzd must be a positive number', 'missing target error');

  const created = await call('POST', '/api/savings-goals', cookieA, {
    name: 'Laptop',
    targetNzd: 2400,
    currentAmountNzd: 600,
    deadline: '2026-12-05',
    notes: 'work',
  });
  assert(created.status === 201, 'create is 201');
  assertShape(created.json, 'created');
  const expected = savingsGoalProgress({
    targetNzd: 2400,
    currentAmountNzd: 600,
    deadline: '2026-12-05',
    asOf: today,
  });
  eq(Number(created.json.percentComplete), expected.percentComplete, 'HTTP percent matches the formula');
  eq(Number(created.json.remainingNzd), expected.remainingNzd, 'HTTP remaining matches the formula');
  assert(created.json.requiredWeeklySavingNzd === expected.requiredWeeklySavingNzd, 'HTTP weekly matches');
  assert(created.json.requiredMonthlySavingNzd === expected.requiredMonthlySavingNzd, 'HTTP monthly matches');
  assert(created.json.estimatedCompletion === expected.estimatedCompletion, 'HTTP estimated completion matches');
  assert(created.json.asOf === today, 'HTTP asOf is Auckland today');
  assert(created.json.daysRemaining === expected.daysRemaining, 'HTTP days remaining matches');

  const id = String(created.json.id);
  const got = await call('GET', `/api/savings-goals/${encodeURIComponent(id)}`, cookieA);
  assert(got.status === 200 && got.json.name === 'Laptop', 'owner can read one goal');

  const updated = await call('PATCH', `/api/savings-goals/${encodeURIComponent(id)}`, cookieA, {
    currentAmountNzd: 2400,
  });
  assert(updated.status === 200, 'patch is 200');
  eq(Number(updated.json.percentComplete), 100, 'patched goal is complete');
  eq(Number(updated.json.requiredWeeklySavingNzd), 0, 'patched goal needs no weekly saving');
  eq(Number(updated.json.requiredMonthlySavingNzd), 0, 'patched goal needs no monthly saving');
  assert(updated.json.estimatedCompletion === today, 'patched completion is Auckland today');

  const stolen = await call('PATCH', `/api/savings-goals/${encodeURIComponent(id)}`, cookieB, {
    name: 'Stolen',
  });
  assert(stolen.status === 404, 'user B cannot patch user A');

  const removedHttp = await call('DELETE', `/api/savings-goals/${encodeURIComponent(id)}`, cookieB);
  assert(removedHttp.status === 404, 'user B cannot delete user A');
  const still = await call('GET', `/api/savings-goals/${encodeURIComponent(id)}`, cookieA);
  assert(still.status === 200 && still.json.name === 'Laptop', 'rejected delete leaves the goal');

  const gone = await call('DELETE', `/api/savings-goals/${encodeURIComponent(id)}`, cookieA);
  assert(gone.status === 200 && gone.json.ok === true && gone.json.id === id, 'owner delete returns ok');
  const after = await call('GET', `/api/savings-goals/${encodeURIComponent(id)}`, cookieA);
  assert(after.status === 404, 'deleted goal is not found');

  console.log('savings goal store tests passed');
} finally {
  await new Promise<void>((resolve, reject) => {
    server.close((err) => (err ? reject(err) : resolve()));
  });
}
