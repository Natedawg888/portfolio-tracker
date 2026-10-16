/**
 * Bonds and term deposits (KAN-80): the coupon / interest schedule and maturity, from what the
 * user entered. Pure: no prices, nothing estimated.
 *
 * - Coupon dates count back from the maturity date in steps of the frequency (monthly 1,
 *   quarterly 3, half-yearly 6, yearly 12 months) to just after the purchase date.
 * - Bonds (government, corporate) pay face value × rate ÷ payments a year each time. The first
 *   coupon is paid in full (accrued interest is in what you paid for it).
 * - Term deposits accrue daily: face value × rate × days in the period ÷ 365.
 * - "At maturity" pays all interest on the maturity date: face value × rate × days ÷ 365.
 * - After RWT: gross × (1 − RWT rate). Principal (face value) comes back on the maturity date.
 */

export type BondKind = 'govt' | 'corporate' | 'td';
export type CouponFrequency = 'monthly' | 'quarterly' | 'half_yearly' | 'yearly' | 'maturity';
export const BOND_KIND_LABEL: Record<BondKind, string> = { govt: 'Government bond', corporate: 'Corporate bond', td: 'Term deposit' };
export const FREQUENCY_LABEL: Record<CouponFrequency, string> = {
  monthly: 'Monthly',
  quarterly: 'Quarterly',
  half_yearly: 'Half-yearly',
  yearly: 'Yearly',
  maturity: 'At maturity',
};
const STEP_MONTHS: Record<Exclude<CouponFrequency, 'maturity'>, number> = { monthly: 1, quarterly: 3, half_yearly: 6, yearly: 12 };
const PER_YEAR: Record<Exclude<CouponFrequency, 'maturity'>, number> = { monthly: 12, quarterly: 4, half_yearly: 2, yearly: 1 };

/** IRD RWT rates on interest (payeRates.ts RWT_INTEREST_RATES), as percentages. */
export const RWT_CHOICES = [10.5, 17.5, 30, 33, 39] as const;

export type BondTerms = {
  kind: BondKind;
  faceValue: number;
  ratePct: number;
  frequency: CouponFrequency;
  purchaseDate: string;
  maturityDate: string;
  rwtPct: number | null;
};

export type ScheduledPayment = {
  date: string;
  kind: 'coupon' | 'principal';
  /** In the bond's currency. */
  gross: number;
  /** After RWT (equals gross when no RWT rate is set, and for principal). */
  net: number;
};

const r2 = (n: number) => Math.round((n + Number.EPSILON) * 100) / 100;
const DAY = 86_400_000;
const days = (a: string, b: string) => Math.round((Date.parse(`${b}T00:00:00Z`) - Date.parse(`${a}T00:00:00Z`)) / DAY);

/** `ymd` moved by whole months, keeping the day (clamped to the month's last day). */
export function addMonths(ymd: string, months: number, day = Number(ymd.slice(8, 10))): string {
  const [y, m] = ymd.split('-').map(Number);
  const total = y * 12 + (m - 1) + months;
  const ny = Math.floor(total / 12);
  const nm = (total % 12) + 1;
  const last = new Date(Date.UTC(ny, nm, 0)).getUTCDate();
  return `${ny}-${String(nm).padStart(2, '0')}-${String(Math.min(day, last)).padStart(2, '0')}`;
}

export function couponDates(t: Pick<BondTerms, 'frequency' | 'purchaseDate' | 'maturityDate'>): string[] {
  if (t.frequency === 'maturity') return [t.maturityDate];
  const step = STEP_MONTHS[t.frequency];
  const day = Number(t.maturityDate.slice(8, 10));
  const out: string[] = [];
  for (let k = 0; k < 2000; k++) {
    const d = addMonths(t.maturityDate, -step * k, day);
    if (d <= t.purchaseDate) break;
    out.push(d);
  }
  return out.reverse();
}

/** Every coupon / interest payment and the principal at maturity, oldest first. */
export function bondSchedule(t: BondTerms): ScheduledPayment[] {
  const net = (gross: number) => r2(t.rwtPct ? gross * (1 - t.rwtPct / 100) : gross);
  const rate = t.ratePct / 100;
  const dates = couponDates(t);
  const out: ScheduledPayment[] = [];
  let prev = t.purchaseDate;
  for (const d of dates) {
    let gross: number;
    if (t.frequency === 'maturity' || t.kind === 'td') gross = (t.faceValue * rate * days(prev, d)) / 365;
    else gross = (t.faceValue * rate) / PER_YEAR[t.frequency];
    gross = r2(gross);
    if (gross > 0) out.push({ date: d, kind: 'coupon', gross, net: net(gross) });
    prev = d;
  }
  out.push({ date: t.maturityDate, kind: 'principal', gross: r2(t.faceValue), net: r2(t.faceValue) });
  return out;
}

/** Maturity status for alerts: within 30 or 90 days, already matured, or neither. */
export function maturityAlert(maturityDate: string, today: string): { level: 'matured' | '30' | '90'; days: number } | null {
  const d = days(today, maturityDate);
  if (d < 0) return { level: 'matured', days: d };
  if (d <= 30) return { level: '30', days: d };
  if (d <= 90) return { level: '90', days: d };
  return null;
}
