/**
 * Category guesses from the user's own past transactions (bank sync, CSV import,
 * Add transaction "Automatic").
 * Run: npm run test:cash-sync
 *
 * Uses a throwaway sqlite file. Does not read or write data/portfolio.db.
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'pt-catpredict-'));
process.env.DATABASE_PATH = path.join(tmp, 'portfolio.db');

function assert(cond: unknown, msg: string): void {
  if (!cond) throw new Error(`FAIL: ${msg}`);
}
let passed = 0;
const check = (cond: unknown, msg: string) => {
  assert(cond, msg);
  passed++;
};

const { getDb, run, newId } = await import('../db/index.ts');
const { seedCategoriesForUser, resolveCategoryId } = await import('./categories.ts');
const { createCategoryPredictor, merchantTokens, transferWordingType } = await import('./categoryPredict.ts');

const db = await getDb();
const A = 'pred_a';
const B = 'pred_b';
seedCategoriesForUser(db, A);
seedCategoriesForUser(db, B);
const cat = (u: string, slug: string) => resolveCategoryId(db, u, slug)!;
const today = new Date().toISOString().slice(0, 10);
const old = '2024-01-15';

function past(userId: string, description: string, amount: number, slug: string | null, date = today, merchant: string | null = null) {
  run(
    db,
    `INSERT INTO transactions (id, user_id, account_id, date, description, amount, kind, category_id, created_at, merchant, source)
     VALUES (?,?,NULL,?,?,?,?,?,?,?,'manual')`,
    [newId('txn'), userId, date, description, amount, amount < 0 ? 'debit' : 'credit', slug ? cat(userId, slug) : null, new Date().toISOString(), merchant],
  );
}

check(merchantTokens('COUNTDOWN 1234 AUCKLAND NZ').join() === 'countdown', 'store number + location stripped');
check(merchantTokens("Night'n Day Ponsonby").join() === 'night,day,ponsonby', 'apostrophe spelling = spaced spelling');

// History for A.
past(A, 'COUNTDOWN 1234 AUCKLAND', -82.1, 'cat-food');
past(A, 'Countdown Ponsonby', -45, 'cat-food');
past(A, "NIGHT'N DAY GREY LYNN", -6.5, 'cat-eating-out');
past(A, 'Z Energy Kingsland', -90, 'cat-transport');
past(A, 'Z Energy Kingsland', -70, 'cat-transport');
past(A, 'ACME LTD SALARY', 4200, 'cat-income-salary');
past(A, 'Mystery Shop', -10, 'cat-food');
past(A, 'Mystery Shop', -10, 'cat-entertainment');
past(A, 'Old Gym', -50, 'cat-health', old);
past(A, 'Old Gym', -50, 'cat-entertainment', today);
past(A, 'Uncategorised Thing', -5, null);
// B's history must never leak into A's guesses.
past(B, 'Bunnings Warehouse', -120, 'cat-housing');

const predict = createCategoryPredictor(db, A);

check(predict({ description: 'COUNTDOWN 9876 WELLINGTON', amount: -30 })?.categoryId === cat(A, 'cat-food'), 'same merchant, other branch → groceries');
check(predict({ description: 'COUNTDOWN 9876 WELLINGTON', amount: -30 })?.reason === 'same_payee', 'reason: same payee');
check(predict({ description: 'Night n Day Ponsonby', amount: -7 })?.categoryId === cat(A, 'cat-eating-out'), 'similar wording, other branch → eating out');
check(predict({ description: 'Night n Day Ponsonby', amount: -7 })?.reason === 'similar', 'reason: similar');
check(predict({ description: 'Night Market Day Spa', amount: -7 }) === null, 'two shared words out of four is not enough');
check(predict({ description: 'Z ENERGY KINGSLAND', amount: -55, merchant: null })?.categoryId === cat(A, 'cat-transport'), 'case-insensitive merchant');
check(predict({ description: 'ACME LTD SALARY', amount: 4200 })?.categoryId === cat(A, 'cat-income-salary'), 'money in → income category');
check(predict({ description: 'ACME LTD SALARY', amount: -50 }) === null, 'spend never borrows an income category');
check(predict({ description: 'Mystery Shop', amount: -10 }) === null, 'history split 50/50 → no guess');
check(predict({ description: 'Old Gym', amount: -50 })?.categoryId === cat(A, 'cat-entertainment'), 'recent habit outweighs an old one');
check(predict({ description: 'Bunnings Warehouse', amount: -99 }) === null, 'another user’s history is not used');
check(predict({ description: 'Brand New Place', amount: -12 }) === null, 'unknown merchant → no guess');
check(predict({ description: '1234 5678', amount: -12 }) === null, 'no usable words → no guess');

// A saved payee category beats history.
run(db, `INSERT INTO payee_settings (id, user_id, name, name_key, category_id, created_at, updated_at) VALUES (?,?,?,?,?,?,?)`, [
  newId('payee'),
  A,
  'COUNTDOWN 9876 WELLINGTON',
  'countdown 9876 wellington',
  cat(A, 'cat-other'),
  today,
  today,
]);
const withRule = createCategoryPredictor(db, A)({ description: 'COUNTDOWN 9876 WELLINGTON', amount: -30 });
check(withRule?.categoryId === cat(A, 'cat-other') && withRule.reason === 'payee', 'saved payee category wins');

// KAN-21: a suburb in common isn't a match ("ELLERSLIE" racecourse vs supermarket).
past(A, 'ELLERSLIE', -30, 'cat-entertainment');
past(A, 'ELLERSLIE RACECOURSE', -40, 'cat-entertainment');
const p2 = createCategoryPredictor(db, A);
check(p2({ description: 'ELLERSLIE SUPERMARKET', amount: -55 })?.categoryId !== cat(A, 'cat-entertainment'), 'Ellerslie Supermarket is not Entertainment');
check(p2({ description: 'ELLERSLIE RACECOURSE', amount: -40 })?.categoryId === cat(A, 'cat-entertainment'), 'the same merchant still matches');
past(A, 'FRESH CHOICE ELLERSLIE', -60, 'cat-food');
past(A, 'FRESH CHOICE ELLERSLIE', -70, 'cat-food');
check(createCategoryPredictor(db, A)({ description: 'FRESH CHOICE PONSONBY', amount: -20 })?.categoryId === cat(A, 'cat-food'), 'merchant words still match across suburbs');

// KAN-21: bank transfer wording → the user's Transfer in / Transfer out categories.
check(transferWordingType('Deposit from J SMITH') === 'transfer_in', 'Deposit from');
check(transferWordingType('TRANSFER FROM 38-9000-0000000-01') === 'transfer_in', 'Transfer from');
check(transferWordingType('Transfer to Savings') === 'transfer_out', 'Transfer to');
check(transferWordingType('Transferwise fee') === null, 'not transfer wording');
// Seeded Transfer in / Transfer out categories.
const tin = cat(A, 'cat-transfer-in');
const tout = cat(A, 'cat-transfer-out');
const p3 = createCategoryPredictor(db, A);
check(p3({ description: 'Deposit from J SMITH', amount: 250 })?.categoryId === tin, 'Deposit from → Transfer in');
check(p3({ description: 'Transfer from 38-9000-0000000-01', amount: 500 })?.reason === 'transfer_wording', 'Transfer from → Transfer in');
check(p3({ description: 'Transfer to Savings', amount: -100 })?.categoryId === tout, 'Transfer to → Transfer out');
check(p3({ description: 'Transfer to Savings', amount: 100 })?.categoryId !== tout, 'money in never gets Transfer out');
check(createCategoryPredictor(db, B)({ description: 'Transfer to Savings', amount: -100 })?.categoryId === cat(B, 'cat-transfer-out'), "each user gets their own Transfer out");

fs.rmSync(tmp, { recursive: true, force: true });
console.log(`categoryPredict: ${passed} checks passed`);
