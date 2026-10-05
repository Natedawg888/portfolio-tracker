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
  type PublishedDividendLoader,
} from './store.ts';
import type { PublishedDividendSeries } from './model.ts';

function assert(cond: unknown, msg: string): void {
  if (!cond) throw new Error(`FAIL: ${msg}`);
}

const offlineDividends: PublishedDividendLoader = async () => null;

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
  run(db, `DELETE FROM holdings WHERE id IN (?, ?, ?, ?, ?)`, [holdingA, holdingA2, holdingB, 'divtest_h_crypto', 'divtest_h_blank']);
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

    const dashA = await dashboardForUser(db, userA, 2026, '2026-10-04', offlineDividends);
    assert(dashA.history.length === 1, 'user A sees one dividend');
    assert(dashA.history[0]?.companyName === 'Alpha ETF', 'user A sees their company');
    assert(!dashA.history.some((row) => row.companyName === 'Bravo Ltd'), 'user A does not see user B');
    assert(Math.abs((dashA.yearIncomeNzd ?? 0) - 17) < 1e-6, 'user A year total is their net dividend');
    assert(dashA.holdings.every((holding) => holding.id !== holdingB), 'holding list is user A only');

    const dashB = await dashboardForUser(db, userB, 2026, '2026-10-04', offlineDividends);
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

    const afterUnlink = await dashboardForUser(db, userA, 2026, '2026-10-04', offlineDividends);
    assert(afterUnlink.yield.available, 'yield still uses the holding that remains');
    assert(Math.abs((afterUnlink.yield.trailingNetNzd ?? 0) - 10) < 1e-6, 'unlinked dividend is ignored in yield');
    assert(Math.abs((afterUnlink.yield.denominatorNzd ?? 0) - 200) < 1e-6, 'yield denominator is the remaining holding');
    assert(Math.abs((afterUnlink.yearIncomeNzd ?? 0) - 27) < 1e-6, 'both recorded payments still count as income');
    assert(afterUnlink.holdings.every((holding) => holding.id !== holdingB), 'user B holding stays unreachable');

    const cryptoId = 'divtest_h_crypto';
    const blankSharesId = 'divtest_h_blank';
    run(db, `DELETE FROM holdings WHERE id IN (?, ?)`, [cryptoId, blankSharesId]);
    run(
      db,
      `INSERT INTO holdings (id, user_id, asset_class, name, symbol, amount, created_at, updated_at)
       VALUES (?, ?, 'crypto', 'Bitcoin', 'BTC', 1, ?, ?)`,
      [cryptoId, userA, now, now],
    );
    run(
      db,
      `INSERT INTO holdings (id, user_id, asset_class, name, symbol, shares, created_at, updated_at)
       VALUES (?, ?, 'stock', 'No Shares Ltd', 'NOSH', NULL, ?, ?)`,
      [blankSharesId, userA, now, now],
    );
    const upcomingOwn = insertDividend(db, userA, {
      holdingId: holdingA2,
      sharesHeld: 10,
      dividendPerShare: 1,
      paymentDate: '2026-12-01',
      currency: 'NZD',
    });
    assert(upcomingOwn.ok, 'user A can record an upcoming payment');

    const lookedUp: string[] = [];
    const quarterly = (amount: number): PublishedDividendSeries => ({
      source: 'yahoo',
      currency: 'NZD',
      payments: [
        { date: '2026-02-13', amountPerShare: amount },
        { date: '2026-05-14', amountPerShare: amount },
        { date: '2026-08-14', amountPerShare: amount },
      ],
    });
    const loader: PublishedDividendLoader = async ({ symbol }) => {
      lookedUp.push(symbol);
      if (symbol === 'ALFA') return quarterly(0.3);
      if (symbol === 'BRAV') return quarterly(9);
      if (symbol === 'ALF2') return quarterly(4);
      if (symbol === 'BTC' || symbol === 'NOSH') return quarterly(5);
      return { source: 'yahoo', currency: 'NZD', payments: [] };
    };

    const detectedA = await dashboardForUser(db, userA, 2026, '2026-10-04', loader);
    assert(lookedUp.includes('ALFA'), 'user A stock with shares is looked up');
    assert(!lookedUp.includes('BRAV'), 'user B symbol is not looked up for user A');
    assert(!lookedUp.includes('BTC'), 'a crypto holding is not treated as a dividend stock');
    assert(!lookedUp.includes('NOSH'), 'a stock with no share count is left out');
    assert(!lookedUp.includes('ALF2'), 'a holding with an upcoming payment the user entered is not looked up again');
    assert(detectedA.forecast.detected.length === 1, 'only the holding with published history and no stated payment is added');
    assert(detectedA.forecast.detected[0]?.symbol === 'ALFA', 'the detected row is user A stock');
    assert(detectedA.forecast.detected[0]?.name === 'Alpha ETF', 'the detected name is the holding on this account');
    assert(Math.abs((detectedA.forecast.detected[0]?.dividendPerShare ?? 0) - 0.3) < 1e-6, 'per share is the published figure');
    assert(Math.abs((detectedA.forecast.detected[0]?.amount ?? 0) - 15) < 1e-6, 'cash is shares times the published dividend');
    assert(detectedA.forecast.detected[0]?.basis === 'projected', 'the row is labelled as a projection from history');
    assert(!detectedA.forecast.detected.some((row) => row.symbol === 'BRAV' || row.name === 'Bravo Ltd'), 'user B holding stays out of user A forecast');
    assert(detectedA.holdings.every((holding) => holding.id !== holdingB), 'holding list is still user A only');
    assert(detectedA.upcoming.some((row) => row.holdingId === holdingA2), 'the payment user A entered stays in upcoming');
    assert(!detectedA.upcoming.some((row) => row.symbol === 'ALFA' && row.paymentDate === '2026-11-14'), 'a projection is not saved as an entered dividend');

    lookedUp.length = 0;
    const detectedB = await dashboardForUser(db, userB, 2026, '2026-10-04', loader);
    assert(lookedUp.length === 1 && lookedUp[0] === 'BRAV', 'user B lookup is only their stock');
    assert(detectedB.forecast.detected.length === 1, 'user B gets their own projection');
    assert(detectedB.forecast.detected[0]?.symbol === 'BRAV', 'user B projection is their holding');
    assert(Math.abs((detectedB.forecast.detected[0]?.amount ?? 0) - 90) < 1e-6, 'user B cash uses their shares and their published amount');
    assert(!detectedB.forecast.detected.some((row) => row.symbol === 'ALFA'), 'user A projection is not on user B');
    assert(detectedA.forecast.detected.every((row) => row.symbol === 'ALFA'), 'building user B does not change user A result');

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
    const dashBAfter = await dashboardForUser(db, userB, 2026, '2026-10-04', offlineDividends);
    assert(dashBAfter.history.every((row) => row.companyName === 'Bravo Ltd'), 'user B dashboard is unchanged');
    assert(dashBAfter.forecast.detectedCount === 0, 'user B forecast does not keep another account projection');

    console.log('dividend store isolation tests passed');
  } finally {
    run(db, `DELETE FROM income_records WHERE user_id IN (?, ?)`, [userA, userB]);
    run(db, `DELETE FROM payee_settings WHERE user_id IN (?, ?)`, [userA, userB]);
    run(db, `DELETE FROM dividend_events WHERE user_id IN (?, ?)`, [userA, userB]);
    run(db, `DELETE FROM budget_categories WHERE user_id IN (?, ?)`, [userA, userB]);
    run(db, `DELETE FROM holdings WHERE id IN (?, ?, ?, ?, ?)`, [holdingA, holdingA2, holdingB, 'divtest_h_crypto', 'divtest_h_blank']);
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
