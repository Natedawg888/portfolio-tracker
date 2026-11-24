/**
 * Encrypted columns (KAN-112). Phase 1: with DATA_ENCRYPTION=1 a note saved through the API is
 * stored encrypted and reads back in plain for its owner; a locked session or another user gets
 * null; existing plain notes are migrated on sign-in; the report lists unmigrated accounts;
 * with the flag off nothing is encrypted but encrypted values still read. Phase 2: vehicle and
 * crypto details and figures, numbers read back as numbers, locked export refused, snapshot skipped.
 * Run: npm run test:isolation
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

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'pt-fieldcrypto-'));
process.env.DATABASE_PATH = path.join(dir, 'portfolio.db');
process.env.NODE_ENV = 'test';
process.env.DATA_ENCRYPTION = '1';

const { getDb, queryOne, run } = await import('../db/index.ts');
const { default: authRouter } = await import('../routes/auth.ts');
const { default: goalsRouter } = await import('../routes/savingsGoals.ts');
const { default: vehiclesRouter } = await import('../routes/vehicles.ts');
const { attachUser, requireAuth, isPublicApiPath } = await import('../middleware/requireAuth.ts');
const { createSession, SESSION_COOKIE } = await import('../auth/sessions.ts');
const { migrationReport, encryptPendingForUser } = await import('./fieldCrypto.ts');
const { sessionKeyStore } = await import('./dataKey.ts');

const app = express();
app.use(express.json());
app.use('/api', attachUser);
app.use('/api', (req, res, next) => (isPublicApiPath(req.path) ? next() : requireAuth(req, res, next)));
app.use('/api/auth', authRouter);
app.use('/api/savings-goals', goalsRouter);
app.use('/api/vehicles', vehiclesRouter);
const server: Server = await new Promise((r) => {
  const s = app.listen(0, '127.0.0.1', () => r(s));
});
const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
const cookieOf = (r: Response) => r.headers.getSetCookie().find((c) => c.startsWith(`${SESSION_COOKIE}=`))!.split(';')[0];
const wait = () => new Promise((r) => setTimeout(r, 50));
/** The stored value, bypassing the transparent decrypt. */
function raw(db: Awaited<ReturnType<typeof getDb>>, sql: string, params: unknown[]): string | null {
  const stmt = db.prepare(sql);
  stmt.bind(params as never[]);
  const v = stmt.step() ? (Object.values(stmt.getAsObject())[0] as string | null) : null;
  stmt.free();
  return v;
}

