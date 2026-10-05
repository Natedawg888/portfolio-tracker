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
  setDividendReinvest,
  setForecastReinvest,
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
  run(db, `DELETE FROM dividend_forecast_reinvest WHERE user_id IN (?, ?)`, [userA, userB]);
  run(db, `DELETE FROM dividend_events WHERE user_id IN (?, ?)`, [userA, userB]);
  run(db, `DELETE FROM budget_categories WHERE user_id IN (?, ?)`, [userA, userB]);
  run(db, `DELETE FROM holdings WHERE id IN (?, ?, ?, ?, ?, ?)`, [holdingA, holdingA2, holdingB, 'divtest_h_crypto', 'divtest_h_blank', 'divtest_h_noprice']);
  run(db, `DELETE FROM price_quotes WHERE asset_key = ?`, ['STOCK:NOPX']);
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
      if (symbol === 'NOPX') return quarterly(0.5);
      return { source: 'yahoo', currency: 'NZD', payments: [] };
    };

    const detectedA = await dashboardForUser(db, userA, 2026, '2026-10-04', loader);
    assert(lookedUp.includes('ALFA'), 'user A stock with shares is looked up');
    assert(!lookedUp.includes('BRAV'), 'user B symbol is not looked up for user A');
    assert(!lookedUp.includes('BTC'), 'a crypto holding is not treated as a dividend stock');
    assert(!lookedUp.includes('NOSH'), 'a stock with no share count is left out');
    assert(lookedUp.includes('ALF2'), 'a holding with a stated upcoming payment is still checked for later dates');
    const alfaRows = detectedA.forecast.detected.filter((row) => row.symbol === 'ALFA');
    const alf2Rows = detectedA.forecast.detected.filter((row) => row.symbol === 'ALF2');
    assert(alfaRows.length === 4, 'predicted payments cover the next 12 months for the holding with no stated payment');
    assert(alf2Rows.length === 3, 'later predicted payments remain after the payment the user already entered');
    assert(alf2Rows.every((row) => row.paymentDate > '2026-12-01'), 'the entered upcoming payment is not repeated');
    assert(detectedA.forecast.detected[0]?.name === 'Alpha ETF', 'the detected name is the holding on this account');
    assert(Math.abs((alfaRows[0]?.dividendPerShare ?? 0) - 0.3) < 1e-6, 'per share is the published figure');
    assert(Math.abs((alfaRows[0]?.amount ?? 0) - 15) < 1e-6, 'cash is shares times the published dividend');
    assert(alfaRows.every((row) => Math.abs(row.amount - 15) < 1e-6), 'reinvest off keeps every payment on the current share count');
    assert(detectedA.forecast.detected[0]?.basis === 'projected', 'the row is labelled as a projection from history');
    assert(!detectedA.forecast.detected.some((row) => row.symbol === 'BRAV' || row.name === 'Bravo Ltd'), 'user B holding stays out of user A forecast');
    assert(detectedA.holdings.every((holding) => holding.id !== holdingB), 'holding list is still user A only');
    assert(detectedA.upcoming.some((row) => row.holdingId === holdingA2), 'the payment user A entered stays in upcoming');
    assert(!detectedA.upcoming.some((row) => row.symbol === 'ALFA' && row.paymentDate === '2026-11-14'), 'a projection is not saved as an entered dividend');

    lookedUp.length = 0;
    const detectedB = await dashboardForUser(db, userB, 2026, '2026-10-04', loader);
    assert(lookedUp.length === 1 && lookedUp[0] === 'BRAV', 'user B lookup is only their stock');
    assert(detectedB.forecast.detected.length === 4, 'user B gets their own projection');
    assert(detectedB.forecast.detected[0]?.symbol === 'BRAV', 'user B projection is their holding');
    assert(Math.abs((detectedB.forecast.detected[0]?.amount ?? 0) - 90) < 1e-6, 'user B cash uses their shares and their published amount');
    assert(detectedB.forecast.detected.every((row) => Math.abs(row.amount - 90) < 1e-6), 'user B payments stay on their own share count');
    assert(!detectedB.forecast.detected.some((row) => row.symbol === 'ALFA' || row.symbol === 'ALF2'), 'user A projection is not on user B');
    assert(
      detectedA.forecast.detected.filter((row) => row.symbol === 'ALFA').length === 4
        && detectedA.forecast.detected.filter((row) => row.symbol === 'ALF2').length === 3
        && detectedA.forecast.detected.every((row) => row.symbol === 'ALFA' || row.symbol === 'ALF2'),
      'building user B does not change user A result',
    );

    const sharesBefore = queryOne<{ shares: number }>(
      db,
      `SELECT shares FROM holdings WHERE id = ? AND user_id = ?`,
      [holdingA, userA],
    );
    const dividendsBefore = queryOne<{ c: number }>(
      db,
      `SELECT COUNT(*) AS c FROM dividend_events WHERE user_id = ?`,
      [userA],
    );
    const incomeBefore = queryOne<{ c: number }>(
      db,
      `SELECT COUNT(*) AS c FROM income_records WHERE user_id = ?`,
      [userA],
    );
    const forecastOn = await setForecastReinvest(
      db,
      userA,
      holdingA,
      '2026-11-14',
      true,
      '2026-10-04',
      loader,
    );
    assert(forecastOn.ok, 'user A can turn reinvest on for a forecast row');
    if (!forecastOn.ok) return;
    assert(forecastOn.reinvested === true, 'the forecast toggle reports on');
    assert(Math.abs((forecastOn.ownedShares ?? 0) - 50) < 1e-6, 'forecast reinvest does not change shares owned');
    assert(Math.abs((forecastOn.detected[0]?.amount ?? 0) - 15) < 1e-6, 'the toggled payment still uses the shares owned');
    assert(forecastOn.detected[0]?.reinvestment.status === 'applied', 'cost basis supplies the recorded price');
    assert(Math.abs((forecastOn.detected[1]?.sharesHeld ?? 0) - 51.5) < 1e-6, 'the next predicted payment uses the extra shares');
    assert(Math.abs((forecastOn.detected[1]?.amount ?? 0) - 15.45) < 1e-6, 'the next amount compounds');
    const sharesAfterForecast = queryOne<{ shares: number }>(
      db,
      `SELECT shares FROM holdings WHERE id = ? AND user_id = ?`,
      [holdingA, userA],
    );
    assert(Number(sharesAfterForecast?.shares) === Number(sharesBefore?.shares), 'the stored holding quantity stays unchanged');
    const dividendsAfterForecast = queryOne<{ c: number }>(
      db,
      `SELECT COUNT(*) AS c FROM dividend_events WHERE user_id = ?`,
      [userA],
    );
    const incomeAfterForecast = queryOne<{ c: number }>(
      db,
      `SELECT COUNT(*) AS c FROM income_records WHERE user_id = ?`,
      [userA],
    );
    assert(Number(dividendsAfterForecast?.c) === Number(dividendsBefore?.c), 'a forecast row is not saved as a dividend');
    assert(Number(incomeAfterForecast?.c) === Number(incomeBefore?.c), 'a forecast row is not saved as income');
    const forecastAsEvent = queryOne<{ c: number }>(
      db,
      `SELECT COUNT(*) AS c FROM dividend_events WHERE user_id = ? AND payment_date = ?`,
      [userA, '2026-11-14'],
    );
    assert(Number(forecastAsEvent?.c ?? 0) === 0, 'the predicted date is not a recorded payment');

    const stolenForecast = await setForecastReinvest(
      db,
      userB,
      holdingA,
      '2026-11-14',
      false,
      '2026-10-04',
      loader,
    );
    assert(!stolenForecast.ok, 'user B cannot change user A forecast reinvest');
    if (!stolenForecast.ok) assert(stolenForecast.status === 404, 'another user\'s holding is not found');
    const prefStillA = queryOne<{ c: number }>(
      db,
      `SELECT COUNT(*) AS c FROM dividend_forecast_reinvest WHERE user_id = ? AND holding_id = ?`,
      [userA, holdingA],
    );
    assert(Number(prefStillA?.c) === 1, 'user A forecast setting stays after the other user tries to change it');

    const missingForecast = await setForecastReinvest(
      db,
      userA,
      holdingA,
      '1999-01-01',
      true,
      '2026-10-04',
      loader,
    );
    assert(!missingForecast.ok, 'a date that is not on the projection is rejected');
    const stalePrefs = queryOne<{ c: number }>(
      db,
      `SELECT COUNT(*) AS c FROM dividend_forecast_reinvest WHERE user_id = ? AND payment_date = ?`,
      [userA, '1999-01-01'],
    );
    assert(Number(stalePrefs?.c ?? 0) === 0, 'a rejected forecast toggle is not stored');

    const forecastOff = await setForecastReinvest(
      db,
      userA,
      holdingA,
      '2026-11-14',
      false,
      '2026-10-04',
      loader,
    );
    assert(forecastOff.ok, 'user A can turn forecast reinvest off');
    if (!forecastOff.ok) return;
    assert(forecastOff.detected.every((row) => Math.abs(row.amount - 15) < 1e-6), 'off leaves the forecast on the current share count');
    const prefCleared = queryOne<{ c: number }>(
      db,
      `SELECT COUNT(*) AS c FROM dividend_forecast_reinvest WHERE user_id = ? AND holding_id = ?`,
      [userA, holdingA],
    );
    assert(Number(prefCleared?.c ?? 0) === 0, 'off removes the forecast setting');

    const noPriceId = 'divtest_h_noprice';
    run(db, `DELETE FROM holdings WHERE id = ?`, [noPriceId]);
    run(db, `DELETE FROM price_quotes WHERE asset_key = ?`, ['STOCK:NOPX']);
    run(
      db,
      `INSERT INTO holdings (id, user_id, asset_class, name, symbol, shares, cost_basis_nzd, created_at, updated_at)
       VALUES (?, ?, 'stock', 'No Price Ltd', 'NOPX', 20, NULL, ?, ?)`,
      [noPriceId, userA, now, now],
    );
    const noPriceOn = await setForecastReinvest(
      db,
      userA,
      noPriceId,
      '2026-11-14',
      true,
      '2026-10-04',
      loader,
    );
    assert(noPriceOn.ok, 'reinvest can be turned on when no price is saved');
    if (!noPriceOn.ok) return;
    assert(noPriceOn.detected[0]?.reinvestment.status === 'unavailable', 'reinvestment is unavailable without a price');
    assert(
      noPriceOn.detected[0]?.reinvestment.note?.includes('could not be applied') === true,
      'the response says reinvestment could not be applied',
    );
    assert(noPriceOn.detected.every((row) => Math.abs(row.sharesHeld - 20) < 1e-6), 'projected shares stay on the shares owned');
    const noPriceShares = queryOne<{ shares: number }>(
      db,
      `SELECT shares FROM holdings WHERE id = ? AND user_id = ?`,
      [noPriceId, userA],
    );
    assert(Number(noPriceShares?.shares) === 20, 'the no-price holding quantity stays unchanged');

    const linked = insertDividend(db, userA, {
      holdingId: holdingA,
      sharesHeld: 50,
      dividendPerShare: 0.2,
      paymentDate: '2026-09-01',
      currency: 'NZD',
      reinvested: false,
    });
    assert(linked.ok, 'user A can record another dividend on the holding that has a forecast');
    if (!linked.ok) return;
    const recordedOn = await setDividendReinvest(
      db,
      userA,
      linked.event.id,
      true,
      '2026-10-04',
      loader,
    );
    assert(recordedOn.ok, 'user A can turn reinvest on for a recorded payment');
    if (!recordedOn.ok) return;
    assert(recordedOn.event.reinvested === true, 'the recorded toggle is on');
    assert(Math.abs((recordedOn.event.reinvestedAmount ?? 0) - 10) < 1e-6, 'on reinvests the net cash');
    assert(Math.abs((recordedOn.ownedShares ?? 0) - 50) < 1e-6, 'recorded reinvest does not change shares owned');
    assert(Math.abs((recordedOn.detected[0]?.sharesHeld ?? 0) - 51) < 1e-6, 'later predicted payments include the recorded reinvestment');
    assert(Math.abs((recordedOn.detected[0]?.amount ?? 0) - 15.3) < 1e-6, 'the predicted cash uses those extra shares');
    const sharesAfterRecorded = queryOne<{ shares: number }>(
      db,
      `SELECT shares FROM holdings WHERE id = ? AND user_id = ?`,
      [holdingA, userA],
    );
    assert(Number(sharesAfterRecorded?.shares) === 50, 'shares owned stay at 50 after the recorded toggle');
    const stolenRecorded = await setDividendReinvest(
      db,
      userB,
      linked.event.id,
      false,
      '2026-10-04',
      loader,
    );
    assert(!stolenRecorded.ok, 'user B cannot change user A recorded reinvest');
    const stillOn = queryOne<{ reinvested: number }>(
      db,
      `SELECT reinvested FROM dividend_events WHERE id = ? AND user_id = ?`,
      [linked.event.id, userA],
    );
    assert(Number(stillOn?.reinvested) === 1, 'user A recorded reinvest stays on');

    const userBAfter = await dashboardForUser(db, userB, 2026, '2026-10-04', loader);
    assert(userBAfter.forecast.detected.every((row) => row.symbol === 'BRAV'), 'user B forecast is still only their holding');
    assert(userBAfter.forecast.detected.every((row) => Math.abs(row.amount - 90) < 1e-6), 'user B amounts are unchanged by user A reinvestment');
    assert(userBAfter.history.every((row) => row.companyName === 'Bravo Ltd'), 'user B recorded rows are untouched');

    run(
      db,
      `INSERT INTO dividend_forecast_reinvest (
         id, user_id, holding_id, payment_date, reinvested, created_at, updated_at
       ) VALUES (?, ?, ?, '2026-11-14', 1, ?, ?)`,
      ['divtest_pref_b', userB, holdingB, now, now],
    );
    const unlinkedPrefs = unlinkDividendsForHolding(db, userB, holdingA);
    assert(unlinkedPrefs === 0, 'user B still cannot unlink user A dividends');
    const clearedByOther = queryOne<{ c: number }>(
      db,
      `SELECT COUNT(*) AS c FROM dividend_forecast_reinvest WHERE user_id = ? AND holding_id = ?`,
      [userA, noPriceId],
    );
    assert(Number(clearedByOther?.c) === 1, 'user B cannot clear user A forecast settings');
    const unlinkedOwnPref = unlinkDividendsForHolding(db, userA, noPriceId);
    assert(unlinkedOwnPref === 0, 'unlinking a holding with no dividend rows still runs');
    const prefGone = queryOne<{ c: number }>(
      db,
      `SELECT COUNT(*) AS c FROM dividend_forecast_reinvest WHERE user_id = ? AND holding_id = ?`,
      [userA, noPriceId],
    );
    assert(Number(prefGone?.c ?? 0) === 0, 'removing a holding clears that user\'s forecast reinvest rows');
    const prefBLeft = queryOne<{ c: number }>(
      db,
      `SELECT COUNT(*) AS c FROM dividend_forecast_reinvest WHERE user_id = ? AND holding_id = ?`,
      [userB, holdingB],
    );
    assert(Number(prefBLeft?.c) === 1, 'the other user\'s forecast setting remains');

    const scoped = deleteScopedDataForUser(db, userA);
    assert((scoped.tables.dividend_events ?? 0) >= 2, 'account deletion counts this user\'s dividend rows');
    assert(listDividendEvents(db, userA).length === 0, 'account deletion removes that user\'s dividend data');
    assert(listDividendEvents(db, userB).length === 1, 'the other user\'s dividend data remains');
    const prefBAfterDelete = queryOne<{ c: number }>(
      db,
      `SELECT COUNT(*) AS c FROM dividend_forecast_reinvest WHERE user_id = ?`,
      [userB],
    );
    assert(Number(prefBAfterDelete?.c) === 1, 'account deletion leaves the other user\'s forecast reinvest setting');
    const prefAAfterDelete = queryOne<{ c: number }>(
      db,
      `SELECT COUNT(*) AS c FROM dividend_forecast_reinvest WHERE user_id = ?`,
      [userA],
    );
    assert(Number(prefAAfterDelete?.c ?? 0) === 0, 'account deletion removes that user\'s forecast reinvest settings');
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
    run(db, `DELETE FROM dividend_forecast_reinvest WHERE user_id IN (?, ?)`, [userA, userB]);
    run(db, `DELETE FROM dividend_events WHERE user_id IN (?, ?)`, [userA, userB]);
    run(db, `DELETE FROM budget_categories WHERE user_id IN (?, ?)`, [userA, userB]);
    run(db, `DELETE FROM holdings WHERE id IN (?, ?, ?, ?, ?, ?)`, [holdingA, holdingA2, holdingB, 'divtest_h_crypto', 'divtest_h_blank', 'divtest_h_noprice']);
    run(db, `DELETE FROM price_quotes WHERE asset_key = ?`, ['STOCK:NOPX']);
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
