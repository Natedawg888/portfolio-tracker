/**
 * PAYE page view copy. Run: npm run test:paye-page
 */
import { annualise, toPeriods } from './payeCalc.ts';
import { INCOME_TAX_BRACKETS, PAY_TAX_YEARS, RATE_SOURCES, SCHEDULAR_ACTIVITIES, SCHEDULAR_SOURCES, payTaxYearRates } from './payeRates.ts';
import {
  PAYE_INCLUDED_SENTENCES,
  PAYE_NET_NZ_CREDIT,
  PAYE_NET_NZ_CREDIT_LEAD,
  PAYE_NET_NZ_NAME,
  PAYE_NET_NZ_URL,
  formatPayeTaxDay,
  incomeBracketRows,
  payeIncludedCopy,
  payePageSubtitle,
  payeSourceLinks,
  ratesInUseNote,
  salaryHourlySwitch,
  schedularActivityOptionLabel,
  schedularActivityShortName,
  type SalaryHourlyInput,
} from './payeView.ts';

function eq(actual: unknown, expected: unknown, msg: string): void {
  if (actual !== expected) {
    throw new Error(`FAIL: ${msg} (got ${String(actual)}, expected ${String(expected)})`);
  }
}

const rates = payTaxYearRates();
eq(rates.start, PAY_TAX_YEARS[rates.startYear].start, 'subtitle reads the tax year that is configured');
eq(
  payePageSubtitle(rates.start, rates.end),
  `NZ PAYE estimate · tax year ${rates.label} · IRD rates`,
  'subtitle is the tax-year label, composed from its start and end',
);
eq(
  payePageSubtitle('2027-04-01', '2028-03-31'),
  'NZ PAYE estimate · tax year 1 April 2027 – 31 March 2028 · IRD rates',
  'a later year is formatted from those dates',
);
eq(formatPayeTaxDay('2026-04-09'), '9 April 2026', 'day has no leading zero');
eq(formatPayeTaxDay('not-a-date'), 'not-a-date', 'unrecognised dates stay as given');
eq(formatPayeTaxDay('2026-13-01'), '2026-13-01', 'an impossible month stays as given');

eq(PAYE_INCLUDED_SENTENCES.length, 3, 'what is included is three sentences');
const included = payeIncludedCopy();
eq(included, PAYE_INCLUDED_SENTENCES.join(' '), 'the panel is those sentences in order');
if (!/income tax/i.test(included)) throw new Error('FAIL: included copy should say what is calculated');
if (!/annual progressive model/i.test(included)) throw new Error('FAIL: included copy should name the annual model');
if (!/weekly and fortnightly tables/i.test(included)) throw new Error('FAIL: included copy should mention weekly tables');
if (!/year end/i.test(included)) throw new Error('FAIL: included copy should say investing credits count at year end');
if (/\$\d/.test(included)) throw new Error('FAIL: included copy must not hard-code a dollar figure');
eq(PAYE_NET_NZ_URL, 'https://www.paye.net.nz/calculator/', 'paye.net.nz credit keeps its link');
eq(PAYE_NET_NZ_NAME, 'paye.net.nz', 'credit names paye.net.nz');
eq(PAYE_NET_NZ_CREDIT, `${PAYE_NET_NZ_CREDIT_LEAD} ${PAYE_NET_NZ_NAME}`, 'credit line is the lead plus the name');

const sample = incomeBracketRows([
  { upTo: 1000, rate: 0.1 },
  { upTo: 2500, rate: 0.175 },
  { upTo: Number.POSITIVE_INFINITY, rate: 0.39 },
]);
eq(sample[0].label, '$0 – $1,000', 'first band starts at $0');
eq(sample[0].rate, '10.0%', 'rate is one decimal');
eq(sample[1].label, '$1,001 – $2,500', 'next band starts the dollar after the previous cap');
eq(sample[2].label, 'Over $2,500', 'open top band');
eq(sample[2].rate, '39.0%', 'top rate from the bracket passed in');

const live = incomeBracketRows(INCOME_TAX_BRACKETS);
eq(live.length, INCOME_TAX_BRACKETS.length, 'one row per income-tax bracket in use');
eq(live[0].rate, `${(INCOME_TAX_BRACKETS[0].rate * 100).toFixed(1)}%`, 'first rate is the configured rate');
eq(live[0].label.startsWith('$0'), true, 'configured table still opens at $0');
eq(live[live.length - 1].label.startsWith('Over $'), true, 'configured table still has an open top band');
eq(
  live[live.length - 1].rate,
  `${(INCOME_TAX_BRACKETS[INCOME_TAX_BRACKETS.length - 1].rate * 100).toFixed(1)}%`,
  'top rate is the configured rate',
);

