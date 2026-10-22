/**
 * Calendar data sources: Finnhub earnings (US-listed only, NZ dates from the session, nothing
 * filled in, key in a header, failures reported) and Nager.Date holidays (national only).
 * Run: node --import tsx server/calendar/calendarSources.test.ts
 */
import { clearEarningsCache, earningsFor, isUsListed, nzDateFor, parseFinnhub, type FinnhubFetch } from './earnings.ts';
import { clearHolidayCache, holidaysBetween, parseNager, type HolidayFetch } from './holidays.ts';

function assert(cond: unknown, msg: string): void {
  if (!cond) throw new Error(`FAIL: ${msg}`);
}

// Which holdings Finnhub's free calendar covers.
assert(isUsListed('AAPL', 'NASDAQ') && isUsListed('KO', 'NYSE') && isUsListed('AAPL', null), 'US exchanges and plain tickers are covered');
assert(!isUsListed('FPH', 'NZX') && !isUsListed('FPH.NZ', null) && !isUsListed('CBA.AX', ''), 'NZX, ASX and suffixed tickers are not');

// NZ date from the US session.
assert(JSON.stringify(nzDateFor('2026-11-02', 'amc')) === JSON.stringify({ nzDate: '2026-11-03', nzDateKnown: true }), 'after the US close is the next NZ day');
assert(JSON.stringify(nzDateFor('2026-11-02', 'dmh')) === JSON.stringify({ nzDate: '2026-11-03', nzDateKnown: true }), 'during US market hours is the next NZ day');
assert(JSON.stringify(nzDateFor('2026-11-02', 'bmo')) === JSON.stringify({ nzDate: '2026-11-02', nzDateKnown: false }), 'before the open is not known in NZ');
assert(nzDateFor('2026-12-31', 'amc').nzDate === '2027-01-01', 'the next day crosses a year');
assert(!nzDateFor('2026-11-02', null).nzDateKnown, 'no session: not known');

// Parsing: only what Finnhub lists, malformed rows dropped, duplicates once.
const body = {
  earningsCalendar: [
    { symbol: 'AAPL', date: '2027-01-27', hour: '', quarter: 1, year: 2027, epsEstimate: 2.9 },
    { symbol: 'AAPL', date: '2026-11-02', hour: 'amc', quarter: 4, year: 2026 },
    { symbol: 'AAPL', date: '2026-11-02', hour: 'amc', quarter: 4, year: 2026 },
    { symbol: 'MSFT', date: '2026-10-28', hour: 'amc' },
    { symbol: 'AAPL', date: 'soon', hour: 'amc' },
    null,
  ],
};
const parsed = parseFinnhub('aapl', body);
assert(parsed.length === 2, `two AAPL dates (got ${parsed.length})`);
assert(parsed[0].nzDate === '2026-11-03' && parsed[0].session === 'amc' && parsed[0].quarter === 4, 'sorted by NZ date, with session and quarter');
assert(parsed[1].session === null && !parsed[1].nzDateKnown, 'a blank hour is no session');
assert(parseFinnhub('AAPL', { nope: 1 }).length === 0 && parseFinnhub('AAPL', null).length === 0, 'an unexpected body gives nothing');

// earningsFor: key, coverage, range, cache, failures.
const calls: { url: string; headers: Record<string, string> }[] = [];
const ok: FinnhubFetch = async (url, init) => {
  calls.push({ url, headers: init.headers });
  const symbol = new URL(url).searchParams.get('symbol');
  return { ok: true, status: 200, json: async () => (symbol === 'AAPL' ? body : { earningsCalendar: [] }) };
};
const holdings = [
  { symbol: 'AAPL', exchange: 'NASDAQ' },
  { symbol: 'aapl', exchange: 'NASDAQ' },
  { symbol: 'FPH', exchange: 'NZX' },
  { symbol: 'NVDA', exchange: null },
];

