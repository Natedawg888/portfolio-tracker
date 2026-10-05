/**
 * Dividend totals come from recorded rows only.
 * Run: npm run test:dividends
 */
import {
  REINVEST_ALREADY_OWNED_NOTE,
  REINVEST_NO_FX_NOTE,
  REINVEST_NO_PRICE_NOTE,
  buildDividendDashboard,
  computeDividend,
  netInNzd,
  projectDividendFromHistory,
  projectDividendSchedule,
  shiftMonths,
} from './model.ts';
import type { DetectedDividend, DividendRecord, HoldingValueInput, PublishedDividendSeries } from './model.ts';

function assert(cond: unknown, msg: string): void {
  if (!cond) throw new Error(`FAIL: ${msg}`);
}

function eq(actual: number | null, expected: number, msg: string): void {
  if (actual == null || Math.abs(actual - expected) > 1e-6) {
    throw new Error(`FAIL: ${msg} (got ${actual}, expected ${expected})`);
  }
}

const holding: HoldingValueInput = {
  id: 'h1',
  name: 'Example ETF',
  symbol: 'ETF',
  shares: 100,
  costBasisNzd: 1000,
  quotedPriceNzd: null,
};

function row(partial: Partial<DividendRecord> & Pick<DividendRecord, 'id' | 'paymentDate' | 'netDividend'>): DividendRecord {
  return {
    holdingId: 'h1',
    companyName: 'Example ETF',
    symbol: 'ETF',
    sharesHeld: 100,
    dividendPerShare: 0.1,
    grossDividend: 10,
    taxWithholding: 0,
    imputationCredits: 0,
    currency: 'NZD',
    fxRateToNzd: 1,
    reinvested: false,
    reinvestedAmount: null,
    notes: null,
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
    ...partial,
  };
}

const computed = computeDividend({
  sharesHeld: 80,
  dividendPerShare: 0.25,
  taxWithholding: 4,
  imputationCredits: 7.78,
  paymentDate: '2026-03-15',
  currency: 'NZD',
  reinvested: true,
  reinvestedAmount: 16,
});
assert(computed.ok, 'compute nz dividend');
if (!computed.ok) throw new Error('unreachable');
eq(computed.value.grossDividend, 20, 'gross is shares times dividend per share');
eq(computed.value.netDividend, 16, 'net is gross minus tax');
eq(computed.value.imputationCredits, 7.78, 'imputation credits stay recorded');
eq(computed.value.netDividend, computed.value.grossDividend - computed.value.taxWithholding, 'net ignores imputation credits');
eq(computed.value.fxRateToNzd, 1, 'NZD rate is 1');

const usd = computeDividend({
  sharesHeld: 10,
  dividendPerShare: 1,
  taxWithholding: 1.5,
  paymentDate: '2026-04-01',
  currency: 'USD',
  fxRateToNzd: 1.6,
  reinvested: false,
});
assert(usd.ok, 'compute usd dividend');
if (!usd.ok) throw new Error('unreachable');
eq(usd.value.netDividend, 8.5, 'usd net');
eq(netInNzd(usd.value.netDividend, usd.value.fxRateToNzd), 13.6, 'usd converted with the recorded rate');

const missingFx = computeDividend({
  sharesHeld: 10,
  dividendPerShare: 1,
  paymentDate: '2026-04-02',
  currency: 'USD',
});
assert(missingFx.ok, 'fx may be omitted');
if (!missingFx.ok) throw new Error('unreachable');
assert(missingFx.value.fxRateToNzd == null, 'blank fx is not filled in');
assert(netInNzd(missingFx.value.netDividend, missingFx.value.fxRateToNzd) == null, 'missing fx does not produce NZD');

const badTax = computeDividend({
  sharesHeld: 10,
  dividendPerShare: 1,
  taxWithholding: 11,
  paymentDate: '2026-04-03',
});
assert(!badTax.ok, 'tax above gross is rejected');

const badReinvest = computeDividend({
  sharesHeld: 10,
  dividendPerShare: 1,
  paymentDate: '2026-04-03',
  reinvested: true,
  reinvestedAmount: 20,
});
assert(!badReinvest.ok, 'reinvestment above net is rejected');

