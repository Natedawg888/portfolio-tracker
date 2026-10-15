/**
 * Payslip check (KAN-78). Expected figures are worked by hand from the 2026/27 rates.
 * Run: npm run test:payslips
 */
import { checkPayslip, missingPeriods, parseTaxCode, type PayslipFigures } from './payslipCheck.ts';

function eq(actual: unknown, expected: unknown, msg: string): void {
  if (actual !== expected) throw new Error(`FAIL: ${msg} (got ${String(actual)}, expected ${String(expected)})`);
}
const item = (r: ReturnType<typeof checkPayslip>, key: string) => {
  if (r.status !== 'checked') throw new Error(`FAIL: expected a check (${r.status === 'not_checked' ? r.reason : ''})`);
  const i = r.items.find((x) => x.key === key);
  if (!i) throw new Error(`FAIL: no ${key} item`);
  return i;
};

// Weekly $1,500, tax code M SL, 3.5% KiwiSaver, 2026/27.
// Yearly $78,000: tax 1,638 + 6,632.50 + 7,350 = 15,620.50 → $300.39 a week. ACC 1.75% → $26.25.
// Student loan (1,500 − 464) × 12% = $124.32. KiwiSaver 3.5% = $52.50.
const weekly: PayslipFigures = {
  payDate: '2026-10-08', frequency: 'weekly', taxCode: 'M SL', grossNzd: 1500,
  payeNzd: 300.39, accNzd: 26.25, kiwiSaverEmployeeNzd: 52.5, kiwiSaverRatePct: null, studentLoanNzd: 124.32,
};
let r = checkPayslip(weekly);
eq(r.status === 'checked' && r.allOk, true, 'a correct weekly payslip passes');
eq(item(r, 'paye').expected, 300.39, 'PAYE expected');
eq(item(r, 'acc').expected, 26.25, 'ACC expected');
eq(item(r, 'student_loan').expected, 124.32, 'student loan expected');
eq(item(r, 'kiwisaver').label, 'KiwiSaver (3.5%)', 'KiwiSaver rate worked out');
eq(r.status === 'checked' && r.taxYear, 2026, 'tax year from the pay date');

// PAYE shown including ACC.
r = checkPayslip({ ...weekly, payeNzd: 326.64, accNzd: null });
eq(item(r, 'paye_acc').expected, 326.64, 'PAYE including ACC');
eq(item(r, 'paye_acc').ok, true, 'and it matches');

// A wrong deduction is flagged, small rounding isn't.
r = checkPayslip({ ...weekly, payeNzd: 340 });
eq(item(r, 'paye').ok, false, 'PAYE $39.61 too high is flagged');
eq(item(r, 'paye').difference, 39.61, 'difference');
eq(r.status === 'checked' && r.allOk, false, 'overall flagged');
eq(item(checkPayslip({ ...weekly, payeNzd: 301 }), 'paye').ok, true, 'within $1 or 1% is fine');

// Fortnightly $2,000, ME SL: yearly $52,000, tax 8,008 − IETC 520 = 7,488 → $288; ACC $35; SL (2,000 − 928) × 12% = $128.64.
r = checkPayslip({ ...weekly, payDate: '2026-11-12', frequency: 'fortnightly', taxCode: 'me sl', grossNzd: 2000, payeNzd: 288, accNzd: 35, kiwiSaverEmployeeNzd: 80, kiwiSaverRatePct: 4, studentLoanNzd: 128.64 });
eq(r.status === 'checked' && r.allOk, true, `fortnightly ME SL passes ${JSON.stringify(r)}`);
eq(item(r, 'kiwisaver').label, 'KiwiSaver (4%)', 'given KiwiSaver rate');

// Secondary S SL, weekly $400: tax 17.5% = $70, ACC $7, student loan 12% of all of it = $48.
r = checkPayslip({ ...weekly, taxCode: 'S SL', grossNzd: 400, payeNzd: 70, accNzd: 7, kiwiSaverEmployeeNzd: 0, studentLoanNzd: 48 });
eq(r.status === 'checked' && r.allOk, true, 'secondary S SL passes');

// KiwiSaver that matches no rate, and student loan without SL.
r = checkPayslip({ ...weekly, kiwiSaverEmployeeNzd: 70 });
eq(item(r, 'kiwisaver').ok, false, 'KiwiSaver $70 on $1,500 matches no rate');
r = checkPayslip({ ...weekly, taxCode: 'M', studentLoanNzd: 20 });
eq(item(r, 'student_loan').ok, false, 'student loan taken without SL is flagged');

// 2025/26 uses that year's ACC (1.67%): $1,500 a week → $25.05.
eq(item(checkPayslip({ ...weekly, payDate: '2026-03-20' }), 'acc').expected, 25.05, '2025/26 ACC');

// Not checked.
eq(checkPayslip({ ...weekly, taxCode: 'ND' }).status, 'not_checked', 'unsupported tax code');
eq(checkPayslip({ ...weekly, taxCode: '' }).status, 'not_checked', 'no tax code');
eq(checkPayslip({ ...weekly, frequency: 'other' }).status, 'not_checked', 'irregular pay');
eq(checkPayslip({ ...weekly, payDate: '2024-06-01' }).status, 'not_checked', 'no rates for 2024/25');
eq(parseTaxCode('sh sl')?.base, 'SH', 'parse SH SL');

// Missing pay periods.
eq(missingPeriods(['2026-10-01', '2026-10-08', '2026-10-22', '2026-10-29'], 'weekly').length, 1, 'one missing week');
eq(missingPeriods(['2026-10-01', '2026-10-08', '2026-10-15'], 'weekly').length, 0, 'none missing');
eq(missingPeriods(['2026-08-15', '2026-09-15', '2026-11-15'], 'monthly')[0].after, '2026-09-15', 'missing October');

console.log('payslipCheck.test.ts ok');
