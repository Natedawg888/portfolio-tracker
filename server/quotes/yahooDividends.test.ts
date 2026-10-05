/**
 * Yahoo chart dividend parsing uses only fields the payload contains.
 * Run: npm run test:dividends
 */
import { parseYahooDividendChart, ymdInTimeZone } from './yahooDividends.ts';

function assert(cond: unknown, msg: string): void {
  if (!cond) throw new Error(`FAIL: ${msg}`);
}

function eq(actual: unknown, expected: unknown, msg: string): void {
  if (actual !== expected) throw new Error(`FAIL: ${msg} (got ${String(actual)}, expected ${String(expected)})`);
}

const aaplStamp = 1762785000;
const fnzStamp = 1748469600;

eq(ymdInTimeZone(aaplStamp, 'America/New_York'), '2025-11-10', 'US dividend date stays on the exchange day');
eq(ymdInTimeZone(fnzStamp, 'Pacific/Auckland'), '2025-05-29', 'NZ dividend date uses the exchange day');
eq(ymdInTimeZone(Number.NaN, 'UTC'), null, 'a missing timestamp is not a date');

const chart = {
  chart: {
    result: [
      {
        meta: {
          currency: 'USD',
          symbol: 'AAPL',
          instrumentType: 'EQUITY',
          exchangeTimezoneName: 'America/New_York',
        },
        events: {
          dividends: {
            a: { amount: 0.26, date: aaplStamp },
            b: { amount: 0, date: aaplStamp + 86_400 },
            c: { amount: 0.27, date: 1770647400 },
          },
        },
      },
    ],
  },
};

const parsed = parseYahooDividendChart(chart, 'aapl');
assert(parsed, 'a matching equity chart parses');
if (!parsed) throw new Error('unreachable');
eq(parsed.currency, 'USD', 'currency comes from the chart');
eq(parsed.yahooSymbol, 'AAPL', 'symbol comes from the chart');
eq(parsed.payments.length, 2, 'a zero amount is not a dividend');
eq(parsed.payments[0]?.date, '2025-11-10', 'first published date');
eq(parsed.payments[0]?.amountPerShare, 0.26, 'first published amount is kept exactly');
eq(parsed.payments[1]?.amountPerShare, 0.27, 'later published amount is kept exactly');

const etf = parseYahooDividendChart({
  chart: {
    result: [{
      meta: { currency: 'USD', symbol: 'SPY', instrumentType: 'ETF', exchangeTimezoneName: 'America/New_York' },
      events: { dividends: { a: { amount: 1.889, date: 1758211200 } } },
    }],
  },
}, 'SPY');
assert(etf?.payments.length === 1, 'an ETF chart is a stock-or-ETF holding source');
eq(etf?.payments[0]?.amountPerShare, 1.889, 'ETF amount is not rounded');

const empty = parseYahooDividendChart({
  chart: {
    result: [{
      meta: { currency: 'USD', symbol: 'TSLA', instrumentType: 'EQUITY' },
    }],
  },
}, 'TSLA');
assert(empty?.payments.length === 0, 'a chart with no dividend events is an empty history');

assert(parseYahooDividendChart(chart, 'MSFT') == null, 'another symbol is not used');
assert(parseYahooDividendChart({
  chart: { result: [{ meta: { currency: 'USD', symbol: 'BTC-USD', instrumentType: 'CRYPTOCURRENCY' }, events: { dividends: { a: { amount: 1, date: aaplStamp } } } }] },
}, 'BTC-USD') == null, 'a non-equity chart is left out');
assert(parseYahooDividendChart({
  chart: { result: [{ meta: { symbol: 'AAPL', instrumentType: 'EQUITY' }, events: { dividends: { a: { amount: 0.2, date: aaplStamp } } } }] },
}, 'AAPL') == null, 'a missing currency is not assumed');
assert(parseYahooDividendChart({ chart: { error: { description: 'No data found' } } }, 'NOPE') == null, 'a failed chart is not an empty dividend');
assert(parseYahooDividendChart({
  chart: { result: [{ meta: { currency: 'USD', symbol: 'AAPL', instrumentType: 'EQUITY' }, events: { dividends: 'nope' } }] },
}, 'AAPL') == null, 'an unreadable dividend list is not treated as zero');

console.log('yahoo dividend parse tests passed');