const events: DividendRecord[] = [
  row({ id: 'a', paymentDate: '2025-06-01', netDividend: 100, grossDividend: 100, dividendPerShare: 1 }),
  row({ id: 'b', paymentDate: '2026-02-01', netDividend: 40, grossDividend: 50, taxWithholding: 10, dividendPerShare: 0.5 }),
  row({
    id: 'c',
    paymentDate: '2026-11-20',
    netDividend: 25,
    grossDividend: 25,
    dividendPerShare: 0.25,
    currency: 'USD',
    fxRateToNzd: null,
  }),
  row({
    id: 'd',
    paymentDate: '2026-12-15',
    netDividend: 30,
    grossDividend: 30,
    dividendPerShare: 0.3,
    currency: 'AUD',
    fxRateToNzd: 1.1,
  }),
];

const dash = buildDividendDashboard({
  events,
  holdings: [holding],
  year: 2026,
  today: '2026-10-04',
});

eq(dash.yearIncomeNzd, 40, '2026 income is only paid rows with an FX rate');
assert(dash.yearPaidCount === 1, 'future and prior-year rows stay out of the 2026 paid count');
assert(dash.yearUnconvertedCount === 0, 'the unconverted row is still upcoming on this date');
assert(dash.upcoming.length === 2, 'later dates are upcoming');
assert(dash.upcoming.find((item) => item.id === 'c')?.netNzd == null, 'upcoming without fx has no NZD amount');
eq(dash.forecast.statedUpcomingNzd, 33, 'stated upcoming uses only rows with an FX rate');
assert(dash.forecast.statedUnconvertedCount === 1, 'stated upcoming counts the row left in foreign currency');
eq(dash.forecast.historyRunRateNzd, 40, 'history projection is the trailing recorded total');
assert(!dash.forecast.note.toLowerCase().includes('market forecast') || dash.forecast.note.includes('not a market forecast'), 'forecast is labelled');
assert(dash.forecast.note.includes('not a market forecast'), 'forecast says it is not a market forecast');
assert(dash.growth.available, 'two years of NZD rows can show growth');
assert(dash.growth.currentThrough === '2026-10-04', 'open year ends on today');
assert(dash.growth.previousThrough === '2025-10-04', 'prior year uses the same month and day');
eq(dash.growth.previousNzd, 100, '2025 base inside the same dates');
eq(dash.growth.currentNzd, 40, '2026 paid');
eq(dash.growth.changePct, -60, 'growth compares the same dates, not a full prior year');
assert(dash.growth.note.includes('Not a full-year change'), 'open-year growth is not labelled as a full-year change');
assert(dash.growth.note.includes('1 Jan 2025'), 'note names the prior window');
assert(dash.growth.note.includes('4 Oct 2026'), 'note names the current window');
assert(dash.yield.available, 'cost basis can denominate yield');
eq(dash.yield.trailingNetNzd, 40, 'yield numerator is trailing recorded net');
eq(dash.yield.denominatorNzd, 1000, 'yield denominator is recorded cost');
eq(dash.yield.yieldPct, 4, 'yield percent');
assert(dash.yield.basis === 'cost', 'no saved quote means cost basis');

const quoted = buildDividendDashboard({
  events: [row({ id: 'q', paymentDate: '2026-08-01', netDividend: 50, grossDividend: 50, dividendPerShare: 0.5 })],
  holdings: [{ ...holding, quotedPriceNzd: 20 }],
  year: 2026,
  today: '2026-10-04',
});
assert(quoted.yield.basis === 'quote', 'saved quote is preferred to cost');
eq(quoted.yield.denominatorNzd, 2000, 'quote times current shares');
eq(quoted.yield.yieldPct, 2.5, 'yield from saved quote');

const empty = buildDividendDashboard({
  events: [],
  holdings: [],
  year: 2026,
  today: '2026-10-04',
});
assert(!empty.hasEvents, 'empty history');
assert(empty.yearIncomeNzd == null, 'empty year has no invented total');
assert(empty.growth.changePct == null, 'empty growth');
assert(empty.yield.yieldPct == null, 'empty yield');
assert(empty.forecast.historyRunRateNzd == null, 'empty history projection');
assert(empty.forecast.statedUpcomingNzd == null, 'empty stated upcoming');
assert(empty.forecast.detectedCount === 0, 'empty forecast does not invent a holding payment');
assert(empty.forecast.detectedNzd == null, 'empty detected total');
assert(empty.forecast.note.includes('not a market forecast'), 'forecast note refuses a market forecast');
assert(empty.forecast.note.includes('no dividend figure'), 'forecast note says missing figures are left out');
assert(JSON.stringify(empty).includes('2438') === false, 'layout example amount is not a result');

