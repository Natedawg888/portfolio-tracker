/**
 * PAYE page view copy. Run: npm run test:paye-page
 */
import { annualise, calculatePaye, periodiseBreakdown, toPeriods, type PeriodAmounts } from './payeCalc.ts';
import {
  DONATION_TAX_CREDIT_RATE,
  IETC_ABATE_END,
  IETC_ABATE_RATE,
  IETC_FULL_ANNUAL,
  IETC_FULL_MAX_INCOME,
  IETC_MIN_INCOME,
  INCOME_TAX_BRACKETS,
  KIWISAVER_EMPLOYEE_RATES,
  PAYROLL_GIVING_CREDIT_RATE,
  PAY_TAX_YEARS,
  RATE_SOURCES,
  SCHEDULAR_ACTIVITIES,
  SCHEDULAR_SOURCES,
  STUDENT_LOAN_ANNUAL_THRESHOLD,
  STUDENT_LOAN_RATE,
  payTaxYearRates,
} from './payeRates.ts';
import {
  INVESTING_CREDITS_TIP,
  KIWISAVER_CUSTOM_RATE_VALUE,
  PAYE_INCLUDED_SENTENCES,
  RESULT_PERIOD_OPTIONS,
  compactBreakdown,
  compactMarker,
  detailBreakdownRows,
  figuresForPeriod,
  grossTakeHomeSplit,
  resultPeriodSuffix,
  splitSummary,
  PAYE_NET_NZ_CREDIT,
  PAYE_NET_NZ_CREDIT_LEAD,
  PAYE_NET_NZ_NAME,
  PAYE_NET_NZ_URL,
  SALARY_SACRIFICE_TIP,
  centsPerDollar,
  charityDonationTip,
  formatPayeTaxDay,
  ietcCreditTip,
  incomeBracketRows,
  kiwiSaverEmployeeRateOptions,
  kiwiSaverEmployerTip,
  kiwiSaverOptInTip,
  kiwiSaverRateSelection,
  payeIncludedCopy,
  payePageSubtitle,
  payeSourceLinks,
  payrollGivingTip,
  ratesInUseNote,
  salaryHourlySwitch,
  schedularActivityOptionLabel,
  schedularActivityShortName,
  studentLoanTip,
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

{
  const reducedNote = ratesInUseNote(
    {
      accRate: 0.02, accMaxEarnings: 111, accMaxLevy: 222, accountDefaultEmployeeRate: 3.5,
      statutoryEmployeeRates: [3, 3.5, 4], statutoryMinimumEmployeeRate: 3.5, temporaryReductionRate: 3,
      statutoryFrom: '1 April 2030', minimumWageAdultHourly: 9, holidayPayPaygRate: 0.08,
    },
    (n) => `$${n}`,
  );
  if (!reducedNote.includes('3% (temporary rate reduction only), 3.5%, 4%')) throw new Error(`FAIL: the reduced rate is marked in the note (${reducedNote})`);
  if (!reducedNote.includes('IRD minimum 3.5%')) throw new Error('FAIL: the minimum stays 3.5% with a reduced rate listed');
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

// KiwiSaver radios are the rates passed in, plus nothing else.
{
  const options = kiwiSaverEmployeeRateOptions([3.5, 4, 10]);
  eq(options.length, 3, 'one option per rate passed in');
  eq(options[0].value, '3.5', 'option value is the rate');
  eq(options[0].label, '3.5%', 'option label is that rate with a percent sign');
  eq(options.map((o) => o.value).join(','), '3.5,4,10', 'order follows the rates passed in');
  eq(options.some((o) => o.value === KIWISAVER_CUSTOM_RATE_VALUE), false, 'custom is not invented as a statutory rate');
  const live = kiwiSaverEmployeeRateOptions(KIWISAVER_EMPLOYEE_RATES);
  eq(live.length, KIWISAVER_EMPLOYEE_RATES.length, 'the page radios match the statutory list');
  eq(live[0].value, String(KIWISAVER_EMPLOYEE_RATES[0]), 'the first radio is the first statutory rate');
  const reduced = kiwiSaverEmployeeRateOptions([3, 3.5, 4], 3);
  eq(reduced[0].label, '3% (temporary rate reduction)', 'the temporary-reduction rate says so');
  eq(reduced[1].label, '3.5%', 'other rates keep the plain label');
  eq(reduced.length, 3, 'the label adds no rate');
}

{
  const choices = [3.5, 4, 6, 8, 10];
  const picked = kiwiSaverRateSelection('4', choices);
  eq(picked.custom, false, 'a statutory rate is not custom');
  eq(picked.value, '4', 'the radio value is that rate');
  const half = kiwiSaverRateSelection('3.50', choices);
  eq(half.custom, false, '3.50 matches the 3.5 choice');
  eq(half.value, '3.5', 'the radio value is the choice, not the raw string');
  const custom = kiwiSaverRateSelection('5', choices);
  eq(custom.custom, true, 'a percent outside the list is custom');
  eq(custom.value, KIWISAVER_CUSTOM_RATE_VALUE, 'custom uses the shared radio value');
  const blank = kiwiSaverRateSelection('  ', choices);
  eq(blank.custom, true, 'a blank rate is custom');
}

eq(centsPerDollar(0.13), '13c', '13% of a dollar is 13c');
eq(centsPerDollar(0.175), '17.5c', 'a half cent is kept');
eq(centsPerDollar(1 / 3), '33.33c', 'one third is 33.33c');

{
  const tip = kiwiSaverOptInTip(9);
  if (!tip.includes('9%')) throw new Error('FAIL: opt-in tip should use the starting rate passed in');
  if (tip.includes('3.5')) throw new Error('FAIL: opt-in tip must not bake in the live starting rate');
  const matched = kiwiSaverEmployerTip({ minimumRate: 2, statutoryFrom: '1 April 2030', temporaryReductionRate: 1.5 });
  if (!matched.includes('match at 1.5%')) throw new Error('FAIL: employer tip should say the employer may match the reduced rate');
  const employer = kiwiSaverEmployerTip({ minimumRate: 2, statutoryFrom: '1 April 2030' });
  if (employer.includes('temporary')) throw new Error('FAIL: no temporary-reduction sentence without a reduced rate');
  if (!employer.includes('2%')) throw new Error('FAIL: employer tip should use the minimum passed in');
  if (!employer.includes('1 April 2030')) throw new Error('FAIL: employer tip should use the date passed in');
  if (employer.includes('3.5')) throw new Error('FAIL: employer tip must not bake in the live minimum');
  if (/\$\d/.test(SALARY_SACRIFICE_TIP)) throw new Error('FAIL: salary sacrifice tip must not hard-code a dollar figure');
  if (!/package/i.test(SALARY_SACRIFICE_TIP)) throw new Error('FAIL: salary sacrifice tip should say the amount is the package');
}

{
  const loan = studentLoanTip({ rate: 0.05, annualThreshold: 1000 }, (n) => `$${n}`);
  if (!loan.includes('5%')) throw new Error(`FAIL: student loan tip should use the rate passed in (${loan})`);
  if (!loan.includes('$1000')) throw new Error('FAIL: student loan tip should use the threshold passed in');
  if (loan.includes('12%') || loan.includes('24,128')) {
    throw new Error('FAIL: student loan tip must not bake in the live loan figures');
  }
  const live = studentLoanTip(
    { rate: STUDENT_LOAN_RATE, annualThreshold: STUDENT_LOAN_ANNUAL_THRESHOLD },
    (n) => `$${n.toLocaleString('en-NZ')}`,
  );
  if (!live.includes(`${Math.round(STUDENT_LOAN_RATE * 1000) / 10}%`)) {
    throw new Error('FAIL: live student loan tip should use the configured rate');
  }
  if (!live.includes(`$${STUDENT_LOAN_ANNUAL_THRESHOLD.toLocaleString('en-NZ')}`)) {
    throw new Error('FAIL: live student loan tip should use the configured threshold');
  }
}

{
  const giving = payrollGivingTip(0.25);
  eq(giving.includes('25c'), true, 'payroll giving tip uses the credit rate passed in');
  if (giving.includes('33.33')) throw new Error('FAIL: payroll giving tip must not bake in the live credit rate');
  const live = payrollGivingTip(PAYROLL_GIVING_CREDIT_RATE);
  eq(live.includes(centsPerDollar(PAYROLL_GIVING_CREDIT_RATE)), true, 'live payroll giving tip uses the configured rate');
  const charity = charityDonationTip(0.1);
  eq(charity.includes('10c'), true, 'charity tip uses the credit rate passed in');
  if (charity.includes('33.33')) throw new Error('FAIL: charity tip must not bake in the live credit rate');
  eq(
    charityDonationTip(DONATION_TAX_CREDIT_RATE).includes(centsPerDollar(DONATION_TAX_CREDIT_RATE)),
    true,
    'live charity tip uses the configured donation rate',
  );
}

// IETC abates between the full-credit cap and the end income. The old "$69,999" ceiling is not used.
{
  const tip = ietcCreditTip(
    { minIncome: 10, fullMaxIncome: 20, abateEnd: 30, fullAnnual: 4, abateRate: 0.5 },
    (n) => `$${n}`,
  );
  if (!tip.includes('Abates from $20 to $30 at 50c per dollar above $20')) {
    throw new Error(`FAIL: IETC tip should describe abatement from the figures passed in (${tip})`);
  }
  if (!tip.includes('Full credit $4 a year from $10 to $20')) {
    throw new Error('FAIL: IETC tip should describe the full-credit band from the figures passed in');
  }
  if (!tip.includes('Nothing from $30')) throw new Error('FAIL: IETC tip should say the credit ends at the abate end');
  if (tip.includes('69,999') || tip.includes('66,000') || tip.includes('13c')) {
    throw new Error('FAIL: IETC tip must not bake in the live thresholds');
  }
  const live = ietcCreditTip(
    {
      minIncome: IETC_MIN_INCOME,
      fullMaxIncome: IETC_FULL_MAX_INCOME,
      abateEnd: IETC_ABATE_END,
      fullAnnual: IETC_FULL_ANNUAL,
      abateRate: IETC_ABATE_RATE,
    },
    (n) => `$${n.toLocaleString('en-NZ')}`,
  );
  const fullTo = `$${IETC_FULL_MAX_INCOME.toLocaleString('en-NZ')}`;
  const end = `$${IETC_ABATE_END.toLocaleString('en-NZ')}`;
  if (!live.includes(`Abates from ${fullTo} to ${end} at ${centsPerDollar(IETC_ABATE_RATE)} per dollar above ${fullTo}`)) {
    throw new Error(`FAIL: live IETC tip should abate between the configured incomes (${live})`);
  }
  if (live.includes('69,999')) throw new Error('FAIL: IETC tip must not describe a $69,999 ceiling');
}

if (/\$\d/.test(INVESTING_CREDITS_TIP)) throw new Error('FAIL: investing credits tip must not hard-code a dollar figure');
if (!/annual assessment/i.test(INVESTING_CREDITS_TIP)) {
  throw new Error('FAIL: investing credits tip should say they count on the annual assessment');
}
if (!/not invented/i.test(INVESTING_CREDITS_TIP)) throw new Error('FAIL: investing credits tip should say amounts are not invented');

// Result panel: display slices of payeCalc output. No second tax formula.
{
  eq(RESULT_PERIOD_OPTIONS.map((o) => o.value).join(','), 'year,month,fortnight,week', 'result periods are year, month, fortnight, week');
  eq(RESULT_PERIOD_OPTIONS.map((o) => o.label).join(','), 'Year,Month,Fortnight,Week', 'period labels are the visible radio labels');
  eq(RESULT_PERIOD_OPTIONS.some((o) => (o.value as string) === 'hour'), false, 'hour is not a result-panel period');
  eq(resultPeriodSuffix('year'), '/ year', 'year suffix');
  eq(resultPeriodSuffix('month'), '/ month', 'month suffix');
  eq(resultPeriodSuffix('fortnight'), '/ fortnight', 'fortnight suffix');
  eq(resultPeriodSuffix('week'), '/ week', 'week suffix');
}

function slice(year: number, month: number, fortnight: number, week: number, hour: number): PeriodAmounts {
  return { year, month, fortnight, week, hour };
}

{
  const periods = {
    gross: slice(1000, 100, 50, 20, 1),
    takeHome: slice(800, 80, 40, 16, 0.4),
    incomeTax: slice(100, 9, 8, 7, 0.2),
    acc: slice(40, 4, 3, 2, 0.1),
    kiwiSaver: slice(30, 3, 2, 1, 0.05),
    studentLoan: slice(0, 0, 0, 0, 0),
  };
  const credits = { ietcCredit: 5, charityCredit: 1, extraCreditsTotal: 1, payrollGivingCredit: 1 };
  const year = figuresForPeriod(periods, credits, 'year', 40);
  eq(year.gross, 1000, 'gross is the period slice, not a new annualisation');
  eq(year.incomeTax, 100, 'income tax is the period slice');
  eq(year.acc, 40, 'ACC is the period slice');
  eq(year.kiwiSaver, 30, 'KiwiSaver is the employee period slice');
  eq(year.studentLoan, 0, 'a zero student loan slice stays zero');
  eq(year.credits, 8, 'credits are the sum of the credit fields passed in');
  const week = figuresForPeriod(periods, credits, 'week', 40);
  eq(week.incomeTax, 7, 'week income tax is the week slice, not year divided here');
  eq(week.credits, toPeriods(8, 40).week, 'week credits use toPeriods on the credit sum');
  const otherHours = figuresForPeriod(periods, credits, 'week', 10);
  eq(otherHours.incomeTax, week.incomeTax, 'week tax does not scale with hours');
  eq(otherHours.credits, week.credits, 'week credits do not scale with hours');
  eq(figuresForPeriod(periods, credits, 'fortnight', 40).acc, 3, 'fortnight reads the fortnight slice');
  eq(figuresForPeriod(periods, credits, 'month', 40).takeHome, 80, 'month reads the month slice');

  const lines = compactBreakdown(year);
  eq(lines.map((l) => l.key).join(','), 'incomeTax,acc,kiwiSaver,credits', 'zero student loan is left off the compact list');
  eq(lines.map((l) => l.label).join(','), 'Income tax,ACC,KiwiSaver,Credits', 'compact labels');
  eq(lines[0].sign, 'minus', 'income tax is a deduction');
  eq(lines[3].sign, 'plus', 'credits are a plus');
  eq(lines[3].amount, 8, 'the credits line is the credit sum');
  eq(compactMarker('minus'), '(\u2212)', 'a deduction is marked with a minus, not colour alone');
  eq(compactMarker('plus'), '(+)', 'a credit is marked with a plus');

  const full = compactBreakdown({ incomeTax: 1, acc: 2, kiwiSaver: 3, studentLoan: 4, credits: 5 });
  eq(full.map((l) => l.key).join(','), 'incomeTax,acc,kiwiSaver,studentLoan,credits', 'compact order is fixed');
  eq(full.map((l) => `${l.label}:${l.sign}`).join('|'), 'Income tax:minus|ACC:minus|KiwiSaver:minus|Student loan:minus|Credits:plus', 'signs follow the line, not a rate');
  eq(compactBreakdown({ incomeTax: 0, acc: 0, kiwiSaver: 0, studentLoan: 0, credits: 0 }).length, 0, 'zeros are omitted');
  eq(
    compactBreakdown({ incomeTax: Number.NaN, acc: -1, kiwiSaver: 0, studentLoan: Number.POSITIVE_INFINITY, credits: 2 }).map((l) => l.key).join(','),
    'credits',
    'non-finite and negative amounts are omitted',
  );
}

{
  const even = grossTakeHomeSplit(80, 50);
  eq(even.parts.map((p) => p.key).join(','), 'takeHome,deductions', 'take-home below gross splits into those two parts');
  eq(even.parts[0].label, 'Take-home', 'take-home part is labelled');
  eq(even.parts[0].amount, 50, 'take-home part is the take-home passed in');
  eq(even.parts[1].label, 'Deductions', 'the remainder is labelled deductions');
  eq(even.parts[1].amount, 30, 'deductions are gross minus take-home');
  const share = even.parts[0].share + even.parts[1].share;
  if (Math.abs(share - 1) > 1e-9) throw new Error(`FAIL: split shares should sum to 1 (got ${share})`);
  const allHome = grossTakeHomeSplit(40, 40);
  eq(allHome.parts.length, 1, 'no deductions when take-home equals gross');
  eq(allHome.parts[0].key, 'takeHome', 'the whole bar is take-home');
  eq(allHome.parts[0].share, 1, 'take-home share is the whole bar');
  const none = grossTakeHomeSplit(40, 0);
  eq(none.parts.length, 1, 'zero take-home is only deductions');
  eq(none.parts[0].key, 'deductions', 'zero take-home part');
  eq(none.parts[0].amount, 40, 'deductions are the gross');
  const refund = grossTakeHomeSplit(10, 15);
  eq(refund.parts.map((p) => p.key).join(','), 'gross,refund', 'take-home above gross is gross plus a refund');
  eq(refund.parts[0].amount, 10, 'refund split keeps the gross passed in');
  eq(refund.parts[1].amount, 5, 'refund is take-home minus gross');
  eq(refund.parts[1].label, 'Refund', 'refund part is labelled');
  const negative = grossTakeHomeSplit(10, -2);
  eq(negative.parts.length, 1, 'negative take-home is one deductions part');
  eq(negative.parts[0].amount, 12, 'deductions cover gross and the shortfall');
  eq(negative.parts[0].share, 1, 'the bar is entirely deductions');
  eq(grossTakeHomeSplit(0, 0).parts.length, 0, 'nothing to split');
  eq(grossTakeHomeSplit(Number.NaN, Number.NaN).parts.length, 0, 'non-finite amounts are not a split');
  const onlyRefund = grossTakeHomeSplit(0, 5);
  eq(onlyRefund.parts[0].key, 'refund', 'take-home with no gross is a refund');
  eq(onlyRefund.parts[0].amount, 5, 'refund amount is the take-home passed in');
  const text = splitSummary(even, (n) => `$${n}`);
  eq(text, 'Gross $80, take-home $50. Take-home $50, Deductions $30.', 'summary uses the formatter on the split amounts');
  eq(splitSummary(grossTakeHomeSplit(0, 0), (n) => `$${n}`), 'No pay to split.', 'empty split has no amounts');
  if (text.includes('8720') || text.includes('1.75')) throw new Error('FAIL: split summary must not bake in a tax figure');
}

{
  const blank = slice(0, 0, 0, 0, 0);
  const periods = {
    gross: slice(9, 8, 7, 6, 5),
    incomeTax: slice(1, 1, 1, 1, 1),
    acc: blank,
    paye: blank,
    ietc: slice(2, 2, 2, 2, 2),
    charityCredit: blank,
    extraCredits: blank,
    kiwiSaver: blank,
    employerKs: slice(4, 4, 4, 4, 4),
    studentLoan: blank,
    payrollGiving: blank,
    takeHome: blank,
  };
  const base = {
    ietcCredit: 0,
    charityCredit: 0,
    extraCreditsTotal: 0,
    kiwiSaverEmployee: 0,
    studentLoan: 0,
    payrollGivingDonation: 0,
  };
  const rows = detailBreakdownRows(base, periods, false);
  eq(rows.map((r) => r.label).join('|'), 'Gross pay|Income tax|ACC earners\u2019 levy|PAYE (tax + ACC \u2212 credits)|Take-home pay', 'empty credits and KiwiSaver stay off the detail table');
  eq(rows[0].amounts, periods.gross, 'detail amounts are the period objects passed in');
  eq(rows[1].amounts, periods.incomeTax, 'income tax row is that slice');
  eq(rows[1].deduct, true, 'income tax is marked as a deduction');
  eq(rows[0].deduct, false, 'gross is not a deduction');
  const withKs = detailBreakdownRows(base, periods, true);
  eq(withKs.some((r) => r.label === 'KiwiSaver (employee)'), true, 'opt-in shows employee KiwiSaver even at zero');
  eq(withKs.some((r) => r.label === 'KiwiSaver (employer)' && r.deduct === false), true, 'employer KiwiSaver is reference, not a deduction');
  eq(withKs.find((r) => r.label === 'KiwiSaver (employer)')?.amounts, periods.employerKs, 'employer row is the employer slice');
  const withCredits = detailBreakdownRows(
    { ...base, ietcCredit: 2, charityCredit: 3, extraCreditsTotal: 4, studentLoan: 5, payrollGivingDonation: 6 },
    periods,
    false,
  );
  eq(
    withCredits.map((r) => r.label).join('|'),
    'Gross pay|Income tax|ACC earners\u2019 levy|PAYE (tax + ACC \u2212 credits)|IETC credit|Donation tax credit|Investing credits|Student loan|Payroll giving|Take-home pay',
    'detail rows follow the amounts that are present',
  );
}

// The $55,000 case: the panel reads calculatePaye. The lock lives in payeCalc.test.ts too.
{
  const base = {
    amount: 55000,
    frequency: 'year' as const,
    hoursPerWeek: 40,
    employment: 'primary' as const,
    secondaryTotalAnnualIncome: 0,
    otherAnnualGross: 0,
    kiwiSaverOptIn: true,
    kiwiSaverEmployeeRatePct: 3.5,
    kiwiSaverEmployerRatePct: 3.5,
    salarySacrifice: false,
    ietc: true,
    payrollGivingAnnual: 0,
  };
  const result = calculatePaye({ ...base, studentLoan: false });
  const periods = periodiseBreakdown(result, 40);
  const year = figuresForPeriod(periods, result, 'year', 40);
  eq(year.takeHome, result.takeHome, 'panel take-home is the engine take-home');
  eq(year.incomeTax, result.incomeTax, 'panel income tax is the engine income tax');
  eq(year.acc, result.acc, 'panel ACC is the engine ACC');
  eq(year.kiwiSaver, result.kiwiSaverEmployee, 'panel KiwiSaver is the employee amount');
  eq(year.credits, result.ietcCredit, 'panel credits are the IETC on this case');
  eq(year.gross, result.annualGross, 'panel gross is the engine gross');
  eq(year.takeHome, 43912, 'locked take-home at $55,000');
  eq(year.incomeTax, 8720.5, 'locked income tax at $55,000');
  eq(year.acc, 962.5, 'locked ACC at $55,000');
  eq(year.credits, 520, 'locked IETC at $55,000');
  eq(year.kiwiSaver, 1925, 'locked employee KiwiSaver at $55,000');
  eq(result.kiwiSaverEmployer, 1925, 'locked employer KiwiSaver at $55,000');
  eq(result.taxCode, 'ME', 'locked tax code ME');
  eq(figuresForPeriod(periods, result, 'week', 40).takeHome, periods.takeHome.week, 'week take-home is the engine week slice');
  eq(figuresForPeriod(periods, result, 'month', 40).incomeTax, periods.incomeTax.month, 'month income tax is the engine month slice');
  eq(figuresForPeriod(periods, result, 'fortnight', 40).acc, periods.acc.fortnight, 'fortnight ACC is the engine fortnight slice');
  const lines = compactBreakdown(year);
  eq(lines.map((l) => l.key).join(','), 'incomeTax,acc,kiwiSaver,credits', '$55,000 compact list has no student loan');
  eq(lines.find((l) => l.key === 'kiwiSaver')?.amount, 1925, 'compact KiwiSaver is the locked employee amount');
  const split = grossTakeHomeSplit(year.gross, year.takeHome);
  eq(split.parts[0].amount, 43912, 'split take-home is the locked take-home');
  eq(split.parts[1].amount, result.annualGross - result.takeHome, 'split deductions are gross minus take-home');
  eq(split.parts[1].amount, 11088, 'locked gap from gross to take-home at $55,000');
  const detail = detailBreakdownRows(result, periods, true);
  eq(
    detail.map((r) => r.label).join('|'),
    'Gross pay|Income tax|ACC earners\u2019 levy|PAYE (tax + ACC \u2212 credits)|IETC credit|KiwiSaver (employee)|KiwiSaver (employer)|Take-home pay',
    '$55,000 detail rows',
  );
  eq(detail.find((r) => r.label === 'Income tax')?.amounts.year, 8720.5, 'detail income tax year is the locked figure');
  eq(detail.find((r) => r.label === 'KiwiSaver (employer)')?.amounts.year, 1925, 'detail employer KiwiSaver year is the locked figure');
  eq(detail.find((r) => r.label === 'Take-home pay')?.amounts, periods.takeHome, 'detail take-home is the engine period object');
  eq(detailBreakdownRows(result, periods, false).some((r) => r.label === 'KiwiSaver (employer)'), false, 'employer row follows the opt-in flag');
  const on = calculatePaye({ ...base, studentLoan: true });
  eq(on.taxCode, 'ME SL', 'locked tax code ME SL');
  const onYear = figuresForPeriod(periodiseBreakdown(on, 40), on, 'year', 40);
  const loan = compactBreakdown(onYear).find((l) => l.key === 'studentLoan');
  if (!loan) throw new Error('FAIL: student loan on should be a compact line');
  eq(loan.amount, on.studentLoan, 'student loan line is the engine student loan');
  eq(loan.sign, 'minus', 'student loan is a deduction');
  if (!(on.studentLoan > 0)) throw new Error('FAIL: the $55,000 student-loan case should deduct a loan');
}

console.log('payeView.test.ts ok');
