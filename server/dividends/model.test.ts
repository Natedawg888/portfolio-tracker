/**
 * Dividend totals come from recorded rows only.
 * Run: npm run test:dividends
 */
import {
  buildDividendDashboard,
  computeDividend,
  netInNzd,
  shiftMonths,
} from './model.ts';
import type { DividendRecord, HoldingValueInput } from './model.ts';

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
eq(dash.growth.previousNzd, 100, '2025 base');
eq(dash.growth.currentNzd, 40, '2026 paid');
eq(dash.growth.changePct, -60, 'growth is the change between recorded years');
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

console.log('dividend model tests passed');