const otherUser = buildDividendDashboard({
  events: [row({ id: 'mine', paymentDate: '2026-05-01', companyName: 'Mine Co', netDividend: 12, grossDividend: 12, dividendPerShare: 0.12 })],
  holdings: [holding],
  year: 2026,
  today: '2026-10-04',
});
assert(otherUser.history.every((item) => item.companyName === 'Mine Co'), 'dashboard only contains the rows it was given');
assert(!otherUser.history.some((item) => item.companyName === 'Example ETF' && item.id !== 'mine'), 'no extra company is added');

assert(shiftMonths('2026-10-04', -12) === '2025-10-04', 'trailing window is twelve calendar months');

const sameDates = buildDividendDashboard({
  events: [
    row({ id: 'early', paymentDate: '2025-03-01', netDividend: 10, grossDividend: 10, dividendPerShare: 0.1 }),
    row({ id: 'cutoff', paymentDate: '2025-10-04', netDividend: 10, grossDividend: 10, dividendPerShare: 0.1 }),
    row({ id: 'after', paymentDate: '2025-10-05', netDividend: 80, grossDividend: 80, dividendPerShare: 0.8 }),
    row({ id: 'now', paymentDate: '2026-03-01', netDividend: 40, grossDividend: 40, dividendPerShare: 0.4 }),
  ],
  holdings: [holding],
  year: 2026,
  today: '2026-10-04',
});
eq(sameDates.growth.previousNzd, 20, 'prior-year payments after the same day stay out of growth');
eq(sameDates.growth.currentNzd, 40, 'current window uses recorded rows only');
eq(sameDates.growth.changePct, 100, 'change uses the matching windows');
const year2025 = sameDates.annual.find((item) => item.year === 2025);
eq(year2025?.netNzd ?? null, 100, 'annual total still keeps the later prior-year payment');
assert(sameDates.growth.note.includes('Not a full-year change'), 'partial comparison says it is not a full year');

const closed = buildDividendDashboard({
  events: [
    row({ id: 'prior-dec', paymentDate: '2024-12-15', netDividend: 50, grossDividend: 50, dividendPerShare: 0.5 }),
    row({ id: 'this-dec', paymentDate: '2025-12-15', netDividend: 80, grossDividend: 80, dividendPerShare: 0.8 }),
  ],
  holdings: [holding],
  year: 2025,
  today: '2026-10-04',
});
assert(closed.growth.previousThrough === '2024-12-31', 'completed prior year runs through 31 Dec');
assert(closed.growth.currentThrough === '2025-12-31', 'completed selected year runs through 31 Dec');
eq(closed.growth.previousNzd, 50, 'completed years include December of the prior year');
eq(closed.growth.currentNzd, 80, 'completed years include December of the selected year');
eq(closed.growth.changePct, 60, 'full recorded years can be compared');
assert(!closed.growth.note.includes('Not a full-year change'), 'a finished year is a full-year comparison');

const leap = buildDividendDashboard({
  events: [
    row({ id: 'ly', paymentDate: '2023-02-28', netDividend: 5, grossDividend: 5, dividendPerShare: 0.05 }),
    row({ id: 'march', paymentDate: '2023-03-01', netDividend: 100, grossDividend: 100, dividendPerShare: 1 }),
    row({ id: 'leap-day', paymentDate: '2024-02-29', netDividend: 8, grossDividend: 8, dividendPerShare: 0.08 }),
  ],
  holdings: [holding],
  year: 2024,
  today: '2024-02-29',
});
assert(leap.growth.previousThrough === '2023-02-28', '29 February compares with 28 February');
eq(leap.growth.previousNzd, 5, 'March of the prior year stays outside the leap-day window');
eq(leap.growth.currentNzd, 8, 'the leap-day payment is inside the window');

