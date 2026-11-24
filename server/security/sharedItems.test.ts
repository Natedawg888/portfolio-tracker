/**
 * Encrypted goals and bills, phase 3 (KAN-112): amounts are encrypted only while the owner hasn't
 * shared the item with their household. Sharing decrypts it (owner unlocked, else 423), members
 * edit shared items without touching the owner's encrypted note, and unsharing encrypts it again.
 * Budgets (3b): plans follow their category's share and are added up in code, not with SUM().
 * Accounts (3c): balance and institution follow the account's share. Holdings (3d): quantities
 * and money follow the holding's share; symbols and names stay plain.
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
const { setShared, updateSharedGoal, updateSharedBill, setSharedBudgetPlan, dashboard } = await import('../households/sharing.ts');
const { planTotalsForMonth } = await import('../budget/planTotals.ts');
const { budgetRows } = await import('../export/userExport.ts');
const { aucklandToday } = await import('../debts/model.ts');
const { computeNetWorth } = await import('../lib/netWorth.ts');
const { candidateAlerts, DEFAULT_ALERT_SETTINGS } = await import('../alerts/store.ts');
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

  // Budgets (phase 3b): plans follow their category's share; totals are added up in code.
  const today = aucklandToday();
  const ym = today.slice(0, 7);
  const monthEnd = new Date(Date.UTC(Number(ym.slice(0, 4)), Number(ym.slice(5, 7)), 0)).toISOString().slice(0, 10);
  run(db, `INSERT INTO budget_categories (id, user_id, name, type) VALUES ('cat_food', 'owner', 'Groceries', 'spending'), ('cat_fun', 'owner', 'Fun', 'spending')`);
  run(db, `INSERT INTO budgets (id, user_id, category_id, period_start, period_end, amount_nzd) VALUES ('p1', 'owner', 'cat_food', ?, ?, 600), ('p2', 'owner', 'cat_fun', ?, ?, 200), ('p3', 'owner', 'cat_fun', ?, ?, 50)`, [`${ym}-01`, monthEnd, `${ym}-01`, monthEnd, `${ym}-15`, monthEnd]);
  encryptPendingForUser(db, 'owner', ownerKey, run);
  eq(['p1', 'p2', 'p3'].map((id) => sealed(raw(`SELECT amount_nzd FROM budgets WHERE id='${id}'`))), [true, true, true], 'unshared plans encrypted');
  eq(asOwner(() => planTotalsForMonth(db, 'owner', ym).get('cat_fun')), { total: 250, n: 2 }, 'owner: plans added up in code, not SUM() over ciphertext');
  eq(planTotalsForMonth(db, 'owner', ym).get('cat_fun'), { total: 0, n: 0 }, 'no key: unreadable plans left out (n = 0 means no plan), not added as 0');
  const exported = asOwner(() => budgetRows(db, 'owner', [ym])).find((r) => r[1] === 'Fun');
  eq(exported?.[3], '250', 'export shows the real planned total');

  eq(asOwner(() => setShared(db, 'owner', { kind: 'budget', itemId: 'cat_food', shared: true })).ok, true, 'owner shares the Groceries budget');
  eq(raw(`SELECT amount_nzd FROM budgets WHERE id='p1'`), 600, 'shared category plans are plain');
  eq(sealed(raw(`SELECT amount_nzd FROM budgets WHERE id='p2'`)), true, 'other categories stay encrypted');
  const dash = await asMember(() => dashboard(db, 'member'));
  eq(dash.ok ? dash.value.budgets.map((b) => [b.name, b.plannedNzd]) : dash, [['Groceries', 600]], 'member sees the shared plan on the dashboard');
  eq(asMember(() => setSharedBudgetPlan(db, 'member', 'cat_food', { amountNzd: 650 })).ok, true, 'member changes the shared plan');
  encryptPendingForUser(db, 'owner', ownerKey, run);
  eq(raw(`SELECT amount_nzd FROM budgets WHERE id='p1'`), 650, "member's change saved plain and left plain");
  eq(migrationReport(db).some((r) => r.userId === 'owner'), false, 'report: nothing pending');

  // Overspend alerts check plan > 0 in code: an encrypted $0 plan must not raise a false alert.
  run(db, `INSERT INTO budget_categories (id, user_id, name, type) VALUES ('cat_zero', 'owner', 'Zero', 'spending')`);
  run(db, `INSERT INTO budgets (id, user_id, category_id, period_start, period_end, amount_nzd) VALUES ('p0', 'owner', 'cat_zero', ?, ?, 0)`, [`${ym}-01`, monthEnd]);
  run(db, `INSERT INTO transactions (id, user_id, date, description, amount, category_id, created_at) VALUES ('t0', 'owner', ?, 'Spend', -40, 'cat_zero', ?)`, [today, now]);
  encryptPendingForUser(db, 'owner', ownerKey, run);
  eq(sealed(raw(`SELECT amount_nzd FROM budgets WHERE id='p0'`)), true, '$0 plan encrypted');
  const alerts = asOwner(() => candidateAlerts(db, 'owner', today, DEFAULT_ALERT_SETTINGS)).filter((a) => a.kind === 'overspend' && a.key.includes('cat_zero'));
  eq(alerts.length, 0, 'no false overspend alert for an encrypted $0 plan');

  // Accounts (phase 3c): balance and institution follow the account's share.
  run(db, `INSERT INTO bank_accounts (id, user_id, name, institution, account_type, currency, balance, created_at, updated_at) VALUES ('acc_joint', 'owner', 'Joint', 'Kiwibank', 'cheque', 'NZD', 2400.25, ?, ?), ('acc_mine', 'owner', 'Mine', 'ASB', 'savings', 'NZD', 9100, ?, ?)`, [now, now, now, now]);
  encryptPendingForUser(db, 'owner', ownerKey, run);
  eq(['balance', 'institution'].map((c) => sealed(raw(`SELECT ${c} FROM bank_accounts WHERE id='acc_mine'`))), [true, true], 'account balance and institution encrypted');
  eq(raw(`SELECT name FROM bank_accounts WHERE id='acc_mine'`), 'Mine', 'account name stays plain (sorted in SQL)');
  const nw = await asOwner(() => computeNetWorth(db, 'owner'));
  eq(nw.cashNzd, 11500.25, "owner's net worth adds up decrypted balances");
  eq(asOwner(() => setShared(db, 'owner', { kind: 'account', itemId: 'acc_joint', shared: true })).ok, true, 'owner shares the joint account');
  eq([raw(`SELECT balance FROM bank_accounts WHERE id='acc_joint'`), raw(`SELECT institution FROM bank_accounts WHERE id='acc_joint'`)], [2400.25, 'Kiwibank'], 'shared account is plain');
  encryptPendingForUser(db, 'owner', ownerKey, run);
  eq(raw(`SELECT balance FROM bank_accounts WHERE id='acc_joint'`), 2400.25, 'encrypt pass leaves the shared account plain');
  const dash2 = await asMember(() => dashboard(db, 'member'));
  eq(dash2.ok ? dash2.value.netWorth.accounts.map((a) => [a.name, a.balanceNzd]) : dash2, [['Joint', 2400.25]], 'member sees the shared balance, not the private one');

  // Holdings (phase 3d): quantities and money follow the holding's share; identifiers stay plain.
  run(db, `INSERT INTO holdings (id, user_id, asset_class, name, property_value_nzd, mortgage_outstanding_nzd, cost_basis_nzd, created_at, updated_at) VALUES ('h_home', 'owner', 'real_estate', 'Home', 850000, 400000, 600000, ?, ?), ('h_bach', 'owner', 'real_estate', 'Bach', 420000, 0, 300000, ?, ?)`, [now, now, now, now]);
  run(db, `INSERT INTO holdings (id, user_id, asset_class, name, symbol, shares, cost_basis_nzd, created_at, updated_at) VALUES ('h_stock', 'owner', 'stock', 'Fisher & Paykel', 'FPH', 120.5, 3100, ?, ?)`, [now, now]);
  encryptPendingForUser(db, 'owner', ownerKey, run);
  eq(['property_value_nzd', 'mortgage_outstanding_nzd', 'cost_basis_nzd'].map((c) => sealed(raw(`SELECT ${c} FROM holdings WHERE id='h_bach'`))), [true, true, true], 'holding figures encrypted (0 included)');
  eq([sealed(raw(`SELECT shares FROM holdings WHERE id='h_stock'`)), raw(`SELECT symbol FROM holdings WHERE id='h_stock'`), raw(`SELECT name FROM holdings WHERE id='h_stock'`)], [true, 'FPH', 'Fisher & Paykel'], 'shares encrypted; symbol and name stay plain for quote lookups');
  const ownerNw = await asOwner(() => computeNetWorth(db, 'owner'));
  const ownerPoint = (id: string) => ownerNw.breakdown.holdings.find((p) => p.id === id)?.valueNzd;
  eq([ownerPoint('h_home'), ownerPoint('h_bach')].every((v) => typeof v === 'number' && v > 0), true, 'owner net worth values the encrypted holdings');
  eq(asOwner(() => setShared(db, 'owner', { kind: 'holding', itemId: 'h_home', shared: true })).ok, true, 'owner shares the home');
  eq([raw(`SELECT property_value_nzd FROM holdings WHERE id='h_home'`), sealed(raw(`SELECT property_value_nzd FROM holdings WHERE id='h_bach'`))], [850000, true], 'shared holding plain, the other still encrypted');
  encryptPendingForUser(db, 'owner', ownerKey, run);
  eq(raw(`SELECT mortgage_outstanding_nzd FROM holdings WHERE id='h_home'`), 400000, 'encrypt pass leaves the shared holding plain');
  const dash3 = await asMember(() => dashboard(db, 'member'));
  eq(dash3.ok ? dash3.value.netWorth.holdings.map((h) => [h.name, h.valueNzd]) : dash3, [['Home', ownerPoint('h_home')]], "member sees the shared holding at the owner's valuation, nothing else");
  eq(migrationReport(db).some((r) => r.userId === 'owner'), false, 'report: nothing pending after holdings');
  console.log('shared items tests passed');
} finally {
  fs.rmSync(dir, { recursive: true, force: true });
}
process.exit(0);
