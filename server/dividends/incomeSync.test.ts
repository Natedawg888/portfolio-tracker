/**
 * Paid dividends become that user's income row, and only that user's.
 * Run: npm run test:dividends
 */
import { getDb, queryAll, queryOne, run } from '../db/index.ts';
import { savePayeeSetting } from '../payees/store.ts';
import { deleteDividend, insertDividend, updateDividend } from './store.ts';
import { shiftMonths, todayAucklandYmd } from './model.ts';

function assert(cond: unknown, msg: string): void {
  if (!cond) throw new Error(`FAIL: ${msg}`);
}

const userA = 'divinc_user_a';
const userB = 'divinc_user_b';
const holdingA = 'divinc_h_a';
const holdingB = 'divinc_h_b';

type IncomeRow = {
  id: string;
  amount_nzd: number;
  description: string;
  category_id: string | null;
  dividend_event_id: string | null;
  notes: string | null;
};

function incomeFor(db: Awaited<ReturnType<typeof getDb>>, userId: string, dividendId?: string): IncomeRow[] {
  if (dividendId) {
    return queryAll<IncomeRow>(
      db,
      `SELECT id, amount_nzd, description, category_id, dividend_event_id, notes
       FROM income_records WHERE user_id = ? AND dividend_event_id = ?`,
      [userId, dividendId],
    );
  }
  return queryAll<IncomeRow>(
    db,
    `SELECT id, amount_nzd, description, category_id, dividend_event_id, notes
     FROM income_records WHERE user_id = ?`,
    [userId],
  );
}

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
  run(db, `DELETE FROM income_records WHERE user_id IN (?, ?)`, [userA, userB]);
  run(db, `DELETE FROM payee_settings WHERE user_id IN (?, ?)`, [userA, userB]);
  run(db, `DELETE FROM dividend_events WHERE user_id IN (?, ?)`, [userA, userB]);
  run(db, `DELETE FROM budget_categories WHERE user_id IN (?, ?)`, [userA, userB]);
  run(db, `DELETE FROM holdings WHERE id IN (?, ?)`, [holdingA, holdingB]);
}