const missingPriorFx = buildDividendDashboard({
  events: [
    row({
      id: 'no-fx',
      paymentDate: '2025-05-01',
      netDividend: 10,
      grossDividend: 10,
      dividendPerShare: 0.1,
      currency: 'USD',
      fxRateToNzd: null,
    }),
    row({ id: 'this-nzd', paymentDate: '2026-05-01', netDividend: 10, grossDividend: 10, dividendPerShare: 0.1 }),
  ],
  holdings: [holding],
  year: 2026,
  today: '2026-10-04',
});
assert(!missingPriorFx.growth.available, 'a missing FX rate does not become an NZD growth base');
assert(missingPriorFx.growth.changePct == null, 'no growth percent is invented without both NZD amounts');

const mixedYield = buildDividendDashboard({
  events: [
    row({ id: 'linked', paymentDate: '2026-05-01', netDividend: 40, grossDividend: 40, dividendPerShare: 0.4 }),
    row({
      id: 'gone',
      holdingId: null,
      paymentDate: '2026-06-01',
      netDividend: 999,
      grossDividend: 999,
      dividendPerShare: 9.99,
      companyName: 'Sold Co',
    }),
    row({
      id: 'dangling',
      holdingId: 'missing',
      paymentDate: '2026-07-01',
      netDividend: 50,
      grossDividend: 50,
      dividendPerShare: 0.5,
    }),
  ],
  holdings: [holding],
  year: 2026,
  today: '2026-10-04',
});
assert(mixedYield.yield.available, 'a linked holding still has a yield');
eq(mixedYield.yield.trailingNetNzd, 40, 'unlinked rows are left out of the yield numerator');
eq(mixedYield.yield.denominatorNzd, 1000, 'yield denominator is the remaining holding');
eq(mixedYield.yield.yieldPct, 4, 'yield uses the linked holding only');
assert(mixedYield.yield.note.includes('left out'), 'yield says unlinked payments are left out');
eq(mixedYield.yearIncomeNzd, 1089, 'year income still records every paid amount');
assert(mixedYield.history.some((item) => item.id === 'gone'), 'an unlinked payment stays in the personal record');

const onlyUnlinked = buildDividendDashboard({
  events: [
    row({
      id: 'only-gone',
      holdingId: null,
      paymentDate: '2026-06-01',
      netDividend: 15,
      grossDividend: 15,
      dividendPerShare: 0.15,
    }),
  ],
  holdings: [holding],
  year: 2026,
  today: '2026-10-04',
});
assert(!onlyUnlinked.yield.available, 'yield needs a linked holding');
assert(onlyUnlinked.yield.yieldPct == null, 'no yield percent is invented for an unlinked payment');
assert(onlyUnlinked.yield.trailingNetNzd == null, 'the ignored amount is not reported as the yield numerator');
eq(onlyUnlinked.yearIncomeNzd, 15, 'the unlinked payment is still income');

function series(payments: Array<{ date: string; amountPerShare: number }>, currency = 'NZD'): PublishedDividendSeries {
  return { source: 'yahoo', currency, payments };
}

const projected = projectDividendFromHistory({
  holdingId: 'h1',
  name: 'Example ETF',
  symbol: 'ETF',
  shares: 100,
  today: '2026-10-04',
  fxRateToNzd: null,
  series: series([
    { date: '2026-02-13', amountPerShare: 0.2 },
    { date: '2026-05-14', amountPerShare: 0.5 },
    { date: '2026-08-14', amountPerShare: 0.3 },
  ]),
});
assert(projected, 'three published quarterly dividends can project the next date');
if (!projected) throw new Error('unreachable');
eq(projected.dividendPerShare, 0.3, 'projection uses the last published amount, not an average');
eq(projected.amount, 30, 'cash amount is shares times that last amount');
eq(projected.amountNzd, 30, 'NZD amount uses the identity rate, not a guessed FX rate');
assert(projected.paymentDate === '2026-11-14', 'next date is the last published date plus the quarterly gap');
assert(projected.basis === 'projected', 'the date is labelled as a projection');
assert(projected.intervalMonths === 3, 'the gap is quarterly');
assert(projected.lastPaidDate === '2026-08-14', 'the last published date is kept');
assert(!projected.paymentDate.includes('yield'), 'no yield is attached');