try {
  const db = await getDb();
  const PW = 'correct horse battery 9';
  const reg = await fetch(`${base}/api/auth/register`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email: 'enc@example.com', password: PW, firstName: 'En', lastName: 'Crypt' }) });
  const cookie = cookieOf(reg);
  const uid = String(((await reg.json()) as { user: { id: string } }).user.id);

  // Save a goal with a note → stored encrypted, read back plain.
  const created = await fetch(`${base}/api/savings-goals`, { method: 'POST', headers: { Cookie: cookie, 'Content-Type': 'application/json' }, body: JSON.stringify({ name: 'Car', targetNzd: 5000, notes: 'for the trip to Napier' }) });
  eq(created.status, 201, 'goal created');
  await wait();
  const stored = raw(db, `SELECT notes FROM savings_goals WHERE user_id = ?`, [uid])!;
  eq(stored.startsWith('ue1:') && !stored.includes('Napier'), true, 'note encrypted at rest');
  const list = (await (await fetch(`${base}/api/savings-goals`, { headers: { Cookie: cookie } })).json()) as { goals?: { notes: string | null }[] } | { notes: string | null }[];
  const goals = Array.isArray(list) ? list : (list.goals ?? []);
  eq(goals[0]?.notes, 'for the trip to Napier', 'owner reads it in plain');

  // A locked session (no key) reads null, not ciphertext.
  const locked = await createSession(uid);
  const lockedList = (await (await fetch(`${base}/api/savings-goals`, { headers: { Cookie: `${SESSION_COOKIE}=${locked.rawToken}` } })).json()) as { goals?: { notes: string | null }[] } | { notes: string | null }[];
  const lg = Array.isArray(lockedList) ? lockedList : (lockedList.goals ?? []);
  eq(lg[0]?.notes, null, 'locked session: null');
  eq(queryOne<{ notes: string | null }>(db, `SELECT notes FROM savings_goals WHERE user_id = ?`, [uid])!.notes, null, 'no request context (a job): null');
  const blocked = await fetch(`${base}/api/savings-goals`, { method: 'POST', headers: { Cookie: `${SESSION_COOKIE}=${locked.rawToken}`, 'Content-Type': 'application/json' }, body: JSON.stringify({ name: 'X', targetNzd: 1 }) });
  eq([blocked.status, ((await blocked.json()) as { code: string }).code], [423, 'DATA_LOCKED'], 'locked session cannot write');

  // Existing plain notes are migrated on sign-in.
  run(db, `INSERT INTO savings_goals (id, user_id, name, notes, target_nzd, current_amount_nzd, created_at, updated_at) VALUES ('g_old', ?, 'Old', 'plain old note', 100, 0, ?, ?)`, [uid, new Date().toISOString(), new Date().toISOString()]);
  eq(migrationReport(db).find((r) => r.userId === uid)?.plainValues, 3, 'report: the plain note and both goal amounts waiting');
  const login = await fetch(`${base}/api/auth/login`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email: 'enc@example.com', password: PW }) });
  eq(login.status, 200, 'signed in');
  eq(raw(db, `SELECT notes FROM savings_goals WHERE id = 'g_old'`, [])!.startsWith('ue1:'), true, 'migrated on sign-in');
  eq(migrationReport(db).some((r) => r.userId === uid), false, 'report clear');

  // Another user's key can't open it (AAD is the owner's id).
  const reg2 = await fetch(`${base}/api/auth/register`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email: 'other@example.com', password: PW, firstName: 'Ot', lastName: 'Her' }) });
  const uid2 = String(((await reg2.json()) as { user: { id: string } }).user.id);
  const otherKey = sessionKeyStore.forUser(uid2)!;
  const { decryptField } = await import('./dataKey.ts');
  eq(decryptField(otherKey, stored, uid2), null, "another user's key fails");

  // Phase 2: vehicle details and figures are encrypted; numbers read back as numbers.
  const ownCookie = cookieOf(login);
  const vBody = { name: 'Hilux', kind: 'ute', make: 'Toyota', model: 'Hilux SR5', plate: 'abc123', purchasePriceNzd: 41250.5, loan: { kind: 'manual', balanceNzd: 18000, ratePct: 9.95, repaymentNzd: 420, repaymentFrequency: 'month', lender: 'UDC Finance' }, odometer: { reading: 120000, atPurchase: 0 } };
  const vRes = await fetch(`${base}/api/vehicles`, { method: 'POST', headers: { Cookie: ownCookie, 'Content-Type': 'application/json' }, body: JSON.stringify(vBody) });
  eq(vRes.status, 201, 'vehicle created');
  await wait();
  for (const col of ['make', 'model', 'plate', 'loan_lender', 'purchase_price_nzd', 'loan_balance_nzd', 'loan_rate_pct', 'loan_repayment_nzd', 'odometer', 'odometer_at_purchase']) {
    const v = raw(db, `SELECT ${col} FROM vehicles WHERE user_id = ?`, [uid]);
    eq(typeof v === 'string' && v.startsWith('ue1:'), true, `vehicles.${col} encrypted at rest (0 included)`);
  }
  eq(raw(db, `SELECT name FROM vehicles WHERE user_id = ?`, [uid]), 'Hilux', 'name stays plain (sorted and searched in SQL)');
  type V = { make: string | null; plate: string | null; purchasePriceNzd: number | null; loan: { balanceNzd: number | null; ratePct: number | null }; odometer: { reading: number | null; atPurchase: number | null } };
  const vehiclesOf = async (c: string) => {
    const j = (await (await fetch(`${base}/api/vehicles`, { headers: { Cookie: c } })).json()) as V[] | { vehicles: V[] };
    return Array.isArray(j) ? j : j.vehicles;
  };
  const [mine] = await vehiclesOf(ownCookie);
  eq([mine.make, mine.plate, mine.purchasePriceNzd, mine.loan.balanceNzd, mine.loan.ratePct, mine.odometer.reading, mine.odometer.atPurchase], ['Toyota', 'ABC123', 41250.5, 18000, 9.95, 120000, 0], 'owner reads plain values, numbers as numbers');
  const [lockedV] = await vehiclesOf(`${SESSION_COOKIE}=${locked.rawToken}`);
  eq([lockedV.make, lockedV.purchasePriceNzd], [null, null], 'locked session: null');

  // A number's ciphertext only opens as a number, and a note's only as text (the type is in the AAD).
  const { decryptField: open } = await import('./dataKey.ts');
  const ownKey = sessionKeyStore.forUser(uid)!;
  const priceSealed = raw(db, `SELECT purchase_price_nzd FROM vehicles WHERE user_id = ?`, [uid])!;
  eq([open(ownKey, priceSealed, uid), open(ownKey, priceSealed, `${uid}#n`)], [null, '41250.5'], 'number sealed under <userId>#n');

  // Locked sessions can't export (it would hand out nulls), and skip the daily snapshot.
  const lockedExport = await fetch(`${base}/api/auth/export`, { headers: { Cookie: `${SESSION_COOKIE}=${locked.rawToken}` } });
  eq([lockedExport.status, ((await lockedExport.json()) as { code: string }).code], [423, 'DATA_LOCKED'], 'locked export refused');
  eq((await fetch(`${base}/api/auth/export`, { headers: { Cookie: ownCookie } })).status, 200, 'unlocked export works');
  const { lockedOutOfData, runWithCryptoContext } = await import('./fieldCrypto.ts');
  const { recordDailySnapshot } = await import('../lib/dailySnapshot.ts');
  eq(lockedOutOfData(db, uid), true, 'no request context: locked out');
  eq(runWithCryptoContext({ userId: uid, key: ownKey }, () => lockedOutOfData(db, uid)), false, 'unlocked: not locked out');
  eq(lockedOutOfData(db, uid2), false, 'nothing encrypted yet: not locked out');
  const fakeNw = { totalKnownNzd: 1, cryptoWalletsFailed: 0 } as Parameters<typeof recordDailySnapshot>[2];
  eq(recordDailySnapshot(db, uid, fakeNw), 'skipped', 'locked: daily snapshot skipped');

  // Existing plain figures (including payslips and crypto) are migrated on sign-in.
  const now = new Date().toISOString();
  run(db, `INSERT INTO crypto_txns (id, user_id, date, kind, asset, amount, nzd_value, fee_nzd, counterparty, created_at, updated_at) VALUES ('c_old', ?, '2026-01-02', 'buy', 'BTC', 0.01, 1500, 2.5, 'Easy Crypto', ?, ?)`, [uid, now, now]);
  eq((migrationReport(db).find((r) => r.userId === uid)?.plainValues ?? 0) >= 3, true, 'report counts plain figures');
  await fetch(`${base}/api/auth/login`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email: 'enc@example.com', password: PW }) });
  for (const col of ['nzd_value', 'fee_nzd', 'counterparty']) eq(raw(db, `SELECT ${col} FROM crypto_txns WHERE id = 'c_old'`, [])!.startsWith('ue1:'), true, `crypto_txns.${col} migrated`);
  eq(raw(db, `SELECT amount FROM crypto_txns WHERE id = 'c_old'`, []), 0.01 as unknown as string, 'crypto amount stays plain (totalled in SQL)');
  const back = runWithCryptoContext({ userId: uid, key: sessionKeyStore.forUser(uid)! }, () => queryOne<{ nzd_value: unknown; fee_nzd: unknown; counterparty: unknown }>(db, `SELECT nzd_value, fee_nzd, counterparty FROM crypto_txns WHERE id = 'c_old'`));
  eq(back, { nzd_value: 1500, fee_nzd: 2.5, counterparty: 'Easy Crypto' }, 'migrated values read back with their types');

  // Flag off: nothing new is encrypted; encrypted values still read.
  process.env.DATA_ENCRYPTION = '0';
  run(db, `UPDATE savings_goals SET notes = 'plain again' WHERE id = 'g_old'`);
  eq(encryptPendingForUser(db, uid, sessionKeyStore.forUser(uid)!, run), 0, 'flag off: nothing encrypted');
  const stillReads = (await (await fetch(`${base}/api/savings-goals`, { headers: { Cookie: cookieOf(login) } })).json()) as { goals?: { notes: string | null; name: string }[] } | { notes: string | null; name: string }[];
  const sg = Array.isArray(stillReads) ? stillReads : (stillReads.goals ?? []);
  eq(sg.find((g) => g.name === 'Car')?.notes, 'for the trip to Napier', 'encrypted values still read with the flag off');
  console.log('field crypto tests passed');
} finally {
  server.close();
  fs.rmSync(dir, { recursive: true, force: true });
}
process.exit(0);