const none = await earningsFor(holdings, '2026-11-01', '2026-11-30', '2026-10-23', { key: '' });
assert(none.status === 'not_configured' && none.events.length === 0 && none.uncovered.join() === 'FPH', 'no key: not configured, nothing invented');

clearEarningsCache();
const nov = await earningsFor(holdings, '2026-11-01', '2026-11-30', '2026-10-23', { key: 'k', fetcher: ok, nowMs: 1 });
assert(nov.status === 'ok' && nov.events.map((e) => `${e.symbol}@${e.nzDate}`).join() === 'AAPL@2026-11-03', 'November holds the AAPL report on its NZ date');
assert(nov.uncovered.join() === 'FPH' && nov.failed.length === 0, 'NZX listed as not covered');
assert(calls.length === 2 && calls.every((c) => c.headers['X-Finnhub-Token'] === 'k' && !c.url.includes('token')), 'one call per US symbol, key in a header not the URL');
await earningsFor(holdings, '2027-01-01', '2027-01-31', '2026-10-23', { key: 'k', fetcher: ok, nowMs: 2 });
assert(calls.length === 2, 'a second month comes from the cache');

clearEarningsCache();
const flaky: FinnhubFetch = async (url) => {
  if (new URL(url).searchParams.get('symbol') === 'NVDA') throw new Error('timeout');
  return ok(url, { headers: {}, signal: new AbortController().signal });
};
const partial = await earningsFor(holdings, '2026-11-01', '2026-11-30', '2026-10-23', { key: 'k', fetcher: flaky, nowMs: 3 });
assert(partial.status === 'ok' && partial.failed.join() === 'NVDA' && partial.events.length === 1, 'one failed symbol is reported; the others still show');

clearEarningsCache();
const down: FinnhubFetch = async () => ({ ok: false, status: 429, json: async () => ({}) });
const allDown = await earningsFor(holdings, '2026-11-01', '2026-11-30', '2026-10-23', { key: 'k', fetcher: down, nowMs: 4 });
assert(allDown.status === 'unavailable' && allDown.events.length === 0 && allDown.failed.length === 2, 'all lookups failing is unavailable, with no dates');

// Holidays: national only, observed dates kept, joint days named once.
const nager = [
  { date: '2026-01-26', name: 'Auckland/Northland Anniversary Day', global: false, counties: ['NZ-AUK'] },
  { date: '2026-04-27', localName: 'Anzac Day', name: 'Anzac Day', global: true },
  { date: '2026-07-10', localName: 'Matariki', name: 'Matariki', global: true },
  { date: '2026-12-25', name: 'Christmas Day', global: true },
  { date: 'bad', name: 'x', global: true },
];
const hols = parseNager(nager);
assert(hols.map((h) => h.date).join() === '2026-04-27,2026-07-10,2026-12-25', 'national holidays only, malformed dropped');
assert(parseNager({}).length === 0, 'an unexpected body gives nothing');

clearHolidayCache();
const urls: string[] = [];
const hf: HolidayFetch = async (url) => {
  urls.push(url);
  return { ok: true, status: 200, json: async () => (url.includes('/2026/') ? nager : [{ date: '2027-01-01', name: "New Year's Day", global: true }]) };
};
const span = await holidaysBetween('2026-12-01', '2027-01-31', { fetcher: hf, nowMs: 1 });
assert(span.available && span.holidays.map((h) => h.name).join('|') === "Christmas Day|New Year's Day", 'a range across years asks for both years');
assert(urls.length === 2 && urls.every((u) => u.startsWith('https://date.nager.at/api/v3/PublicHolidays/') && u.endsWith('/NZ')), 'Nager NZ endpoint');
clearHolidayCache();
const failed = await holidaysBetween('2026-12-01', '2026-12-31', { fetcher: async () => ({ ok: false, status: 503, json: async () => [] }), nowMs: 1 });
assert(!failed.available && failed.holidays.length === 0, 'a failed fetch shows no holidays and says so');

console.log('calendar sources: ok');