const averaged = projectDividendFromHistory({
  holdingId: 'h1',
  name: 'Example ETF',
  symbol: 'ETF',
  shares: 10,
  today: '2026-10-04',
  fxRateToNzd: null,
  series: series([
    { date: '2026-02-13', amountPerShare: 1 },
    { date: '2026-05-14', amountPerShare: 3 },
    { date: '2026-08-14', amountPerShare: 0.4 },
  ]),
});
eq(averaged?.dividendPerShare ?? null, 0.4, 'a smaller latest dividend is not replaced with an average');
eq(averaged?.amount ?? null, 4, 'cash follows the latest per-share figure');

const usdProjected = projectDividendFromHistory({
  holdingId: 'h1',
  name: 'Example ETF',
  symbol: 'ETF',
  shares: 10,
  today: '2026-10-04',
  fxRateToNzd: 1.6,
  series: series([
    { date: '2026-02-13', amountPerShare: 0.5 },
    { date: '2026-05-14', amountPerShare: 0.5 },
    { date: '2026-08-14', amountPerShare: 0.5 },
  ], 'USD'),
});
eq(usdProjected?.amount ?? null, 5, 'foreign cash stays in the published currency');
eq(usdProjected?.amountNzd ?? null, 8, 'NZD uses the supplied FX rate');
assert(usdProjected?.fxRateToNzd === 1.6, 'the FX rate is the one supplied');

const missingRate = projectDividendFromHistory({
  holdingId: 'h1',
  name: 'Example ETF',
  symbol: 'ETF',
  shares: 10,
  today: '2026-10-04',
  fxRateToNzd: null,
  series: series([
    { date: '2026-02-13', amountPerShare: 0.5 },
    { date: '2026-05-14', amountPerShare: 0.5 },
    { date: '2026-08-14', amountPerShare: 0.5 },
  ], 'USD'),
});
eq(missingRate?.amount ?? null, 5, 'native cash remains when FX is missing');
assert(missingRate?.amountNzd == null, 'missing FX does not become an NZD amount');

assert(projectDividendFromHistory({
  holdingId: 'h1',
  name: 'Example ETF',
  symbol: 'ETF',
  shares: 10,
  today: '2026-10-04',
  fxRateToNzd: null,
  series: series([{ date: '2026-08-14', amountPerShare: 1 }]),
}) == null, 'one published dividend is not enough to invent a next date');

assert(projectDividendFromHistory({
  holdingId: 'h1',
  name: 'Example ETF',
  symbol: 'ETF',
  shares: 10,
  today: '2026-10-04',
  fxRateToNzd: null,
  series: series([
    { date: '2026-01-15', amountPerShare: 1 },
    { date: '2026-03-01', amountPerShare: 1 },
    { date: '2026-08-20', amountPerShare: 1 },
  ]),
}) == null, 'uneven gaps are not turned into a schedule');

assert(projectDividendFromHistory({
  holdingId: 'h1',
  name: 'Example ETF',
  symbol: 'ETF',
  shares: 10,
  today: '2026-10-04',
  fxRateToNzd: null,
  series: series([
    { date: '2024-01-15', amountPerShare: 1 },
    { date: '2024-04-15', amountPerShare: 1 },
    { date: '2024-07-15', amountPerShare: 1 },
  ]),
}) == null, 'a lapsed cadence is not stepped forward again');

assert(projectDividendFromHistory({
  holdingId: 'h1',
  name: 'Example ETF',
  symbol: 'ETF',
  shares: 0,
  today: '2026-10-04',
  fxRateToNzd: null,
  series: series([
    { date: '2026-02-13', amountPerShare: 0.3 },
    { date: '2026-05-14', amountPerShare: 0.3 },
    { date: '2026-08-14', amountPerShare: 0.3 },
  ]),
}) == null, 'missing shares do not invent a cash amount');

assert(projectDividendFromHistory({
  holdingId: 'h1',
  name: 'Example ETF',
  symbol: 'ETF',
  shares: 10,
  today: '2026-10-04',
  fxRateToNzd: null,
  series: null,
}) == null, 'no published series means no projection');

