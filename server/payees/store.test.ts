/**
 * Payee settings round-trip for one user, and stay off the other user's rows.
 * Run: npm run test:dividends
 */
import { getDb, queryOne, run } from '../db/index.ts';
import { seedCategoriesForUser } from '../lib/categories.ts';
import { categoryForPayee, incomeCategoryForPayee, listPayeeSettings, savePayeeSetting } from './store.ts';

function assert(cond: unknown, msg: string): void {
  if (!cond) throw new Error(`FAIL: ${msg}`);
}

const userA = 'payee_user_a';
const userB = 'payee_user_b';

function categoryId(db: Awaited<ReturnType<typeof getDb>>, userId: string, slug: string): string {
  const row = queryOne<{ id: string }>(
    db,
    `SELECT id FROM budget_categories WHERE user_id = ? AND slug = ?`,
    [userId, slug],
  );
  if (!row?.id) throw new Error(`missing category ${slug} for ${userId}`);
  return String(row.id);
}

function cleanup(db: Awaited<ReturnType<typeof getDb>>) {
  run(db, `DELETE FROM payee_settings WHERE user_id IN (?, ?)`, [userA, userB]);
  run(db, `DELETE FROM budget_categories WHERE user_id IN (?, ?)`, [userA, userB]);
}

async function main() {
  const db = await getDb();
  cleanup(db);
  seedCategoriesForUser(db, userA);
  seedCategoriesForUser(db, userB);

  try {
    const salaryA = categoryId(db, userA, 'cat-income-salary');
    const foodA = categoryId(db, userA, 'cat-food');
    const salaryB = categoryId(db, userB, 'cat-income-salary');

    const saved = savePayeeSetting(db, userA, 'Alpha ETF', salaryA);
    assert(saved.ok, 'user A saves a category they already have');
    if (!saved.ok) return;
    assert(saved.setting.name === 'Alpha ETF', 'saved payee name is returned');
    assert(saved.setting.categoryId === salaryA, 'saved category id is returned');
    assert(saved.setting.categoryName === 'Salary', 'saved category name is the existing Salary category');

    const roundTrip = listPayeeSettings(db, userA).find((row) => row.name === 'Alpha ETF');
    assert(roundTrip?.categoryId === salaryA, 'listing returns the category just saved');
    assert(roundTrip?.categoryName === 'Salary', 'listing returns the category name');
    assert(categoryForPayee(db, userA, 'alpha etf') === salaryA, 'the next use matches the payee ignoring case');
    assert(incomeCategoryForPayee(db, userA, 'Alpha ETF') === salaryA, 'an income category is applied to income');

    assert(listPayeeSettings(db, userB).length === 0, 'user B does not see user A payee settings');
    assert(categoryForPayee(db, userB, 'Alpha ETF') == null, 'user B has no category for that payee');

    const other = savePayeeSetting(db, userB, 'Alpha ETF', salaryB);
    assert(other.ok, 'user B can save their own category for the same name');
    assert(
      listPayeeSettings(db, userA).find((row) => row.name === 'Alpha ETF')?.categoryId === salaryA,
      'user B saving does not change user A',
    );
    assert(categoryForPayee(db, userB, 'Alpha ETF') === salaryB, 'user B reads their own category');

    const stolen = savePayeeSetting(db, userA, 'Bravo Ltd', salaryB);
    assert(!stolen.ok, 'user A cannot save user B’s category');
    if (!stolen.ok) assert(stolen.status === 400, 'a category they do not have is rejected');
    assert(
      listPayeeSettings(db, userB).every((row) => row.name !== 'Bravo Ltd'),
      'the rejected save did not write a payee for user B',
    );

    const spending = savePayeeSetting(db, userA, 'Countdown', foodA);
    assert(spending.ok, 'a spending category that already exists can be saved');
    if (!spending.ok) return;
    assert(categoryForPayee(db, userA, 'Countdown') === foodA, 'the spending category is stored');
    assert(incomeCategoryForPayee(db, userA, 'Countdown') == null, 'a spending category is not applied as income');
    const foodAgain = listPayeeSettings(db, userA).find((row) => row.name === 'Countdown');
    assert(
      foodAgain?.categoryId === foodA && foodAgain.categoryName === 'Food & groceries',
      'round-trip keeps the existing category',
    );

    console.log('payee settings tests passed');
  } finally {
    cleanup(db);
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
