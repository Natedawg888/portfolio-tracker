/**
 * Encrypted notes, phase 1 (KAN-112): with DATA_ENCRYPTION=1 a note saved through the API is
 * stored encrypted and reads back in plain for its owner; a locked session or another user gets
 * null; existing plain notes are migrated on sign-in; the report lists unmigrated accounts;
 * with the flag off nothing is encrypted but encrypted values still read.
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
  eq(migrationReport(db).find((r) => r.userId === uid)?.plainValues, 1, 'report: one plain note waiting');
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