const publishedNext = projectDividendFromHistory({
  holdingId: 'h1',
  name: 'Example ETF',
  symbol: 'ETF',
  shares: 8,
  today: '2026-10-04',
  fxRateToNzd: null,
  series: series([
    { date: '2026-05-14', amountPerShare: 0.2 },
    { date: '2026-08-14', amountPerShare: 0.2 },
    { date: '2026-11-20', amountPerShare: 0.45 },
  ]),
});
assert(publishedNext?.basis === 'published', 'a future published dividend keeps that date');
assert(publishedNext?.paymentDate === '2026-11-20', 'the published future date is not shifted');
eq(publishedNext?.dividendPerShare ?? null, 0.45, 'the published future amount is kept');
eq(publishedNext?.amount ?? null, 3.6, 'cash uses the published future amount');

const withDetected = buildDividendDashboard({
  events,
  holdings: [holding],
  year: 2026,
  today: '2026-10-04',
  detected: [projected, usdProjected as DetectedDividend],
});
eq(withDetected.forecast.detectedNzd, 38, 'detected NZD sums only rows that have an FX rate');
assert(withDetected.forecast.detectedCount === 2, 'both detected rows are listed');
eq(withDetected.forecast.statedUpcomingNzd, 33, 'detected rows are not added to stated upcoming');
eq(withDetected.forecast.historyRunRateNzd, 40, 'detected rows are not added to recorded history');
assert(withDetected.upcoming.every((item) => item.id === 'c' || item.id === 'd'), 'detected rows are not stored as entered payments');

const inconsistent: DetectedDividend = {
  ...projected,
  amount: 999,
  amountNzd: 999,
};
const dropped = buildDividendDashboard({
  events: [],
  holdings: [holding],
  year: 2026,
  today: '2026-10-04',
  detected: [inconsistent],
});
assert(dropped.forecast.detectedCount === 0, 'a cash amount that does not match shares times per share is left out');
assert(dropped.forecast.detectedNzd == null, 'an inconsistent detected amount is not totalled');

const quarterlySeries = series([
  { date: '2026-02-13', amountPerShare: 0.3 },
  { date: '2026-05-14', amountPerShare: 0.3 },
  { date: '2026-08-14', amountPerShare: 0.3 },
]);
const schedule = projectDividendSchedule({
  holdingId: 'h1',
  name: 'Example ETF',
  symbol: 'ETF',
  shares: 100,
  today: '2026-10-04',
  fxRateToNzd: null,
  series: quarterlySeries,
});
assert(schedule.length === 4, 'the forecast lists predicted payments through the next 12 months');
assert(schedule[0]?.paymentDate === '2026-11-14', 'the first predicted date matches the single next payment');
assert(schedule[1]?.paymentDate === '2027-02-14', 'the second date keeps the quarterly gap');
assert(schedule[2]?.paymentDate === '2027-05-14', 'the third date keeps the quarterly gap');
assert(schedule[3]?.paymentDate === '2027-08-14', 'the fourth date stays inside the 12-month window');
assert(schedule.every((row) => row.sharesHeld === 100 && row.ownedShares === 100), 'off starts on the shares owned');
assert(schedule.every((row) => row.reinvested === false), 'forecast reinvest defaults to off');
assert(schedule[0]?.id === 'h1:2026-11-14', 'forecast row id is the holding and the payment date');

