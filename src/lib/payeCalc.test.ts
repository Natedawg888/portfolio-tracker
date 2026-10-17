/**
 * PAYE engine locks. Run: npm run test:paye
 * Figures come from calculatePaye / calcIetc / calcAcc. This file does not
 * change the engine; if a locked number moves, the test fails with both values.
 */
import { calcAcc, calcIetc, calcIncomeTax, calculatePaye, pickSecondaryCode } from './payeCalc.ts';
import { defaultPayePrefs } from './payePrefs.ts';
import { PAY_TAX_YEAR_OPTIONS, payTaxYearRates, taxYearForDate } from './payeRates.ts';

function eq(actual: unknown, expected: unknown, msg: string): void {
  if (actual !== expected) {
    throw new Error(`FAIL: ${msg} (got ${String(actual)}, expected ${String(expected)})`);
  }
}

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

const off = calculatePaye({ ...base, studentLoan: false });
eq(off.takeHome, 43912, 'take-home at $55,000');
eq(off.incomeTax, 8720.5, 'income tax at $55,000');
eq(off.acc, 962.5, 'ACC at $55,000');
eq(off.ietcCredit, 520, 'IETC at $55,000');
eq(off.kiwiSaverEmployee, 1925, 'employee KiwiSaver 3.5%');
eq(off.taxCode, 'ME', 'tax code ME');
eq(off.kiwiSaverEmployer, 1925, 'employer KiwiSaver 3.5%');

const on = calculatePaye({ ...base, studentLoan: true });
eq(on.taxCode, 'ME SL', 'student loan on uses tax code ME SL');

eq(calcIetc(68000), 260, 'IETC abates to 260 at $68,000');
eq(calcIetc(70000), 0, 'IETC is 0 at $70,000');

const aboveBand = calculatePaye({ ...base, amount: 80000, studentLoan: false });
const ietcNote = aboveBand.notes.find((n) => n.startsWith('IETC not applied'));
if (!ietcNote) throw new Error('FAIL: income past the IETC end should say why it was not applied');
if (!/abates/i.test(ietcNote)) throw new Error(`FAIL: IETC note should describe the abatement (${ietcNote})`);
if (ietcNote.includes('69,999')) throw new Error('FAIL: IETC note must not use a $69,999 ceiling');
if (off.notes.some((n) => n.includes('69,999'))) throw new Error('FAIL: the $55,000 case must not mention a $69,999 ceiling');
eq(calcAcc(200000), 2741.22, 'ACC at $200,000 is the published maximum levy');
eq(defaultPayePrefs().amount, '75000', 'default salary stays 75000');

// Tax years (KAN-79): 2025/26 uses that year's published ACC and KiwiSaver minimum; brackets are the same.
const y25 = calculatePaye({ ...base, taxYear: 2025, kiwiSaverEmployeeRatePct: 3, kiwiSaverEmployerRatePct: 0, studentLoan: false });
eq(y25.incomeTax, 8720.5, '2025/26 income tax at $55,000');
eq(y25.acc, 918.5, '2025/26 ACC at 1.67%');
eq(y25.kiwiSaverEmployee, 1650, '2025/26 employee KiwiSaver 3%');
eq(y25.kiwiSaverEmployer, 1650, '2025/26 employer minimum 3%');
eq(y25.takeHome, 44231, '2025/26 take-home at $55,000');
eq(calcAcc(200000, payTaxYearRates(2025)), 2551.59, '2025/26 maximum ACC levy');
// Temporary rate reduction (KAN-88): 3% employee from 1 April 2026; the employer may match at 3% only then.
{
  const r26 = payTaxYearRates(2026);
  eq(r26.kiwiSaverEmployeeRates.includes(3), true, '2026/27 offers 3%');
  eq(r26.kiwiSaverDefaultEmployeeRate, 3.5, '2026/27 default stays 3.5%');
  eq(payTaxYearRates(2025).kiwiSaverEmployeeRates.join(), '3,4,6,8,10', '2025/26 rates unchanged');
  eq(payTaxYearRates(2025).kiwiSaverTemporaryReductionRate, null, '2025/26 has no temporary reduction');
  const matched = calculatePaye({ ...base, kiwiSaverEmployeeRatePct: 3, kiwiSaverEmployerRatePct: 3, studentLoan: false });
  eq(matched.kiwiSaverEmployee, 1650, 'employee 3% of $55,000');
  eq(matched.kiwiSaverEmployer, 1650, 'employer may match at 3%');
  eq(matched.notes.some((n) => n.includes('raised')), false, 'a 3% match is not raised');
  eq(calculatePaye({ ...base, kiwiSaverEmployeeRatePct: 3, studentLoan: false }).kiwiSaverEmployer, 1925, 'employer can stay at 3.5%');
  eq(calculatePaye({ ...base, kiwiSaverEmployeeRatePct: 3, kiwiSaverEmployerRatePct: 0, studentLoan: false }).kiwiSaverEmployer, 1650, 'blank employer rate falls back to 3% on a reduction');
  const notOnReduction = calculatePaye({ ...base, kiwiSaverEmployeeRatePct: 4, kiwiSaverEmployerRatePct: 3, studentLoan: false });
  eq(notOnReduction.kiwiSaverEmployer, 1925, 'employer 3% is lifted to 3.5% when the employee is not on 3%');
  eq(notOnReduction.notes.some((n) => n.includes('raised from 3% to the 3.5%')), true, 'and says so');
}
eq(calculatePaye({ ...base, taxYear: 2026, studentLoan: false }).takeHome, off.takeHome, 'taxYear 2026 matches the default');
eq(calculatePaye({ ...base, taxYear: 2031, studentLoan: false }).takeHome, off.takeHome, 'a year with no rates falls back to the current year');
eq(PAY_TAX_YEAR_OPTIONS.map((y) => y.startYear).join(), '2026,2025,2024', 'years offered, newest first');

