/**
 * Debts page view logic over figures the API returns. Payoff maths comes from
 * debtModel (the same functions the server uses); nothing here is estimated.
 */
import { payoffSchedule, projectedPaymentMonth, type InterestPeriod, type PayoffSchedule } from './debtModel.ts';

export type DebtFigures = {
  id: string;
  name: string;
  outstandingNzd: number;
  interestRatePercent?: number | null;
  interestPeriod?: InterestPeriod | null;
  actualPaymentNzd?: number | null;
};

export function scheduleFor(d: DebtFigures, actualPayment: number | null = d.actualPaymentNzd ?? null): PayoffSchedule {
  return payoffSchedule({
    balance: d.outstandingNzd,
    annualRatePercent: d.interestRatePercent ?? null,
    actualPayment,
    interestPeriod: d.interestPeriod ?? null,
  });
}

/** Why a debt can't produce a payoff date. */
export type PayoffBlocker = 'needs_payment' | 'needs_rate' | 'does_not_pay_down';

export function payoffBlocker(d: DebtFigures, schedule: PayoffSchedule = scheduleFor(d)): PayoffBlocker | null {
  if (schedule.kind === 'schedule') return null;
  if (schedule.kind === 'does_not_pay_down') return 'does_not_pay_down';
  if (d.actualPaymentNzd == null) return 'needs_payment';
  return 'needs_rate';
}

export type DebtsOverview = {
  totalOwed: number;
  /** Debts with a balance above zero. */
  owingCount: number;
  payingEachMonth: number;
  /** Names of owing debts with no actual payment set. */
  withoutPayment: string[];
  /** YYYY-MM of the last projected payment across all debts; null when any debt blocks it. */
  debtFreeMonth: string | null;
  blockers: Array<{ name: string; reason: PayoffBlocker }>;
};

export function debtsOverview(debts: DebtFigures[], todayYmd: string): DebtsOverview {
  const owing = debts.filter((d) => d.outstandingNzd > 0);
  const blockers: DebtsOverview['blockers'] = [];
  let lastPayment = 0;
  for (const d of owing) {
    const schedule = scheduleFor(d);
    const reason = payoffBlocker(d, schedule);
    if (reason) blockers.push({ name: d.name, reason });
    else if (schedule.kind === 'schedule') lastPayment = Math.max(lastPayment, schedule.totalMonths);
  }
  return {
    totalOwed: debts.reduce((s, d) => s + (Number.isFinite(d.outstandingNzd) ? d.outstandingNzd : 0), 0),
    owingCount: owing.length,
    payingEachMonth: owing.reduce((s, d) => s + (d.actualPaymentNzd ?? 0), 0),
    withoutPayment: owing.filter((d) => d.actualPaymentNzd == null).map((d) => d.name),
    debtFreeMonth:
      owing.length === 0 || blockers.length > 0 || lastPayment === 0 ? null : projectedPaymentMonth(todayYmd, lastPayment),
    blockers,
  };
}

/** "Nov 2026" from YYYY-MM. */
export function formatMonthYear(ym: string): string {
  const [y, m] = ym.split('-').map(Number);
  if (!y || !m) return ym;
  return new Intl.DateTimeFormat('en-NZ', { month: 'short', year: 'numeric', timeZone: 'UTC' }).format(
    new Date(Date.UTC(y, m - 1, 1)),
  );
}

/** Join names as "A", "A and B", "A, B and C". */
export function joinNames(names: string[]): string {
  if (names.length <= 1) return names.join('');
  return `${names.slice(0, -1).join(', ')} and ${names[names.length - 1]}`;
}
