/**
 * Budget triage suggestions. Run: npm run test:budget
 *
 * Uses a throwaway sqlite file. Does not read or write data/portfolio.db.
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'pt-catsuggest-'));
process.env.DATABASE_PATH = path.join(tmp, 'portfolio.db');

function eq(a: unknown, b: unknown, msg: string): void {
  if (a !== b) throw new Error(`FAIL: ${msg} (got ${String(a)}, expected ${String(b)})`);
}

const { getDb, run, newId } = await import('../db/index.ts');
const { seedCategoriesForUser, resolveCategoryId } = await import('./categories.ts');
const { savePayeeSetting } = await import('../payees/store.ts');
const { suggestCategories, MAX_SUGGESTIONS } = await import('./categorySuggest.ts');

const db = await getDb();
const A = 'sug_a';
const B = 'sug_b';
seedCategoriesForUser(db, A);
seedCategoriesForUser(db, B);
const cat = (u: string, slug: string) => resolveCategoryId(db, u, slug)!;
const today = new Date().toISOString().slice(0, 10);

function past(userId: string, description: string, amount: number, slug: string) {
  run(
    db,
    `INSERT INTO transactions (id, user_id, account_id, date, description, amount, kind, category_id, created_at, source)
     VALUES (?,?,NULL,?,?,?,?,?,?,'manual')`,
    [newId('txn'), userId, today, description, amount, amount < 0 ? 'debit' : 'credit', cat(userId, slug), new Date().toISOString()],
  );
}

// Money out: groceries most used overall, Countdown split food / eating out.
for (let i = 0; i < 5; i++) past(A, `Supermarket ${i}`, -20, 'cat-food');
past(A, 'COUNTDOWN 1234 AUCKLAND', -40, 'cat-eating-out');
past(A, 'Countdown Ponsonby', -40, 'cat-eating-out');
past(A, 'Countdown Ponsonby', -40, 'cat-food');
past(A, 'Z Energy', -80, 'cat-transport');
past(A, 'Z Energy', -80, 'cat-transport');
// Money in: salary, and a transfer in.
past(A, 'ACME SALARY', 4000, 'cat-income-salary');
past(A, 'From savings', 500, 'cat-transfer-in');
// A wrongly categorised inflow must never be suggested for money in.
past(A, 'Odd refund', 30, 'cat-transfer-out');
// Another user's history must not leak.
for (let i = 0; i < 9; i++) past(B, 'COUNTDOWN', -10, 'cat-health');

const [ponsonby] = suggestCategories(db, A, [{ id: 't0', description: 'Countdown Ponsonby', amount: -5 }]);
eq(ponsonby.suggestions[0].categoryId, cat(A, 'cat-eating-out'), 'exact payee: eating out and food tie, both from history');
eq(ponsonby.suggestions[1].source, 'history', 'second exact-payee category is history too');

const [countdown, unknownOut, salary, saved, newIn] = suggestCategories(db, A, [
  { id: 't1', description: 'COUNTDOWN 99 GREY LYNN', amount: -12 },
  { id: 't2', description: 'Brand new shop', amount: -9 },
  { id: 't3', description: 'ACME SALARY OCT', amount: 4100 },
  { id: 't4', description: 'Gym Co', amount: -60 },
  { id: 't5', description: 'Mystery deposit', amount: 25 },
]);

eq(countdown.transactionId, 't1', 'keeps transaction id');
eq(countdown.suggestions[0].categoryId, cat(A, 'cat-eating-out'), 'similar payee history first (COUNTDOWN ↔ COUNTDOWN 1234)');
eq(countdown.suggestions[0].source, 'history', 'marked as history');
eq(countdown.suggestions[1].categoryId, cat(A, 'cat-food'), 'then the most-used money-out category');
eq(countdown.suggestions.length, MAX_SUGGESTIONS, 'filled to 3 with popular');
eq(countdown.suggestions[2].source, 'popular', 'third from most-used');
eq(countdown.suggestions.some((s) => s.categoryId === cat(A, 'cat-health')), false, "another user's history is not used");

eq(unknownOut.suggestions[0].source, 'popular', 'no payee history falls back to most-used');
eq(unknownOut.suggestions[0].categoryId, cat(A, 'cat-food'), 'most-used money-out category first');
eq(unknownOut.suggestions.some((s) => s.categoryId === cat(A, 'cat-income-salary')), false, 'money-in categories not offered for money out');

eq(salary.suggestions[0].categoryId, cat(A, 'cat-income-salary'), 'salary from same payee');

savePayeeSetting(db, A, 'Gym Co', cat(A, 'cat-health'));
const [gym] = suggestCategories(db, A, [{ id: 't4', description: 'Gym Co', amount: -60 }]);
eq(gym.suggestions[0].categoryId, cat(A, 'cat-health'), 'saved payee category wins');
eq(gym.suggestions[0].source, 'payee', 'marked as payee');
eq(saved.suggestions[0].source, 'popular', 'before the payee was saved it was a fallback');

eq(newIn.suggestions.some((s) => s.categoryId === cat(A, 'cat-transfer-out')), false, 'transfer out never suggested for money in');
eq(newIn.suggestions.length, 2, 'only direction-safe categories offered');

eq(suggestCategories(db, 'nobody', [{ id: 'x', description: 'Anything', amount: -5 }])[0].suggestions.length, 0, 'no history, no suggestions');

console.log('category suggestions: ok');
