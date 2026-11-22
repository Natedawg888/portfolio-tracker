/**
 * Scenario tool (KAN-32). Runs the user's own projection twice, as it is and with one or more
 * changes, and reports the difference in savings, investments, debt and net worth:
 *   - extraSavingMonthlyNzd: save this much more each month (added to cash);
 *   - extraIncomeMonthlyNzd: extra take-home pay each month, e.g. from a pay rise (worked out with
 *     the PAYE rules on the client), also added to cash;
 *   - investMonthlyNzd: move this much a month from cash into shares & funds;
 *   - mortgageRateChangePct: change the rate on mortgages in Debts by this many points (payments
 *     stay as saved, so a higher rate leaves more owing).
 * Everything else (returns, starting values, debts, bonds, mining) is the user's projection.
 */
import type { ProjectionClassInput, ProjectionDebtInput, ProjectionResult } from './model.ts';

export type ScenarioInput = {
  extraSavingMonthlyNzd: number;
  extraIncomeMonthlyNzd: number;
  investMonthlyNzd: number;
  mortgageRateChangePct: number;
};

export const NO_SCENARIO: ScenarioInput = { extraSavingMonthlyNzd: 0, extraIncomeMonthlyNzd: 0, investMonthlyNzd: 0, mortgageRateChangePct: 0 };

export const isEmptyScenario = (s: ScenarioInput) => !s.extraSavingMonthlyNzd && !s.extraIncomeMonthlyNzd && !s.investMonthlyNzd && !s.mortgageRateChangePct;

const r2 = (n: number) => Math.round(n * 100) / 100;

/** Apply the scenario to the projection's classes. A missing cash or shares class is added at 0. */
export function applyScenarioToClasses(classes: ProjectionClassInput[], s: ScenarioInput): ProjectionClassInput[] {
  if (isEmptyScenario(s)) return classes;
  const out = classes.map((c) => ({ ...c }));
  const get = (key: 'cash' | 'shares') => {
    let c = out.find((x) => x.key === key);
    if (!c) {
      c = { key, startNzd: 0, annualReturnPercent: 0, returnSource: 'default', monthlyAdditionNzd: null, additionSource: 'default', additionReason: null };
      out.push(c);
    }
    return c;
  };
  const shift = (c: ProjectionClassInput, by: number) => {
    if (!by) return;
    if (c.monthlyAdditionsNzd) c.monthlyAdditionsNzd = c.monthlyAdditionsNzd.map((v) => r2(v + by));
    c.monthlyAdditionNzd = r2((c.monthlyAdditionNzd ?? 0) + by);
    c.additionSource = 'query';
    c.additionReason = 'Scenario';
  };
  shift(get('cash'), s.extraSavingMonthlyNzd + s.extraIncomeMonthlyNzd - s.investMonthlyNzd);
  if (s.investMonthlyNzd) shift(get('shares'), s.investMonthlyNzd);
  return out;
}

/** Mortgages in Debts at the changed rate (never below 0). Other debts unchanged. */
export function applyScenarioToDebts<T extends ProjectionDebtInput & { productKind?: string | null }>(debts: T[], s: ScenarioInput): T[] {
  if (!s.mortgageRateChangePct) return debts;
  return debts.map((d) => (d.productKind === 'mortgage' && d.annualRatePercent != null ? { ...d, annualRatePercent: Math.max(0, r2(d.annualRatePercent + s.mortgageRateChangePct)) } : d));
}

export type ScenarioSummary = {
  netWorthEndNzd: number;
  savingsEndNzd: number;
  investmentsEndNzd: number;
  debtEndNzd: number;
};

/** End-of-horizon figures: savings = cash; investments = every other asset class; debt = Debts. */
export function summarise(p: ProjectionResult): ScenarioSummary {
  const last = p.points[p.points.length - 1];
  const cash = p.assetClasses.find((c) => c.key === 'cash')?.endNzd ?? 0;
  const invest = p.assetClasses.filter((c) => c.key !== 'cash').reduce((sum, c) => sum + c.endNzd, 0);
  return {
    netWorthEndNzd: r2(last?.netWorthNzd ?? 0),
    savingsEndNzd: r2(cash),
    investmentsEndNzd: r2(invest),
    debtEndNzd: r2(last?.debtOutstandingNzd ?? 0),
  };
}

export function difference(a: ScenarioSummary, b: ScenarioSummary): ScenarioSummary {
  return {
    netWorthEndNzd: r2(b.netWorthEndNzd - a.netWorthEndNzd),
    savingsEndNzd: r2(b.savingsEndNzd - a.savingsEndNzd),
    investmentsEndNzd: r2(b.investmentsEndNzd - a.investmentsEndNzd),
    debtEndNzd: r2(b.debtEndNzd - a.debtEndNzd),
  };
}

/** Parse the scenario query (all optional, NZD a month or % points). */
export function parseScenario(q: Record<string, unknown>): { ok: true; value: ScenarioInput } | { ok: false; error: string } {
  const num = (name: string, min: number, max: number): number | string => {
    const v = q[name];
    if (v == null || v === '') return 0;
    const n = Number(v);
    if (typeof v !== 'string' || !Number.isFinite(n) || n < min || n > max) return `${name} must be a number from ${min} to ${max}`;
    return n;
  };
  const vals = {
    extraSavingMonthlyNzd: num('extraSaving', -1_000_000, 1_000_000),
    extraIncomeMonthlyNzd: num('extraIncome', -1_000_000, 1_000_000),
    investMonthlyNzd: num('invest', 0, 1_000_000),
    mortgageRateChangePct: num('mortgageRate', -20, 20),
  };
  for (const v of Object.values(vals)) if (typeof v === 'string') return { ok: false, error: v };
  return { ok: true, value: vals as ScenarioInput };
}
