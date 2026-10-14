/**
 * Rentals API (KAN-66): properties and entries, validation, Budget / Income mirrors
 * (add, edit, switch off, kind change, delete), bank-deposit and bank-debit matching, user isolation
 * and account delete.
 * Run: npm run test:rentals
 *
 * Uses a throwaway data dir. Does not touch data/.
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import type { AddressInfo } from 'node:net';
import type { Server } from 'node:http';
import express from 'express';

const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'pt-rentals-'));
process.env.DATABASE_PATH = path.join(dataDir, 'portfolio.db');

function assert(cond: unknown, msg: string): void {
  if (!cond) throw new Error(`FAIL: ${msg}`);
}

const { getDb, run, queryAll, queryOne } = await import('../db/index.ts');
const { deleteScopedDataForUser, SCOPED_TABLES } = await import('../lib/userScope.ts');
const { createSession, SESSION_COOKIE } = await import('../auth/sessions.ts');
const { attachUser, requireAuth, isPublicApiPath } = await import('../middleware/requireAuth.ts');
const { default: rentalsRouter } = await import('../routes/rentals.ts');
const { linkRentalExpensesToBankDebits } = await import('./store.ts');
const { default: incomeRouter } = await import('../routes/income.ts');

const userA = 'rent_user_a';
const userB = 'rent_user_b';
const now = '2026-10-05T00:00:00.000Z';
const db = await getDb();
for (const t of ['rental_properties', 'rental_entries']) {
  assert(queryOne(db, `SELECT name FROM sqlite_master WHERE type='table' AND name=?`, [t]), `schema creates ${t}`);
  assert((SCOPED_TABLES as readonly string[]).includes(t), `${t} is user-scoped`);
}
for (const [id, email] of [[userA, 'a@example.com'], [userB, 'b@example.com']]) {
  run(db, `INSERT INTO users (id, email, password_hash, created_at, updated_at) VALUES (?,?,?,?,?)`, [id, email, 'hash', now, now]);
}

const app = express();
app.use(express.json());
app.use('/api', attachUser);
app.use('/api', (req, res, next) => (isPublicApiPath(req.path) ? next() : requireAuth(req, res, next)));
app.use('/api/rentals', rentalsRouter);
app.use('/api/income', incomeRouter);
const server: Server = await new Promise((resolve) => {
  const s = app.listen(0, '127.0.0.1', () => resolve(s));
});
const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
type Json = Record<string, any>;
async function call(method: string, p: string, cookie?: string, body?: unknown): Promise<{ status: number; json: Json }> {
  const headers: Record<string, string> = { Accept: 'application/json' };
  if (body !== undefined) headers['Content-Type'] = 'application/json';
  if (cookie) headers.Cookie = cookie;
  const res = await fetch(`${base}${p}`, { method, headers, body: body !== undefined ? JSON.stringify(body) : undefined });
  return { status: res.status, json: (await res.json().catch(() => ({}))) as Json };
}

const incomeRow = (entryId: string) =>
  queryOne<{ id: string; date: string; amount_nzd: number; description: string; category_id: string; transaction_id: string | null }>(
    db,
    `SELECT * FROM income_records WHERE rental_entry_id = ?`,
    [entryId],
  );
const txnRow = (id: string | null) =>
  id ? queryOne<{ id: string; user_id: string; date: string; amount: number; description: string; category_id: string; kind: string }>(db, `SELECT * FROM transactions WHERE id = ?`, [id]) : null;
const entryTxnId = (entryId: string) =>
  queryOne<{ transaction_id: string | null }>(db, `SELECT transaction_id FROM rental_entries WHERE id = ?`, [entryId])?.transaction_id ?? null;

try {
  assert((await call('GET', '/api/rentals')).status === 401, 'signed out is 401');
  const A = `${SESSION_COOKIE}=${(await createSession(userA)).rawToken}`;
  const B = `${SESSION_COOKIE}=${(await createSession(userB)).rawToken}`;

  const empty = await call('GET', '/api/rentals', A);
  assert(empty.status === 200 && empty.json.properties.length === 0 && empty.json.entries.length === 0, 'empty list');
  assert(empty.json.moneyViewsFrom === '2026-10-01', 'money views start date');

  // Properties.
  assert((await call('POST', '/api/rentals/properties', A, { name: '  ' })).status === 400, 'name required');
  const flat = await call('POST', '/api/rentals/properties', A, { name: '  Grey   Lynn flat ', address: '12 Example St' });
  assert(flat.status === 201 && flat.json.name === 'Grey Lynn flat' && flat.json.address === '12 Example St', 'property created, name tidied');
  const bach = (await call('POST', '/api/rentals/properties', A, { name: 'Bach' })).json;
  const pid = flat.json.id as string;

  // Validation.
  const entry = (body: Json, cookie = A) =>
    call('POST', '/api/rentals/entries', cookie, { propertyId: pid, date: '2026-10-06', kind: 'income', category: 'rent', amountNzd: 650, ...body });
  assert((await entry({ amountNzd: 0 })).status === 400, 'amount must be positive');
  assert((await entry({ amountNzd: -5 })).status === 400, 'no negative amounts');
  assert((await entry({ date: '2026-02-30' })).status === 400, 'date checked');
  assert((await entry({ kind: 'transfer' })).status === 400, 'kind checked');
  assert((await entry({ category: 'rates' })).status === 400, 'expense category not allowed on income');
  assert((await entry({ propertyId: 'nope' })).status === 404, 'unknown property');
  assert((await entry({}, B)).status === 404, 'B cannot add to A’s property');

  // Income → income_records in "Rental income", counted in the Income summary.
  const rent = await entry({ description: 'Week 1 rent' });
  assert(rent.status === 201 && rent.json.inMoneyViews === true && rent.json.addToMoney === true, 'income entry mirrored');
  const inc = incomeRow(rent.json.id)!;
  assert(inc && inc.amount_nzd === 650 && inc.date === '2026-10-06', 'income row amount and date');
  assert(inc.description === 'Week 1 rent · Grey Lynn flat', 'income row description');
  const incCat = queryOne<{ name: string; type: string; user_id: string }>(db, `SELECT name, type, user_id FROM budget_categories WHERE id = ?`, [inc.category_id])!;
  assert(incCat.name === 'Rental income' && incCat.type === 'income' && incCat.user_id === userA, 'rental income category for A');
  const summary = await call('GET', '/api/income/summary?month=2026-10', A);
  assert(summary.json.recordsTotalNzd === 650, 'Income summary counts the rent');

  // Expense → manual spending transaction in "Rental property".
  const rates = await entry({ kind: 'expense', category: 'rates', amountNzd: 812.4, date: '2026-10-20' });
  assert(rates.status === 201 && rates.json.inMoneyViews, 'expense mirrored');
  const t = txnRow(entryTxnId(rates.json.id))!;
  assert(t && t.user_id === userA && t.amount === -812.4 && t.kind === 'debit' && t.date === '2026-10-20', 'spending transaction');
  assert(t.description === 'Rates · Grey Lynn flat', 'category label when no description');
  const expCat = queryOne<{ name: string; type: string }>(db, `SELECT name, type FROM budget_categories WHERE id = ?`, [t.category_id])!;
  assert(expCat.name === 'Rental property' && expCat.type === 'spending', 'rental expense category counts as spending');
  const before = await entry({ kind: 'expense', category: 'repairs', amountNzd: 100, date: '2026-05-01' });
  assert(before.status === 201 && !before.json.inMoneyViews && entryTxnId(before.json.id) === null, 'entries before Budget starts are not mirrored');
  const off = await entry({ amountNzd: 40, category: 'other_income', addToMoney: false });
  assert(!off.json.inMoneyViews && !incomeRow(off.json.id), 'addToMoney false is not mirrored');

  // Edits keep the mirror in step.
  const edited = await call('PATCH', `/api/rentals/entries/${rent.json.id}`, A, { amountNzd: 700, date: '2026-10-07' });
  assert(edited.status === 200 && edited.json.amountNzd === 700, 'entry edited');
  assert(incomeRow(rent.json.id)!.amount_nzd === 700 && incomeRow(rent.json.id)!.date === '2026-10-07', 'income row follows');
  const ratesTxn = entryTxnId(rates.json.id);
  await call('PATCH', `/api/rentals/entries/${rates.json.id}`, A, { amountNzd: 820 });
  assert(entryTxnId(rates.json.id) === ratesTxn && txnRow(ratesTxn)!.amount === -820, 'same transaction updated');
  await call('PATCH', `/api/rentals/properties/${pid}`, A, { name: 'Ponsonby flat' });
  assert(txnRow(ratesTxn)!.description === 'Rates · Ponsonby flat', 'rename updates mirrors');
  assert(incomeRow(rent.json.id)!.description === 'Week 1 rent · Ponsonby flat', 'rename updates income mirror');
  await call('PATCH', `/api/rentals/entries/${rates.json.id}`, A, { addToMoney: false });
  assert(!txnRow(ratesTxn) && entryTxnId(rates.json.id) === null, 'switching off removes the transaction');
  await call('PATCH', `/api/rentals/entries/${rates.json.id}`, A, { addToMoney: true });
  assert(txnRow(entryTxnId(rates.json.id))!.amount === -820, 'switching back on adds it again');
  const flipped = await call('PATCH', `/api/rentals/entries/${rates.json.id}`, A, { kind: 'income' });
  assert(flipped.json.kind === 'income' && flipped.json.category === 'rent', 'kind change picks a matching category');
  assert(entryTxnId(rates.json.id) === null && incomeRow(rates.json.id)?.amount_nzd === 820, 'kind change moves the mirror');
  await call('PATCH', `/api/rentals/entries/${rates.json.id}`, A, { kind: 'expense', category: 'rates' });
  assert(!incomeRow(rates.json.id) && txnRow(entryTxnId(rates.json.id)), 'and back');
  assert((await call('PATCH', `/api/rentals/entries/${rates.json.id}`, A, { category: 'rent' })).status === 400, 'patch checks category against kind');
  assert((await call('PATCH', `/api/rentals/entries/${rates.json.id}`, B, { amountNzd: 1 })).status === 404, 'B cannot edit A’s entry');

  // A mirrored spending transaction deleted in Budget shows as not in money views.
  run(db, `DELETE FROM transactions WHERE id = ?`, [entryTxnId(rates.json.id)]);
  const listed = (await call('GET', '/api/rentals', A)).json;
  assert(listed.entries.find((e: Json) => e.id === rates.json.id).inMoneyViews === false, 'deleted mirror reported');

  // Bank deposit for the same rent links to the income row (not counted twice).
  run(
    db,
    `INSERT INTO transactions (id, user_id, date, description, amount, kind, currency, source, created_at) VALUES (?,?,?,?,?,?,?,?,?)`,
    ['rent_bank', userA, '2026-10-09', 'TENANT RENT', 700, 'credit', 'NZD', 'akahu', now],
  );
  const later = await entry({ amountNzd: 700, date: '2026-10-14' });
  assert(incomeRow(rent.json.id)!.transaction_id === 'rent_bank', 'closest open income row gets the deposit');
  assert(incomeRow(later.json.id)!.transaction_id === null, 'a deposit links to one income row only');

  // Expenses match a bank debit instead of adding a second transaction.
  const bankDebit = (id: string, userId: string, date: string, amount: number, categoryId: string | null = null) =>
    run(
      db,
      `INSERT INTO transactions (id, user_id, date, description, merchant, amount, kind, category_id, currency, source, created_at)
       VALUES (?,?,?,?,?,?, 'debit', ?, 'NZD', 'akahu', ?)`,
      [id, userId, date, 'AUCKLAND COUNCIL RATES', 'Auckland Council', amount, categoryId, now],
    );
  const catOf = (id: string) => queryOne<{ category_id: string | null }>(db, `SELECT category_id FROM transactions WHERE id = ?`, [id])?.category_id ?? null;
  const owned = (entryId: string) => queryOne<{ txn_owned: number }>(db, `SELECT txn_owned FROM rental_entries WHERE id = ?`, [entryId])!.txn_owned;
  const manualCount = () => queryAll(db, `SELECT id FROM transactions WHERE user_id = ? AND card_name = 'Rental'`, [userA]).length;
  const bachExp = (body: Json) => entry({ propertyId: bach.id, kind: 'expense', category: 'rates', ...body });

  bankDebit('bank_rates', userA, '2026-10-18', -245.5);
  bankDebit('bank_rates_b', userB, '2026-10-20', -99);
  const manualBefore = manualCount();
  const matched = await bachExp({ amountNzd: 245.5, date: '2026-10-20' });
  assert(matched.status === 201 && matched.json.inMoneyViews, 'matched expense counts');
  assert(entryTxnId(matched.json.id) === 'bank_rates' && owned(matched.json.id) === 0, 'linked to the bank debit');
  assert(matched.json.bankMatch?.date === '2026-10-18' && matched.json.bankMatch.description === 'Auckland Council', 'bank match shown');
  assert(manualCount() === manualBefore, 'no second transaction added');
  const rentalCatId = queryOne<{ id: string }>(db, `SELECT id FROM budget_categories WHERE user_id = ? AND slug = 'cat-rental'`, [userA])!.id;
  assert(catOf('bank_rates') === rentalCatId, 'uncategorised debit filed under Rental property');

  // One debit is one expense: a second entry for the same amount adds its own transaction.
  const twin = await bachExp({ amountNzd: 245.5, date: '2026-10-19' });
  assert(owned(twin.json.id) === 1 && entryTxnId(twin.json.id) !== 'bank_rates' && twin.json.bankMatch === null, 'a debit links to one entry only');
  assert((await call('DELETE', `/api/rentals/entries/${twin.json.id}`, A)).status === 200, 'twin deleted');

  // Another user's debit never matches.
  const otherUser = await bachExp({ amountNzd: 99, date: '2026-10-20' });
  assert(owned(otherUser.json.id) === 1 && txnRow(entryTxnId(otherUser.json.id))!.user_id === userA, 'B’s debit is not matched');

  // A categorised debit keeps the user's category.
  run(db, `INSERT INTO budget_categories (id, user_id, slug, name, type, is_income, sort_order) VALUES ('cat_mine', ?, NULL, 'House', 'spending', 0, 99)`, [userA]);
  bankDebit('bank_ins', userA, '2026-10-25', -130, 'cat_mine');
  const ins = await bachExp({ category: 'insurance', amountNzd: 130, date: '2026-10-25' });
  assert(entryTxnId(ins.json.id) === 'bank_ins' && catOf('bank_ins') === 'cat_mine', 'user category kept');

  // Edit so it no longer matches: unlinked, own transaction added, bank debit untouched.
  await call('PATCH', `/api/rentals/entries/${ins.json.id}`, A, { amountNzd: 135 });
  assert(owned(ins.json.id) === 1 && txnRow(entryTxnId(ins.json.id))!.amount === -135, 'no longer matching adds its own transaction');
  assert(txnRow('bank_ins')!.amount === -130, 'bank debit untouched');
  // Edit back: matches again and its own transaction is removed.
  const ownTxn = entryTxnId(ins.json.id);
  await call('PATCH', `/api/rentals/entries/${ins.json.id}`, A, { amountNzd: 130 });
  assert(entryTxnId(ins.json.id) === 'bank_ins' && !txnRow(ownTxn), 'matches again, own transaction removed');
  // Switching off or deleting only unlinks.
  await call('PATCH', `/api/rentals/entries/${ins.json.id}`, A, { addToMoney: false });
  assert(entryTxnId(ins.json.id) === null && txnRow('bank_ins'), 'switching off keeps the bank debit');
  await call('PATCH', `/api/rentals/entries/${ins.json.id}`, A, { addToMoney: true });
  assert(entryTxnId(ins.json.id) === 'bank_ins', 'switching on links again');
  await call('DELETE', `/api/rentals/entries/${ins.json.id}`, A);
  assert(txnRow('bank_ins'), 'deleting the entry keeps the bank debit');

  // The debit arrives after the entry (bank sync / import): its own transaction is swapped out.
  const early = await bachExp({ category: 'repairs', amountNzd: 410, date: '2026-10-22' });
  const earlyOwn = entryTxnId(early.json.id);
  assert(owned(early.json.id) === 1 && txnRow(earlyOwn), 'no debit yet: own transaction');
  assert(linkRentalExpensesToBankDebits(db, userA) === 0, 'nothing to link yet');
  bankDebit('bank_plumber', userA, '2026-10-24', -410);
  assert(linkRentalExpensesToBankDebits(db, userA) === 1, 'synced debit linked');
  assert(entryTxnId(early.json.id) === 'bank_plumber' && !txnRow(earlyOwn), 'own transaction replaced by the bank debit');
  assert(linkRentalExpensesToBankDebits(db, userA) === 0, 'linking is idempotent');
  // A bank debit deleted later: the entry falls back to its own transaction on the next pass.
  run(db, `DELETE FROM transactions WHERE id = 'bank_plumber'`);
  linkRentalExpensesToBankDebits(db, userA);
  assert(owned(early.json.id) === 1 && txnRow(entryTxnId(early.json.id))?.amount === -410, 'deleted debit: own transaction again');
  // A manual rental transaction the user deleted in Budget stays deleted after a sync.
  run(db, `DELETE FROM transactions WHERE id = ?`, [entryTxnId(early.json.id)]);
  linkRentalExpensesToBankDebits(db, userA);
  assert(!txnRow(entryTxnId(early.json.id)), 'user-deleted manual transaction not re-added');

  // List: newest first, own only.
  const all = (await call('GET', '/api/rentals', A)).json;
  assert(all.properties.map((p: Json) => p.name).join() === 'Bach,Ponsonby flat', 'properties by name');
  const dates = all.entries.map((e: Json) => e.date);
  assert(dates.join() === [...dates].sort().reverse().join(), 'entries newest first');
  const bList = (await call('GET', '/api/rentals', B)).json;
  assert(bList.properties.length === 0 && bList.entries.length === 0, 'B sees nothing of A’s');
  assert((await call('DELETE', `/api/rentals/properties/${pid}`, B)).status === 404, 'B cannot delete A’s property');

  // Delete an entry removes its mirror.
  assert((await call('DELETE', `/api/rentals/entries/${later.json.id}`, A)).status === 200, 'entry deleted');
  assert(!incomeRow(later.json.id), 'its income row is gone');

  // Delete a property removes its entries and mirrors; other properties are untouched.
  const bachRent = (await entry({ propertyId: bach.id, amountNzd: 300 })).json;
  const ratesTxnNow = entryTxnId(rates.json.id);
  assert((await call('DELETE', `/api/rentals/properties/${pid}`, A)).status === 200, 'property deleted');
  assert(queryAll(db, `SELECT id FROM rental_entries WHERE property_id = ?`, [pid]).length === 0, 'its entries are gone');
  assert(!incomeRow(rent.json.id) && !txnRow(ratesTxnNow), 'their mirrors are gone');
  assert(txnRow('rent_bank'), 'the bank deposit is kept');
  assert(incomeRow(bachRent.id), 'other property kept');

  // Account delete.
  deleteScopedDataForUser(db, userA);
  for (const tbl of ['rental_properties', 'rental_entries']) {
    assert(queryAll(db, `SELECT id FROM ${tbl} WHERE user_id = ?`, [userA]).length === 0, `${tbl} deleted with the account`);
  }
  console.log('rentals store tests passed');
} finally {
  server.close();
  fs.rmSync(dataDir, { recursive: true, force: true });
}
