/**
 * Saved pay sources (KAN-70) stay on the user who saved them, figures are
 * recomputed on the server, and the typical weekly figure feeds the budget
 * summary, the home snapshot and projections.
 * Run: npm run test:pay-sources
 *
 * Uses a throwaway sqlite file. Does not read or write data/portfolio.db.
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import type { AddressInfo } from 'node:net';
import type { Server } from 'node:http';
import express from 'express';

const dbPath = path.join(os.tmpdir(), `pt-pay-sources-${process.pid}-${Date.now()}.db`);
process.env.DATABASE_PATH = dbPath;
for (const suffix of ['', '.tmp', '-wal', '-shm']) {
  const p = `${dbPath}${suffix}`;
  if (fs.existsSync(p)) fs.unlinkSync(p);
}

function assert(cond: unknown, msg: string): void {
  if (!cond) throw new Error(`FAIL: ${msg}`);
}

function eq(actual: number | null | undefined, expected: number, msg: string): void {
  if (actual == null || Math.abs(actual - expected) > 0.005) {
    throw new Error(`FAIL: ${msg} (got ${actual}, expected ${expected})`);
  }
}

const { getDb, queryOne, run } = await import('../db/index.ts');
const { deleteScopedDataForUser, SCOPED_TABLES } = await import('../lib/userScope.ts');
const { createSession, SESSION_COOKIE } = await import('../auth/sessions.ts');
const { attachUser, requireAuth, isPublicApiPath } = await import('../middleware/requireAuth.ts');
const { homeMonthSnapshot } = await import('../budget/homeSnapshot.ts');
const { savingWithExpectedPay } = await import('../projections/model.ts');
const { parsePaySourceBody } = await import('./model.ts');
const { createPaySource, listPaySources, paySourcesExpected } = await import('./store.ts');
const { default: paySourcesRouter } = await import('../routes/paySources.ts');

const userA = 'pay_user_a';
const userB = 'pay_user_b';
const now = '2026-10-05T00:00:00.000Z';

const db = await getDb();
const table = queryOne<{ name?: string }>(
  db,
  `SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'pay_sources'`,
);
assert(table?.name === 'pay_sources', 'schema creates pay_sources');
assert((SCOPED_TABLES as readonly string[]).includes('pay_sources'), 'pay_sources is a user-scoped table');

for (const [id, email] of [[userA, 'a@example.com'], [userB, 'b@example.com']]) {
  run(
    db,
    `INSERT INTO users (id, email, password_hash, created_at, updated_at) VALUES (?,?,?,?,?)`,
    [id, email, 'hash', now, now],
  );
}

// Validation.
assert(!parsePaySourceBody({ inputs: {} }).ok, 'name required');
assert(!parsePaySourceBody({ name: 'x', inputs: { payType: 'hourly' } }).ok, 'unknown pay type rejected');
assert(!parsePaySourceBody({ name: 'x', taxYear: 1999, inputs: { payType: 'share_of_catch', shareOfCatch: {} } }).ok, 'unknown tax year rejected');
assert(
  !parsePaySourceBody({ name: 'x', inputs: { payType: 'schedular', unit: 'job', schedular: { withholdingRatePct: 150 } } }).ok,
  'withholding over 100% rejected',
);

// Store: share of catch $1,000/week net.
const share = parsePaySourceBody({
  name: 'Deckhand share',
  inputs: { payType: 'share_of_catch', shareOfCatch: { catchValue: 9000, per: 'week', sharePct: 12, expensesPerWeek: 80 } },
});
assert(share.ok, 'share body parses');
const saved = createPaySource(db, userA, share.ok ? share.value : (null as never));
eq(saved.weeklyGrossNzd, 1080, 'saved gross share');
eq(saved.weeklyNetNzd, 1000, 'saved net');
eq(saved.monthlyNetNzd, 4333.33, 'saved monthly');
assert(listPaySources(db, userB).length === 0, 'user B sees none of user A sources');
assert(paySourcesExpected(db, userB) === null, 'no expected pay for user B');

// Feeds: home snapshot and projections.
{
  const snapA = homeMonthSnapshot(db, userA, '2026-10');
  eq(snapA?.expectedPay?.monthlyNetNzd, 4333.33, 'home snapshot shows expected pay');
  eq(snapA?.incomeNzd, 0, 'expected pay is not added to received income');
  assert(homeMonthSnapshot(db, userB, '2026-10')?.expectedPay === null, 'other user snapshot has none');

  const expected = paySourcesExpected(db, userA);
  const used = savingWithExpectedPay({ incomeNzd: 0, spendingNzd: 6000 }, 3, expected);
  eq(used?.monthlyNzd, 2333.33, 'projection saving = expected pay − avg spending');
  assert(used?.reason.includes('1 saved pay source') === true, 'projection reason names the source');
  assert(savingWithExpectedPay({ incomeNzd: 100, spendingNzd: 0 }, 3, expected) === null, 'recorded income wins');
  assert(savingWithExpectedPay({ incomeNzd: 0, spendingNzd: 0 }, 3, null) === null, 'no sources → unchanged');
}

const app = express();
app.use(express.json());
app.use('/api', attachUser);
app.use('/api', (req, res, next) => {
  if (isPublicApiPath(req.path)) return next();
  return requireAuth(req, res, next);
});
app.use('/api/pay-sources', paySourcesRouter);

const server: Server = await new Promise((resolve) => {
  const listening = app.listen(0, '127.0.0.1', () => resolve(listening));
});
const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;

async function call(
  method: string,
  pathname: string,
  cookie?: string,
  body?: unknown,
): Promise<{ status: number; json: Record<string, unknown> & Array<Record<string, unknown>> }> {
  const headers: Record<string, string> = { Accept: 'application/json' };
  if (body !== undefined) headers['Content-Type'] = 'application/json';
  if (cookie) headers.Cookie = cookie;
  const res = await fetch(`${base}${pathname}`, {
    method,
    headers,
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
  const json = (await res.json().catch(() => ({}))) as Record<string, unknown> & Array<Record<string, unknown>>;
  return { status: res.status, json };
}

try {
  const signedOut = await call('GET', '/api/pay-sources');
  assert(signedOut.status === 401, 'signed out is 401');

  const cookieA = `${SESSION_COOKIE}=${(await createSession(userA)).rawToken}`;
  const cookieB = `${SESSION_COOKIE}=${(await createSession(userB)).rawToken}`;

  // Client-sent figures are ignored; the server recomputes from inputs.
  const created = await call('POST', '/api/pay-sources', cookieA, {
    name: 'Orchard contract',
    weeklyNetNzd: 999999,
    inputs: {
      payType: 'schedular',
      unit: 'bin',
      activityNumber: 3,
      schedular: { ratePerUnit: 45, unitsPerWeek: 20, withholdingRatePct: 15, gstRegistered: true },
    },
  });
  assert(created.status === 201, `create returns 201 (got ${created.status})`);
  eq(created.json.weeklyGrossNzd as number, 900, 'server gross');
  eq(created.json.weeklyNetNzd as number, 765, 'server net excludes GST and withholding');
  const id = String(created.json.id);

  const piece = await call('POST', '/api/pay-sources', cookieA, {
    name: 'Kiwifruit picking',
    inputs: {
      payType: 'piece',
      unit: 'bin',
      piece: { ratePerUnit: 2, unitsPerWeek: 300, hoursPerWeek: 40, holidayPayWithWages: true },
      paye: { employment: 'primary', kiwiSaverOptIn: false, ietc: true },
    },
  });
  assert(piece.status === 201, 'piece create');
  eq(piece.json.weeklyGrossNzd as number, 1034.64, 'piece gross topped up to minimum wage plus 8%');

  const listA = await call('GET', '/api/pay-sources', cookieA);
  assert(Array.isArray(listA.json) && listA.json.length === 3, 'user A lists three sources');
  const listB = await call('GET', '/api/pay-sources', cookieB);
  assert(Array.isArray(listB.json) && listB.json.length === 0, 'user B lists none');

  const stolen = await call('PUT', `/api/pay-sources/${encodeURIComponent(id)}`, cookieB, {
    name: 'Mine now',
    inputs: { payType: 'share_of_catch', shareOfCatch: { catchValue: 1, per: 'week', sharePct: 1 } },
  });
  assert(stolen.status === 404, 'other user cannot update');
  const stolenDelete = await call('DELETE', `/api/pay-sources/${encodeURIComponent(id)}`, cookieB);
  assert(stolenDelete.status === 404, 'other user cannot delete');

  const updated = await call('PUT', `/api/pay-sources/${encodeURIComponent(id)}`, cookieA, {
    name: 'Orchard contract',
    inputs: {
      payType: 'schedular',
      unit: 'bin',
      activityNumber: 3,
      schedular: { ratePerUnit: 50, unitsPerWeek: 20, withholdingRatePct: 15, gstRegistered: false },
    },
  });
  assert(updated.status === 200, 'owner update');
  eq(updated.json.weeklyNetNzd as number, 850, 'update recomputes');

  const bad = await call('POST', '/api/pay-sources', cookieA, { name: 'x', inputs: { payType: 'nope' } });
  assert(bad.status === 400, 'bad body is 400');

  const removed = await call('DELETE', `/api/pay-sources/${encodeURIComponent(id)}`, cookieA);
  assert(removed.status === 200 && removed.json.ok === true, 'owner delete');
  assert(listPaySources(db, userA).length === 2, 'two left after delete');

  const wiped = deleteScopedDataForUser(db, userA);
  assert(wiped.tables.pay_sources === 2, 'account delete removes pay sources');
  assert(listPaySources(db, userA).length === 0, 'none left after account delete');

  console.log('pay source store tests passed');
} finally {
  await new Promise<void>((resolve, reject) => {
    server.close((err) => (err ? reject(err) : resolve()));
  });
  for (const suffix of ['', '.tmp', '-wal', '-shm']) {
    const p = `${dbPath}${suffix}`;
    if (fs.existsSync(p)) fs.unlinkSync(p);
  }
}
