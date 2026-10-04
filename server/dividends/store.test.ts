/**
 * Dividend rows stay on the user who recorded them.
 * Run: npm run test:dividends
 */
import { getDb, queryOne, run } from '../db/index.ts';
import { deleteScopedDataForUser } from '../lib/userScope.ts';
import {
  dashboardForUser,
  deleteDividend,
  insertDividend,
  listDividendEvents,
  unlinkDividendsForHolding,
} from './store.ts';

function assert(cond: unknown, msg: string): void {
  if (!cond) throw new Error(`FAIL: ${msg}`);
}

const userA = 'divtest_user_a';
const userB = 'divtest_user_b';
const holdingA = 'divtest_h_a';
const holdingA2 = 'divtest_h_a2';
const holdingB = 'divtest_h_b';

async function main() {
  const db = await getDb();
  const now = new Date().toISOString();
  run(db, `DELETE FROM income_records WHERE user_id IN (?, ?)`, [userA, userB]);
  run(db, `DELETE FROM payee_settings WHERE user_id IN (?, ?)`, [userA, userB]);
  run(db, `DELETE FROM dividend_events WHERE user_id IN (?, ?)`, [userA, userB]);
  run(db, `DELETE FROM budget_categories WHERE user_id IN (?, ?)`, [userA, userB]);
  run(db, `DELETE FROM holdings WHERE id IN (?, ?, ?)`, [holdingA, holdingA2, holdingB]);
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
      paymentDate: '2026-05-20',
      currency: 'NZD',
      reinvested: false,
    });
    assert(created.ok, 'user A can record a dividend on their holding');
    if (!created.ok) return;
    assert(created.event.companyName === 'Alpha ETF', 'company name comes from the holding');
    assert(Math.abs(created.event.netDividend - 17) < 1e-6, 'net stored from the recorded amounts');

    const stolen = insertDividend(db, userB, {
      holdingId: holdingA,
      sharesHeld: 50,
      dividendPerShare: 0.4,
      paymentDate: '2026-05-21',
    });
    assert(!stolen.ok, 'user B cannot attach a dividend to user A holdings');
    if (!stolen.ok) assert(stolen.status === 404, 'cross-user holding is not found');

    const own = insertDividend(db, userB, {
      holdingId: holdingB,
      sharesHeld: 10,
      dividendPerShare: 1,
      paymentDate: '2026-06-01',
      currency: 'NZD',
    });
    assert(own.ok, 'user B can record their own holding');

    const dashA = dashboardForUser(db, userA, 2026, '2026-10-04');
    assert(dashA.history.length === 1, 'user A sees one dividend');
    assert(dashA.history[0]?.companyName === 'Alpha ETF', 'user A sees their company');
    assert(!dashA.history.some((row) => row.companyName === 'Bravo Ltd'), 'user A does not see user B');
    assert(Math.abs((dashA.yearIncomeNzd ?? 0) - 17) < 1e-6, 'user A year total is their net dividend');
    assert(dashA.holdings.every((holding) => holding.id !== holdingB), 'holding list is user A only');

    const dashB = dashboardForUser(db, userB, 2026, '2026-10-04');
    assert(dashB.history.every((row) => row.companyName === 'Bravo Ltd'), 'user B sees only their rows');
    assert(listDividendEvents(db, userA).every((row) => row.holdingId === holdingA), 'listed rows stay on A');

    const removed = deleteDividend(db, userB, created.event.id);
    assert(!removed, 'user B cannot delete user A dividend');
    const stillThere = queryOne<{ id: string }>(
      db,
      `SELECT id FROM dividend_events WHERE id = ? AND user_id = ?`,
      [created.event.id, userA],
    );
    assert(stillThere?.id === created.event.id, 'user A row remains after the other user delete');

    run(
      db,
      `INSERT INTO holdings (id, user_id, asset_class, name, symbol, shares, cost_basis_nzd, created_at, updated_at)
       VALUES (?, ?, 'stock', 'Alpha Two', 'ALF2', 10, 200, ?, ?)`,
      [holdingA2, userA, now, now],
    );
    const second = insertDividend(db, userA, {
      holdingId: holdingA2,
      sharesHeld: 10,
      dividendPerShare: 1,
      paymentDate: '2026-04-01',
      currency: 'NZD',
      reinvested: false,
    });
    assert(second.ok, 'user A can record a second holding');
    if (!second.ok) return;

    const crossed = unlinkDividendsForHolding(db, userB, holdingA);
    assert(crossed === 0, 'another user cannot unlink these dividend rows');
    assert(
      listDividendEvents(db, userA).some((row) => row.id === created.event.id && row.holdingId === holdingA),
      'user A link stays when the other user tries to clear it',
    );

    const unlinked = unlinkDividendsForHolding(db, userA, holdingA);
    assert(unlinked === 1, 'deleting a holding unlinks that user\'s dividend row');
    const kept = listDividendEvents(db, userA).find((row) => row.id === created.event.id);
    assert(kept?.holdingId == null, 'the payment is kept with no holding link');
    assert(kept?.companyName === 'Alpha ETF', 'company name stays on the personal record');
    assert(Math.abs((kept?.netDividend ?? 0) - 17) < 1e-6, 'unlinking does not change the recorded net amount');
    assert(
      listDividendEvents(db, userB).every((row) => row.holdingId === holdingB),
      'user B rows stay linked to their own holding',
    );

    const afterUnlink = dashboardForUser(db, userA, 2026, '2026-10-04');
    assert(afterUnlink.yield.available, 'yield still uses the holding that remains');
    assert(Math.abs((afterUnlink.yield.trailingNetNzd ?? 0) - 10) < 1e-6, 'unlinked dividend is ignored in yield');
    assert(Math.abs((afterUnlink.yield.denominatorNzd ?? 0) - 200) < 1e-6, 'yield denominator is the remaining holding');
    assert(Math.abs((afterUnlink.yearIncomeNzd ?? 0) - 27) < 1e-6, 'both recorded payments still count as income');
    assert(afterUnlink.holdings.every((holding) => holding.id !== holdingB), 'user B holding stays unreachable');

    const scoped = deleteScopedDataForUser(db, userA);
    assert((scoped.tables.dividend_events ?? 0) >= 2, 'account deletion counts this user\'s dividend rows');
    assert(listDividendEvents(db, userA).length === 0, 'account deletion removes that user\'s dividend data');
    assert(listDividendEvents(db, userB).length === 1, 'the other user\'s dividend data remains');
    const holdingBLeft = queryOne<{ id: string }>(
      db,
      `SELECT id FROM holdings WHERE id = ? AND user_id = ?`,
      [holdingB, userB],
    );
    assert(holdingBLeft?.id === holdingB, 'the other user\'s holding remains');
    const dashBAfter = dashboardForUser(db, userB, 2026, '2026-10-04');
    assert(dashBAfter.history.every((row) => row.companyName === 'Bravo Ltd'), 'user B dashboard is unchanged');

    console.log('dividend store isolation tests passed');
  } finally {
    run(db, `DELETE FROM income_records WHERE user_id IN (?, ?)`, [userA, userB]);
    run(db, `DELETE FROM payee_settings WHERE user_id IN (?, ?)`, [userA, userB]);
    run(db, `DELETE FROM dividend_events WHERE user_id IN (?, ?)`, [userA, userB]);
    run(db, `DELETE FROM budget_categories WHERE user_id IN (?, ?)`, [userA, userB]);
    run(db, `DELETE FROM holdings WHERE id IN (?, ?, ?)`, [holdingA, holdingA2, holdingB]);
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