async function main() {
  const db = await getDb();
  const now = new Date().toISOString();
  const today = todayAucklandYmd();
  const paid = shiftMonths(today, -1);
  const future = shiftMonths(today, 2);
  cleanup(db);
  run(
    db,
    `INSERT INTO holdings (id, user_id, asset_class, name, symbol, shares, cost_basis_nzd, created_at, updated_at)
     VALUES (?, ?, 'stock', 'Alpha ETF', 'ALFA', 50, 500, ?, ?)`,
    [holdingA, userA, now, now],
  );
  run(
    db,
    `INSERT INTO holdings (id, user_id, asset_class, name, symbol, shares, cost_basis_nzd, created_at, updated_at)
     VALUES (?, ?, 'stock', 'Bravo Ltd', 'BRAV', 10, 200, ?, ?)`,
    [holdingB, userB, now, now],
  );

  try {
    const created = insertDividend(db, userA, {
      holdingId: holdingA,
      sharesHeld: 50,
      dividendPerShare: 0.4,
      taxWithholding: 3,
      imputationCredits: 5,
      paymentDate: paid,
      currency: 'NZD',
    });
    assert(created.ok, 'user A records a paid NZD dividend');
    if (!created.ok) return;
    const first = incomeFor(db, userA, created.event.id);
    assert(first.length === 1, 'one income row for that dividend');
    assert(Math.abs(Number(first[0]?.amount_nzd) - 17) < 1e-6, 'income is net cash, 50 × 0.4 − 3');
    assert(first[0]?.description === 'Alpha ETF', 'payee is the holding recorded');
    assert(first[0]?.dividend_event_id === created.event.id, 'income row points at the dividend');
    assert(
      first[0]?.category_id === categoryId(db, userA, 'cat-income-dividends'),
      'category is the existing Dividends & interest category',
    );
    assert(String(first[0]?.notes ?? '').includes('Not financial advice'), 'income copy stays a personal record');
    assert(incomeFor(db, userB).length === 0, 'user B has no income from user A');

    const incomeId = String(first[0]?.id);
    const again = updateDividend(db, userA, created.event.id, {
      holdingId: holdingA,
      sharesHeld: 50,
      dividendPerShare: 0.4,
      taxWithholding: 3,
      paymentDate: paid,
      currency: 'NZD',
    });
    assert(again.ok, 'saving the same dividend again succeeds');
    const stillOne = incomeFor(db, userA, created.event.id);
    assert(stillOne.length === 1, 'saving again does not add a second income row');
    assert(stillOne[0]?.id === incomeId, 'the same income row is kept');

    const changed = updateDividend(db, userA, created.event.id, {
      holdingId: holdingA,
      sharesHeld: 50,
      dividendPerShare: 0.5,
      taxWithholding: 3,
      paymentDate: paid,
      currency: 'NZD',
    });
    assert(changed.ok, 'user A can update the dividend');
    const afterUpdate = incomeFor(db, userA, created.event.id);
    assert(afterUpdate.length === 1 && afterUpdate[0]?.id === incomeId, 'update keeps the one income row');
    assert(Math.abs(Number(afterUpdate[0]?.amount_nzd) - 22) < 1e-6, 'updated income is 50 × 0.5 − 3');

    const other = insertDividend(db, userB, {
      holdingId: holdingB,
      sharesHeld: 10,
      dividendPerShare: 1,
      paymentDate: paid,
      currency: 'NZD',
    });
    assert(other.ok, 'user B records their own dividend');
    if (!other.ok) return;
    const otherIncome = incomeFor(db, userB, other.event.id);
    assert(otherIncome.length === 1, 'user B has their own income row');
    const otherIncomeId = String(otherIncome[0]?.id);
    assert(Math.abs(Number(otherIncome[0]?.amount_nzd) - 10) < 1e-6, 'user B income is their own net');

    const crossDelete = deleteDividend(db, userA, other.event.id);
    assert(!crossDelete, 'user A cannot delete user B dividend');
    assert(incomeFor(db, userB, other.event.id).length === 1, 'user B income remains');
    assert(incomeFor(db, userA, created.event.id)[0]?.id === incomeId, 'user A income remains');

    assert(deleteDividend(db, userA, created.event.id), 'user A deletes their dividend');
    assert(incomeFor(db, userA, created.event.id).length === 0, 'user A income row is removed');
    assert(incomeFor(db, userB, other.event.id)[0]?.id === otherIncomeId, 'user B income is untouched');

    const foreign = insertDividend(db, userA, {
      holdingId: holdingA,
      sharesHeld: 10,
      dividendPerShare: 2,
      taxWithholding: 0,
      paymentDate: paid,
      currency: 'USD',
    });
    assert(foreign.ok, 'user A can record a foreign dividend without an FX rate');
    if (!foreign.ok) return;
    assert(incomeFor(db, userA, foreign.event.id).length === 0, 'foreign payment stays out of NZD income until an FX rate is recorded');
    assert(incomeFor(db, userB).length === 1, 'user B income is still the one row');

    const rated = updateDividend(db, userA, foreign.event.id, {
      holdingId: holdingA,
      sharesHeld: 10,
      dividendPerShare: 2,
      taxWithholding: 0,
      paymentDate: paid,
      currency: 'USD',
      fxRateToNzd: 1.5,
    });
    assert(rated.ok, 'user A can add the FX rate they record');
    const converted = incomeFor(db, userA, foreign.event.id);
    assert(converted.length === 1, 'an FX rate adds one NZD income row');
    assert(Math.abs(Number(converted[0]?.amount_nzd) - 30) < 1e-6, 'NZD income is net 20 times the recorded rate 1.5');
    assert(incomeFor(db, userB, other.event.id)[0]?.id === otherIncomeId, 'adding FX does not change the other user');

    const cleared = updateDividend(db, userA, foreign.event.id, {
      holdingId: holdingA,
      sharesHeld: 10,
      dividendPerShare: 2,
      taxWithholding: 0,
      paymentDate: paid,
      currency: 'USD',
    });
    assert(cleared.ok, 'user A can clear the FX rate');
    assert(incomeFor(db, userA, foreign.event.id).length === 0, 'clearing the FX rate removes the NZD income row');
    assert(incomeFor(db, userB).length === 1, 'clearing FX does not remove the other user');

    const upcoming = insertDividend(db, userA, {
      holdingId: holdingA,
      sharesHeld: 4,
      dividendPerShare: 1,
      paymentDate: future,
      currency: 'NZD',
    });
    assert(upcoming.ok, 'user A can record an upcoming dividend');
    if (!upcoming.ok) return;
    assert(incomeFor(db, userA, upcoming.event.id).length === 0, 'an upcoming payment is not income yet');

    const becamePaid = updateDividend(db, userA, upcoming.event.id, {
      holdingId: holdingA,
      sharesHeld: 4,
      dividendPerShare: 1,
      paymentDate: paid,
      currency: 'NZD',
    });
    assert(becamePaid.ok, 'the upcoming row can be moved to a paid date');
    assert(incomeFor(db, userA, upcoming.event.id).length === 1, 'a paid date adds the income row');
    const movedBack = updateDividend(db, userA, upcoming.event.id, {
      holdingId: holdingA,
      sharesHeld: 4,
      dividendPerShare: 1,
      paymentDate: future,
      currency: 'NZD',
    });
    assert(movedBack.ok, 'the payment can be moved back to a future date');
    assert(incomeFor(db, userA, upcoming.event.id).length === 0, 'a future date removes the income row');

    const salaryId = categoryId(db, userA, 'cat-income-salary');
    const savedPayee = savePayeeSetting(db, userA, 'Alpha ETF', salaryId);
    assert(savedPayee.ok, 'user A can save a category for the dividend payer');
    const withPayee = insertDividend(db, userA, {
      holdingId: holdingA,
      sharesHeld: 2,
      dividendPerShare: 3,
      paymentDate: paid,
      currency: 'NZD',
    });
    assert(withPayee.ok, 'the next dividend for that payer is recorded');
    if (!withPayee.ok) return;
    const mirrored = incomeFor(db, userA, withPayee.event.id);
    assert(mirrored.length === 1, 'the next dividend still creates one income row');
    assert(mirrored[0]?.category_id === salaryId, 'the saved income category is applied to that payee');
    assert(mirrored[0]?.description === 'Alpha ETF', 'payee stays the holding name');
    assert(
      incomeFor(db, userB, other.event.id)[0]?.category_id === categoryId(db, userB, 'cat-income-dividends'),
      'user B category is unchanged',
    );

    console.log('dividend income sync tests passed');
  } finally {
    cleanup(db);
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