const links = payeSourceLinks(RATE_SOURCES, SCHEDULAR_SOURCES);
eq(links.length, RATE_SOURCES.length + SCHEDULAR_SOURCES.length, 'every rate and schedular source is kept');
eq(links[0].url, RATE_SOURCES[0].url, 'rate sources come first');
eq(links[links.length - 1].url, SCHEDULAR_SOURCES[SCHEDULAR_SOURCES.length - 1].url, 'schedular sources follow');

const note = ratesInUseNote(
  {
    accRate: 0.02,
    accMaxEarnings: 111,
    accMaxLevy: 222,
    accountDefaultEmployeeRate: 3.5,
    statutoryEmployeeRates: [3.5, 4],
    statutoryMinimumEmployeeRate: 3.5,
    statutoryFrom: '1 April 2030',
    minimumWageAdultHourly: 9,
    holidayPayPaygRate: 0.08,
  },
  (n) => `$${n}`,
);
if (!note.includes('ACC 2.00%')) throw new Error(`FAIL: ACC rate should be the figure passed in (${note})`);
if (!note.includes('$111')) throw new Error('FAIL: ACC cap should be formatted by money()');
if (!note.includes('$222')) throw new Error('FAIL: max levy should be formatted by money()');
if (!note.includes('from 1 April 2030')) throw new Error('FAIL: statutory date should be the one passed in');
if (!note.includes('3.5%, 4%')) throw new Error('FAIL: statutory KiwiSaver rates should be the ones passed in');
if (!note.includes('IRD minimum 3.5%')) throw new Error('FAIL: minimum employee rate should be the one passed in');
if (!note.includes('$9/h')) throw new Error('FAIL: minimum wage should be formatted by money()');
if (!note.includes('holiday pay with wages 8%')) throw new Error('FAIL: holiday pay percent comes from the rate passed in');
if (!note.includes("IRD's IR330C")) throw new Error('FAIL: schedular note should stay');
if (note.includes('1.75') || note.includes('156,641')) {
  throw new Error('FAIL: the note must not bake in the live ACC figures');
}

// $55,000 yearly at 40 hours → hourly (full precision, not cents) → back to 55000.
{
  const hours = 40;
  const hourly = salaryHourlySwitch('salary', 'hourly', {
    amount: '55000',
    frequency: 'year',
    hoursPerWeek: '40',
  });
  if (!hourly) throw new Error('FAIL: salary → hourly should convert');
  eq(hourly.frequency, 'hour', 'hourly pay is per hour');
  const expectedHourly = String(toPeriods(annualise(55000, 'year', hours), hours).hour);
  eq(hourly.amount, expectedHourly, 'hourly amount is annualise/toPeriods, not a rounded cent value');
  if (hourly.amount === (55000 / 52 / hours).toFixed(2)) {
    throw new Error('FAIL: hourly rate must not be rounded to cents');
  }
  const back = salaryHourlySwitch('hourly', 'salary', {
    amount: hourly.amount,
    frequency: 'hour',
    hoursPerWeek: '40',
  });
  if (!back) throw new Error('FAIL: hourly → salary should convert');
  eq(back.amount, '55000', 'round trip of 55000 at 40 hours returns 55000');
  eq(back.frequency, 'year', 'hourly converts back to a yearly salary');
}

// Switching to piece or contract does not read the salary amount.
{
  for (const to of ['piece', 'schedular'] as const) {
    let read = false;
    const fields: SalaryHourlyInput = {
      frequency: 'year',
      hoursPerWeek: '40',
      get amount() {
        read = true;
        return '55000';
      },
    };
    const switched = salaryHourlySwitch('salary', to, fields);
    eq(switched, null, `switching to ${to} does not convert the salary amount`);
    eq(read, false, `switching to ${to} does not read amount`);
  }
}

// Contract dropdown labels are the activity name plus that activity's own rate.
{
  for (const activity of SCHEDULAR_ACTIVITIES) {
    const pct = Math.round(activity.rate * 1000) / 10;
    const label = schedularActivityOptionLabel(activity);
    eq(label, `${schedularActivityShortName(activity.label)} · ${pct}%`, `option label is activity · ${pct}%`);
    eq(activity.label.startsWith(schedularActivityShortName(activity.label)), true, 'short name is taken from the activity label');
    if (activity.label.includes('(')) {
      eq(label.includes('('), false, 'the parenthetical detail stays off the short label');
    }
  }
  const shearing = SCHEDULAR_ACTIVITIES.find((a) => a.number === 23);
  if (!shearing) throw new Error('FAIL: activity 23 should be in SCHEDULAR_ACTIVITIES');
  eq(schedularActivityOptionLabel(shearing), 'Shearing or droving · 15%', 'a short activity keeps its name and rate');
}

console.log('payeView.test.ts ok');
