/**
 * Debts page view logic. Run: npm run test:debts
 */
import { debtsOverview, formatMonthYear, joinNames, payoffBlocker } from './debtView.ts';

function eq(a: unknown, b: unknown, msg: string): void {
  if (a !== b) throw new Error(`FAIL: ${msg} (got ${String(a)}, expected ${String(b)})`);
}

const today = '2026-10-12';
const card = { id: 'a', name: 'Card', outstandingNzd: 1000, interestRatePercent: null, interestPeriod: null, actualPaymentNzd: 300 };
const loan = { id: 'b', name: 'Loan', outstandingNzd: 600, interestRatePercent: null, interestPeriod: null, actualPaymentNzd: 100 };
const mum = { id: 'c', name: 'Mum', outstandingNzd: 200, actualPaymentNzd: null };
const paid = { id: 'd', name: 'Old', outstandingNzd: 0, actualPaymentNzd: null };
const noRate = { id: 'e', name: 'Visa', outstandingNzd: 500, interestPeriod: 'month' as const, interestRatePercent: null, actualPaymentNzd: 50 };
const stuck = { id: 'f', name: 'BNPL', outstandingNzd: 5000, interestPeriod: 'month' as const, interestRatePercent: 12, actualPaymentNzd: 40 };

const ok = debtsOverview([card, loan, paid], today);
eq(ok.totalOwed, 1600, 'total owed');
eq(ok.owingCount, 2, 'paid-off debts are not counted as owing');
eq(ok.payingEachMonth, 400, 'sum of actual payments');
eq(ok.withoutPayment.length, 0, 'every owing debt has a payment');
eq(ok.debtFreeMonth, '2027-04', 'latest payoff: Loan takes 6 payments, Nov 2026 to Apr 2027');
eq(ok.blockers.length, 0, 'no blockers');

const blocked = debtsOverview([card, mum, noRate, stuck, paid], today);
eq(blocked.debtFreeMonth, null, 'any blocker hides the debt-free month');
eq(blocked.withoutPayment.join(), 'Mum', 'names the debt with no payment');
eq(blocked.blockers.map((b) => `${b.name}:${b.reason}`).join(), 'Mum:needs_payment,Visa:needs_rate,BNPL:does_not_pay_down', 'reasons per debt');

eq(debtsOverview([paid], today).debtFreeMonth, null, 'nothing owing: no month');
eq(payoffBlocker(card), null, 'a payable debt has no blocker');

eq(formatMonthYear('2027-03'), 'Mar 2027', 'month label');
eq(joinNames(['A']), 'A', 'one name');
eq(joinNames(['A', 'B', 'C']), 'A, B and C', 'three names');

console.log('debt view tests ok');