// 2024/25 (KAN-96): brackets changed on 31 July 2024, so the year uses IRD's composite rates.
const r24 = payTaxYearRates(2024);
eq(r24.start, '2024-04-01', '2024/25 starts 1 April 2024');
eq(r24.end, '2025-03-31', '2024/25 ends 31 March 2025');
eq(Math.round(calcIncomeTax(14000, r24) * 100) / 100, 1470, '2024/25 tax at $14,000 (10.5%)');
eq(Math.round(calcIncomeTax(15600, r24) * 100) / 100, 1675.12, '2024/25 tax at $15,600 (+12.82%)');
eq(Math.round(calcIncomeTax(48000, r24) * 100) / 100, 7345.12, '2024/25 tax at $48,000 (+17.5%)');
eq(Math.round(calcIncomeTax(53500, r24) * 100) / 100, 8535.32, '2024/25 tax at $53,500 (+21.64%)');
eq(Math.round(calcIncomeTax(78100, r24) * 100) / 100, 15995.51, '2024/25 tax at $78,100 (+30% then 30.99%)');
eq(Math.round(calcIncomeTax(180000, r24) * 100) / 100, 49622.51, '2024/25 tax at $180,000 (+33%)');
eq(Math.round(calcIncomeTax(200000, r24) * 100) / 100, 57422.51, '2024/25 tax at $200,000 (+39%)');
eq(calcAcc(100000, r24), 1600, '2024/25 ACC at 1.60%');
eq(calcAcc(200000, r24), 2276.52, '2024/25 ACC capped at the published $2,276.52');
eq(calcAcc(142283, r24), 2276.52, '2024/25 ACC at the maximum liable earnings');
eq(calcIetc(55000, r24), 0, '2024/25 IETC is not loaded, so no credit');

const y24 = calculatePaye({ ...base, taxYear: 2024, amount: 70000, kiwiSaverEmployeeRatePct: 3, kiwiSaverEmployerRatePct: 3, studentLoan: true });
eq(y24.incomeTax, 13485.32, '2024/25 income tax at $70,000 (composite rates)');
eq(y24.acc, 1120, '2024/25 ACC at $70,000');
eq(y24.ietcCredit, 0, '2024/25 applies no IETC');
eq(y24.taxCode, 'M SL', '2024/25 tax code without IETC');
eq(y24.kiwiSaverEmployee, 2100, '2024/25 employee KiwiSaver 3%');
eq(y24.kiwiSaverEmployer, 2100, '2024/25 employer KiwiSaver 3%');
eq(y24.studentLoan, 5504.64, '2024/25 student loan 12% over $24,128');
eq(y24.notes.some((n) => n === 'IETC not applied — it is not loaded for 1 April 2024 – 31 March 2025.'), true, '2024/25 says IETC is not loaded');
eq(y24.notes.some((n) => n.includes('composite rates')), true, '2024/25 says it uses composite rates');
eq(y24.notes.some((n) => n.includes('Secondary tax codes use the thresholds from 31 July 2024')), true, '2024/25 explains secondary codes');
eq(off.notes.some((n) => n.includes('composite')), false, '2026/27 has no 2024/25 notes');

eq(pickSecondaryCode(50000, r24).code, 'S', '2024/25 secondary codes use the 31 July 2024 thresholds ($50,000 is S, not SH)');
const sec24 = calculatePaye({ ...base, taxYear: 2024, employment: 'secondary', amount: 20000, secondaryTotalAnnualIncome: 50000, studentLoan: false });
eq(sec24.incomeTax, 3500, '2024/25 secondary S at 17.5%');
eq(calculatePaye({ ...base, taxYear: 2024, employment: 'secondary', studentLoan: false }).notes.some((n) => n.includes('ignored for secondary')), true, 'secondary still says IETC is main job only');
eq(taxYearForDate('2026-03-31'), 2025, '31 March is the end of the previous tax year');
eq(taxYearForDate('2026-04-01'), 2026, '1 April starts a new tax year');

console.log('payeCalc.test.ts ok');
