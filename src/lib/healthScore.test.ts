/**
 * Financial health score (KAN-55). Run: npm run test:health-score
 */
import { bandFor, computeHealthScore, type HealthInput } from './healthScore.ts';

function assert(cond: unknown, msg: string): void {
  if (!cond) throw new Error(`FAIL: ${msg}`);
}
function eq(a: unknown, b: unknown, msg: string): void {
  if (a !== b) throw new Error(`FAIL: ${msg} (got ${String(a)}, expected ${String(b)})`);
}

const month = (incomeNzd: number, spendingNzd: number) => ({ incomeNzd, spendingNzd });
const base: HealthInput = {
  windowMonths: 6,
  months: Array.from({ length: 6 }, () => month(5000, 4000)),
  cashNzd: 24000,
  personalDebtNzd: 0,
  cardDebtNzd: 0,
  investedNzd: 3000,
  kiwiSaverNzd: 0,
};
const check = (r: ReturnType<typeof computeHealthScore>, key: string) => r.checks.find((c) => c.key === key)!;

// Everything strong: 20% saved, 6 months cash, no debt, 10% invested, every month positive.
{
  const r = computeHealthScore(base);
  eq(check(r, 'savingsRate').score, 100, '20% savings rate = full');
  eq(check(r, 'emergencyFund').score, 100, '24,000 ÷ 4,000 = 6 months = full');
  eq(check(r, 'debt').score, 100, 'no debt = full');
  eq(check(r, 'investing').score, 100, '3,000 of 30,000 = 10% = full');
  eq(check(r, 'consistency').score, 100, 'every month positive');
  eq(r.score, 100, 'overall 100');
  eq(r.band, 'strong', 'strong band');
  assert(r.summary.startsWith('Every check'), 'all-good summary');
}

// Partial marks scale linearly.
{
  const r = computeHealthScore({ ...base, months: Array.from({ length: 6 }, () => month(5000, 4500)), cashNzd: 13500, investedNzd: 1500 });
  eq(check(r, 'savingsRate').score, 50, '10% saved = half');
  eq(check(r, 'emergencyFund').score, 50, '3 months = half');
  eq(check(r, 'investing').score, 50, '5% invested = half');
  // (50×25 + 50×25 + 100×20 + 50×15 + 100×15) / 100 = 67.5 → 68
  eq(r.score, 68, 'weighted overall');
  eq(r.band, 'good', 'good band');
  assert(r.summary.includes('Most room to improve'), 'names the weakest check');
}

// Debt: ratio of a year's income, mortgage not included; spending more than income.
{
  const r = computeHealthScore({ ...base, personalDebtNzd: 9000, cardDebtNzd: 3000 });
  // yearly income 60,000; debt 12,000 = 20% → 1 − 0.2/0.5 = 60
  eq(check(r, 'debt').score, 60, 'debt at 20% of yearly income = 60');
  const over = computeHealthScore({ ...base, months: Array.from({ length: 6 }, () => month(4000, 5000)) });
  eq(check(over, 'savingsRate').score, 0, 'spending over income = 0');
  assert(check(over, 'savingsRate').explanation.includes('more than you earned'), 'says so');
  eq(check(over, 'consistency').score, 0, 'no positive months');
}

// Not enough data.
{
  const none = computeHealthScore({ ...base, months: Array.from({ length: 6 }, () => month(0, 0)), cashNzd: 0, investedNzd: 0 });
  eq(none.score, null, 'no score without income or spending');
  assert(none.summary.startsWith('Not enough data'), 'explains why');
  assert(none.checks.every((c) => c.score == null || c.key === 'debt'), 'only debt can be scored with no cashflow');
  const spendOnly = computeHealthScore({ ...base, months: Array.from({ length: 6 }, () => month(0, 2000)) });
  eq(check(spendOnly, 'savingsRate').score, null, 'no income → savings rate left out');
  eq(spendOnly.score, (100 * 25 + 100 * 20 + 0 * 15) / 60 | 0, 'remaining weights scaled up (emergency, debt, consistency)');
}

eq(bandFor(80), 'strong', '80 strong');
eq(bandFor(79), 'good', '79 good');
eq(bandFor(40), 'fair', '40 fair');
eq(bandFor(39), 'needs_attention', '39 needs attention');

console.log('health score tests ok');
