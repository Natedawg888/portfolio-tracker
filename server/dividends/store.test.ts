/**
 * Dividend rows stay on the user who recorded them.
 * Run: npm run test:dividends
 */
import { getDb, queryOne, run } from '../db/index.ts';
import { dashboardForUser, deleteDividend, insertDividend, listDividendEvents } from './store.ts';

function assert(cond: unknown, msg: string): void {
  if (!cond) throw new Error(`FAIL: ${msg}`);
}

const userA = 'divtest_user_a';
const userB = 'divtest_user_b';
const holdingA = 'divtest_h_a';
const holdingB = 'divtest_h_b';

async function main() {
  const db = await getDb();
  const now = new Date().toISOString();
  run(db, `DELETE FROM dividend_events WHERE user_id IN (?, ?)`, [userA, userB]);
  run(db, `DELETE FROM holdings WHERE id IN (?, ?)`, [holdingA, holdingB]);
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
    console.log('dividend store isolation tests passed');
  } finally {
    run(db, `DELETE FROM dividend_events WHERE user_id IN (?, ?)`, [userA, userB]);
    run(db, `DELETE FROM holdings WHERE id IN (?, ?)`, [holdingA, holdingB]);
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