const pricedHolding: HoldingValueInput = {
  ...holding,
  shares: 100,
  costBasisNzd: 1000,
  quotedPriceNzd: null,
};
const compounded = buildDividendDashboard({
  events: [],
  holdings: [pricedHolding],
  year: 2026,
  today: '2026-10-04',
  detected: schedule.map((row, index) => ({ ...row, reinvested: index === 0 || index === 1 })),
});
eq(compounded.forecast.detected[0]?.amount ?? null, 30, 'the first payment still uses the shares owned');
eq(compounded.forecast.detected[0]?.ownedShares ?? null, 100, 'owned shares stay on the forecast row');
eq(compounded.forecast.detected[0]?.reinvestment.sharesAdded ?? null, 3, 'gross cash divided by the recorded cost buys shares');
assert(compounded.forecast.detected[0]?.reinvestment.priceSource === 'cost', 'cost basis is the recorded price when no quote is saved');
assert(compounded.forecast.detected[0]?.reinvestment.note?.includes('gross cash') === true, 'forecast reinvestment is labelled gross cash');
assert(compounded.forecast.detected[0]?.reinvestment.note?.includes('net cash') !== true, 'forecast reinvestment is not called net cash');
assert(compounded.forecast.detected[0]?.reinvestment.note?.includes('Tax is not estimated') === true, 'forecast reinvestment says tax is not estimated');
assert(compounded.forecast.note.includes('gross cash'), 'the forecast note calls the reinvested amount gross cash');
assert(!compounded.forecast.note.includes("payment's net cash"), 'the forecast note does not call a predicted payment net cash');
assert(compounded.forecast.detected[0]?.reinvestment.note?.includes('Not financial advice') === true, 'applied reinvestment is not advice');
eq(compounded.forecast.detected[1]?.sharesHeld ?? null, 103, 'the next payment uses the extra shares');
eq(compounded.forecast.detected[1]?.amount ?? null, 30.9, 'the next amount compounds');
eq(compounded.forecast.detected[1]?.reinvestment.sharesAdded ?? null, 3.09, 'the second payment also buys shares');
eq(compounded.forecast.detected[2]?.sharesHeld ?? null, 106.09, 'a later payment includes both earlier reinvestments');
eq(compounded.forecast.detected[2]?.amount ?? null, 31.827, 'the third amount uses the compounded share count');
assert(compounded.forecast.detected[2]?.reinvested === false, 'a later row can stay off');
assert(compounded.forecast.detected[2]?.reinvestment.status === 'off', 'off does not add further shares');
assert(compounded.history.length === 0, 'forecast rows are not saved as dividend records');
assert(compounded.upcoming.length === 0, 'forecast rows are not saved as upcoming records');

const quotePreferred = buildDividendDashboard({
  events: [],
  holdings: [{ ...pricedHolding, quotedPriceNzd: 20 }],
  year: 2026,
  today: '2026-10-04',
  detected: schedule.map((row, index) => ({ ...row, reinvested: index === 0 })),
});
eq(quotePreferred.forecast.detected[0]?.reinvestment.sharesAdded ?? null, 1.5, 'a saved quote is used instead of cost basis');
assert(quotePreferred.forecast.detected[0]?.reinvestment.priceSource === 'quote', 'the price source is the saved quote');
eq(quotePreferred.forecast.detected[1]?.sharesHeld ?? null, 101.5, 'later payments use the shares bought at the saved quote');

const noPrice = buildDividendDashboard({
  events: [],
  holdings: [{ ...pricedHolding, costBasisNzd: null, quotedPriceNzd: null }],
  year: 2026,
  today: '2026-10-04',
  detected: schedule.map((row, index) => ({ ...row, reinvested: index === 0 })),
});
assert(noPrice.forecast.detected[0]?.reinvestment.status === 'unavailable', 'reinvestment is unavailable without a price');
assert(noPrice.forecast.detected[0]?.reinvestment.note === REINVEST_NO_PRICE_NOTE, 'the note says reinvestment could not be applied');
eq(noPrice.forecast.detected[0]?.sharesHeld ?? null, 100, 'missing price leaves the first projected share count unchanged');
eq(noPrice.forecast.detected[1]?.sharesHeld ?? null, 100, 'missing price leaves later projected share counts unchanged');
eq(noPrice.forecast.detected[1]?.amount ?? null, 30, 'later amounts stay on the current share count');

const pastReinvest = buildDividendDashboard({
  events: [
    row({
      id: 'past-re',
      paymentDate: '2026-08-01',
      netDividend: 50,
      grossDividend: 50,
      dividendPerShare: 0.5,
      reinvested: true,
      reinvestedAmount: 50,
    }),
  ],
  holdings: [pricedHolding],
  year: 2026,
  today: '2026-10-04',
  detected: schedule,
});
eq(pastReinvest.history[0]?.sharesHeld ?? null, 100, 'a recorded payment keeps the shares that were stored on it');
eq(pastReinvest.history[0]?.netDividend ?? null, 50, 'reinvestment does not change the recorded net cash');
assert(pastReinvest.history[0]?.reinvested === true, 'the paid row can still be marked reinvested');
assert(pastReinvest.history[0]?.reinvestment.sharesAdded == null, 'a paid dividend does not add projected shares');
assert(pastReinvest.history[0]?.reinvestment.note === REINVEST_ALREADY_OWNED_NOTE, 'a paid dividend is already in the shares owned');
eq(pastReinvest.forecast.detected[0]?.sharesHeld ?? null, 100, 'later predicted payments stay on the shares owned');
eq(pastReinvest.forecast.detected[0]?.amount ?? null, 30, 'a paid reinvested dividend does not inflate the forecast');
assert(pastReinvest.forecast.detected.every((item) => item.sharesHeld === 100), 'no later payment picks up shares from a paid dividend');
assert(pastReinvest.forecast.detected.every((item) => item.reinvested === false), 'forecast rows stay off unless toggled');

