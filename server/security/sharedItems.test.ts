/**
 * Encrypted goals and bills, phase 3 (KAN-112): amounts are encrypted only while the owner hasn't
 * shared the item with their household. Sharing decrypts it (owner unlocked, else 423), members
 * edit shared items without touching the owner's encrypted note, and unsharing encrypts it again.
 * Run: npm run test:isolation
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { randomBytes } from 'node:crypto';

function eq(actual: unknown, expected: unknown, msg: string): void {
  if (JSON.stringify(actual) !== JSON.stringify(expected)) throw new Error(`FAIL: ${msg} (got ${JSON.stringify(actual)}, expected ${JSON.stringify(expected)})`);
}

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'pt-shareditems-'));
process.env.DATABASE_PATH = path.join(dir, 'portfolio.db');
process.env.NODE_ENV = 'test';
process.env.DATA_ENCRYPTION = '1';
process.env.PLAN_PLUS_EMAILS = 'owner@x.test';

const { getDb, run } = await import('../db/index.ts');
const { encryptPendingForUser, migrationReport, runWithCryptoContext } = await import('./fieldCrypto.ts');
const { setShared, updateSharedGoal, updateSharedBill } = await import('../households/sharing.ts');
const { listSavingsGoals } = await import('../savings/store.ts');
const { listRecurring } = await import('../recurring/store.ts');

try {
  const db = await getDb();
  const now = new Date().toISOString();
  for (const u of ['owner', 'member']) run(db, `INSERT INTO users (id, email, password_hash, created_at, updated_at) VALUES (?,?,?,?,?)`, [u, `${u}@x.test`, 'hash', now, now]);
  run(db, `INSERT INTO households (id, name, owner_id, created_at, updated_at) VALUES ('h1', 'Home', 'owner', ?, ?)`, [now, now]);
  run(db, `INSERT INTO household_members (household_id, user_id, role, joined_at) VALUES ('h1', 'owner', 'owner', ?), ('h1', 'member', 'adult', ?)`, [now, now]);
  const ownerKey = randomBytes(32);
  const memberKey = randomBytes(32);
  const asOwner = <T>(fn: () => T) => runWithCryptoContext({ userId: 'owner', key: ownerKey }, fn);
  const asMember = <T>(fn: () => T) => runWithCryptoContext({ userId: 'member', key: memberKey }, fn);
  const raw = (sql: string): unknown => {
    const s = db.prepare(sql);
    const v = s.step() ? Object.values(s.getAsObject())[0] : null;
    s.free();
    return v;
  };
  const sealed = (v: unknown) => typeof v === 'string' && v.startsWith('ue1:');

  run(db, `INSERT INTO savings_goals (id, user_id, name, notes, target_nzd, current_amount_nzd, created_at, updated_at) VALUES ('g1', 'owner', 'Holiday', 'private plan', 5000, 1200, ?, ?)`, [now, now]);
  run(db, `INSERT INTO recurring_items (id, user_id, name, kind, amount_nzd, cadence, next_due, notes, created_at, updated_at) VALUES ('b1', 'owner', 'Power', 'bill', 180.5, 'monthly', '2026-12-01', 'account 123', ?, ?)`, [now, now]);
  encryptPendingForUser(db, 'owner', ownerKey, run);
  eq([sealed(raw(`SELECT target_nzd FROM savings_goals WHERE id='g1'`)), sealed(raw(`SELECT current_amount_nzd FROM savings_goals WHERE id='g1'`)), sealed(raw(`SELECT amount_nzd FROM recurring_items WHERE id='b1'`))], [true, true, true], 'unshared goal and bill amounts encrypted');
  eq(raw(`SELECT name FROM recurring_items WHERE id='b1'`), 'Power', 'bill name stays plain (sorted in SQL)');
  const g = asOwner(() => listSavingsGoals(db, 'owner', '2026-11-24'))[0];
  eq([g.targetNzd, g.currentAmountNzd], [5000, 1200], 'owner reads numbers');

  // Sharing needs the owner unlocked; it decrypts the amounts, not the note.
  const locked = runWithCryptoContext({ userId: 'owner', key: null }, () => setShared(db, 'owner', { kind: 'goal', itemId: 'g1', shared: true }));
  eq(locked.ok ? 200 : [locked.status, locked.code], [423, 'DATA_LOCKED'], 'locked owner cannot share an encrypted goal');
  eq(asOwner(() => setShared(db, 'owner', { kind: 'goal', itemId: 'g1', shared: true })).ok, true, 'owner shares the goal');
  eq(asOwner(() => setShared(db, 'owner', { kind: 'bill', itemId: 'b1', shared: true })).ok, true, 'owner shares the bill');
  eq([raw(`SELECT target_nzd FROM savings_goals WHERE id='g1'`), raw(`SELECT amount_nzd FROM recurring_items WHERE id='b1'`)], [5000, 180.5], 'shared amounts are plain');
  eq(sealed(raw(`SELECT notes FROM savings_goals WHERE id='g1'`)), true, 'shared goal keeps its note encrypted');
  encryptPendingForUser(db, 'owner', ownerKey, run);
  eq(raw(`SELECT target_nzd FROM savings_goals WHERE id='g1'`), 5000, 'encrypt pass leaves shared rows plain');
  eq(migrationReport(db).some((r) => r.userId === 'owner'), false, 'report does not count shared rows as pending');

  // A member edits the shared goal and bill in their own session: the owner's note survives.
  const noteBefore = raw(`SELECT notes FROM savings_goals WHERE id='g1'`);
  const billNoteBefore = raw(`SELECT notes FROM recurring_items WHERE id='b1'`);
  eq(asMember(() => updateSharedGoal(db, 'member', 'g1', { targetNzd: 6000 })).ok, true, 'member edits shared goal');
  eq(asMember(() => updateSharedBill(db, 'member', 'b1', { amountNzd: 199 })).ok, true, 'member edits shared bill');
  eq([raw(`SELECT target_nzd FROM savings_goals WHERE id='g1'`), raw(`SELECT notes FROM savings_goals WHERE id='g1'`) === noteBefore], [6000, true], "goal changed; owner's encrypted note untouched");
  eq([raw(`SELECT amount_nzd FROM recurring_items WHERE id='b1'`), raw(`SELECT notes FROM recurring_items WHERE id='b1'`) === billNoteBefore], [199, true], "bill changed; owner's encrypted note untouched");
  const shared = asMember(() => listRecurring(db, 'owner', '2026-11-24').items.find((r) => r.id === 'b1'));
  eq(shared?.amountNzd, 199, 'member reads the shared bill amount');

  // Unsharing: the owner's next pass encrypts it again, and the owner still reads it.
  eq(asOwner(() => setShared(db, 'owner', { kind: 'goal', itemId: 'g1', shared: false })).ok, true, 'owner unshares the goal');
  encryptPendingForUser(db, 'owner', ownerKey, run);
  eq(sealed(raw(`SELECT target_nzd FROM savings_goals WHERE id='g1'`)), true, 'unshared goal encrypted again');
  eq(asOwner(() => listSavingsGoals(db, 'owner', '2026-11-24'))[0].targetNzd, 6000, 'owner reads the re-encrypted value');
  eq(raw(`SELECT amount_nzd FROM recurring_items WHERE id='b1'`), 199, 'still-shared bill stays plain');
  console.log('shared items tests passed');
} finally {
  fs.rmSync(dir, { recursive: true, force: true });
}
process.exit(0);