const futureReinvest = buildDividendDashboard({
  events: [
    row({
      id: 'future-re',
      paymentDate: '2026-11-01',
      netDividend: 50,
      grossDividend: 50,
      dividendPerShare: 0.5,
      reinvested: true,
      reinvestedAmount: 50,
    }),
  ],
  holdings: [pricedHolding],
  year: 2026,
  today: '2026-10-04',
  detected: schedule,
});
eq(futureReinvest.upcoming[0]?.reinvestment.sharesAdded ?? null, 5, 'a recorded payment after today buys shares for later predictions');
assert(futureReinvest.upcoming[0]?.reinvestment.note?.includes('net cash') === true, 'a recorded payment reinvests net cash');
eq(futureReinvest.forecast.detected[0]?.sharesHeld ?? null, 105, 'later predicted payments include shares from a recorded payment after today');
eq(futureReinvest.forecast.detected[0]?.amount ?? null, 31.5, 'the predicted cash uses those extra shares');

const missingFxReinvest = buildDividendDashboard({
  events: [
    row({
      id: 'fx-re',
      paymentDate: '2026-11-01',
      netDividend: 10,
      grossDividend: 10,
      dividendPerShare: 0.1,
      currency: 'USD',
      fxRateToNzd: null,
      reinvested: true,
      reinvestedAmount: 10,
    }),
  ],
  holdings: [pricedHolding],
  year: 2026,
  today: '2026-10-04',
  detected: schedule,
});
assert(missingFxReinvest.upcoming[0]?.reinvestment.status === 'unavailable', 'missing FX cannot buy shares');
assert(missingFxReinvest.upcoming[0]?.reinvestment.note === REINVEST_NO_FX_NOTE, 'missing FX says reinvestment could not be applied');
eq(missingFxReinvest.forecast.detected[0]?.sharesHeld ?? null, 100, 'missing FX leaves the projected share count unchanged');

const otherHolding = buildDividendDashboard({
  events: [
    row({
      id: 'other',
      holdingId: 'h2',
      paymentDate: '2026-08-01',
      netDividend: 50,
      grossDividend: 50,
      reinvested: true,
      reinvestedAmount: 50,
    }),
  ],
  holdings: [
    pricedHolding,
    { ...pricedHolding, id: 'h2', name: 'Other', symbol: 'OTH' },
  ],
  year: 2026,
  today: '2026-10-04',
  detected: schedule,
});
eq(otherHolding.forecast.detected[0]?.sharesHeld ?? null, 100, 'another holding\'s reinvestment does not change this forecast');

const publishedSchedule = projectDividendSchedule({
  holdingId: 'h1',
  name: 'Example ETF',
  symbol: 'ETF',
  shares: 8,
  today: '2026-10-04',
  fxRateToNzd: null,
  series: series([
    { date: '2026-05-14', amountPerShare: 0.2 },
    { date: '2026-08-14', amountPerShare: 0.2 },
    { date: '2026-11-20', amountPerShare: 0.45 },
  ]),
});
assert(publishedSchedule[0]?.basis === 'published', 'the first future published date stays published');
assert(publishedSchedule[0]?.paymentDate === '2026-11-20', 'the published date is not shifted');
assert(publishedSchedule[1]?.basis === 'projected', 'later dates repeat the gap');
assert(publishedSchedule[1]?.paymentDate === '2027-02-20', 'the next date is one quarter after the published one');
eq(publishedSchedule[1]?.dividendPerShare ?? null, 0.45, 'later payments repeat the last published amount');

console.log('dividend model tests passed');
