/**
 * Rooms let in a property, including the owner's own home (KAN-83). Pure helpers shared by
 * the API and the Rentals page. Dates are YYYY-MM-DD in Pacific/Auckland; periods run over
 * the New Zealand tax year (see rental.ts), cut off at today.
 *
 * Expected rent spreads each tenancy's rent evenly over the days it covers: weekly ÷ 7,
 * fortnightly ÷ 14, monthly × 12 ÷ 365. Received rent is the income entries recorded
 * against the room. Shared expenses are split across the property's rooms by each room's
 * share; other expenses stay with the owner.
 */
import { roundMoney } from './debtModel.ts';
import { taxYearRange } from './rental.ts';

export type RentFrequency = 'weekly' | 'fortnightly' | 'monthly';

export const RENT_FREQUENCIES: readonly { value: RentFrequency; label: string; per: string }[] = [
  { value: 'weekly', label: 'Weekly', per: 'week' },
  { value: 'fortnightly', label: 'Fortnightly', per: 'fortnight' },
  { value: 'monthly', label: 'Monthly', per: 'month' },
];

export function isRentFrequency(v: unknown): v is RentFrequency {
  return RENT_FREQUENCIES.some((f) => f.value === v);
}

export function rentFrequencyPer(v: RentFrequency): string {
  return RENT_FREQUENCIES.find((f) => f.value === v)?.per ?? 'week';
}

/** Rent for one day of a tenancy. */
export function dailyRent(amount: number, frequency: RentFrequency): number {
  if (frequency === 'weekly') return amount / 7;
  if (frequency === 'fortnightly') return amount / 14;
  return (amount * 12) / 365;
}

const DAY = 86_400_000;

function dayNum(date: string): number {
  return Date.parse(`${date}T00:00:00Z`) / DAY;
}

/** Days in [start, end], both inclusive; 0 when end is before start. */
export function daysInclusive(start: string, end: string): number {
  return Math.max(0, dayNum(end) - dayNum(start) + 1);
}

type Span = { startDate: string; endDate: string | null };

/** True when two tenancies share at least one day. No end date runs on indefinitely. */
export function tenanciesOverlap(a: Span, b: Span): boolean {
  const aEnd = a.endDate ?? '9999-12-31';
  const bEnd = b.endDate ?? '9999-12-31';
  return a.startDate <= bEnd && b.startDate <= aEnd;
}

/** Days of a tenancy inside [from, to]. */
function overlapDays(t: Span, from: string, to: string): number {
  const start = t.startDate > from ? t.startDate : from;
  const end = t.endDate && t.endDate < to ? t.endDate : to;
  return daysInclusive(start, end);
}

export function tenancyCovers(t: Span, date: string): boolean {
  return t.startDate <= date && (t.endDate == null || t.endDate >= date);
}

type RoomIn = { id: string; propertyId: string; name: string; share: number; createdAt: string };
type TenancyIn = Span & { id: string; roomId: string; tenantLabel: string; rentAmount: number; rentFrequency: RentFrequency };
type EntryIn = { propertyId: string; roomId: string | null; date: string; kind: 'income' | 'expense'; amountNzd: number; shared: boolean };

export type RoomOccupancy = {
  roomId: string;
  /** Tenancy covering today, if any. */
  current: TenancyIn | null;
  /** Days in the period with no tenancy. Counted from the room's first day (set up or first tenancy). */
  vacancyDays: number;
  expected: number;
  received: number;
  /** This room's part of the property's shared expenses. */
  sharedCosts: number;
  /** received − sharedCosts */
  net: number;
};

export type PropertyOccupancy = {
  /** Period the figures cover: the tax year, ending today when it is the current one. Null for a future year. */
  period: { start: string; end: string } | null;
  rooms: RoomOccupancy[];
  occupied: number;
  vacant: number;
  expected: number;
  /** Rent recorded against rooms in the period. */
  received: number;
  sharedCosts: number;
  ownerCosts: number;
};

/**
 * Occupancy and rent per room of one property for a tax year. Only days up to today count,
 * so a current year compares rent due so far with rent received so far.
 */
export function propertyOccupancy(
  propertyId: string,
  rooms: readonly RoomIn[],
  tenancies: readonly TenancyIn[],
  entries: readonly EntryIn[],
  endYear: number,
  today: string,
): PropertyOccupancy {
  const year = taxYearRange(endYear);
  const end = today < year.end ? today : year.end;
  const period = end >= year.start ? { start: year.start, end } : null;
  const mine = rooms.filter((r) => r.propertyId === propertyId);
  const totalShare = mine.reduce((s, r) => s + Math.max(0, r.share), 0);

  let sharedTotal = 0;
  let ownerCosts = 0;
  for (const e of entries) {
    if (e.propertyId !== propertyId || e.kind !== 'expense' || !period) continue;
    if (e.date < year.start || e.date > year.end) continue;
    if (e.shared && totalShare > 0) sharedTotal += e.amountNzd;
    else ownerCosts += e.amountNzd;
  }

  const out: RoomOccupancy[] = mine.map((room) => {
    const own = tenancies.filter((t) => t.roomId === room.id);
    const current = own.find((t) => tenancyCovers(t, today)) ?? null;
    let expected = 0;
    let occupiedDays = 0;
    let vacancyDays = 0;
    if (period) {
      for (const t of own) {
        const days = overlapDays(t, period.start, period.end);
        occupiedDays += days;
        expected += days * dailyRent(t.rentAmount, t.rentFrequency);
      }
      const firstDay = [room.createdAt.slice(0, 10), ...own.map((t) => t.startDate)].sort()[0];
      const from = firstDay > period.start ? firstDay : period.start;
      vacancyDays = Math.max(0, daysInclusive(from, period.end) - occupiedDays);
    }
    let received = 0;
    for (const e of entries) {
      if (e.roomId === room.id && e.kind === 'income' && e.date >= year.start && e.date <= year.end) received += e.amountNzd;
    }
    const sharedCosts = totalShare > 0 ? (sharedTotal * Math.max(0, room.share)) / totalShare : 0;
    return {
      roomId: room.id,
      current,
      vacancyDays,
      expected: roundMoney(expected),
      received: roundMoney(received),
      sharedCosts: roundMoney(sharedCosts),
      net: roundMoney(received - sharedCosts),
    };
  });

  const occupied = out.filter((r) => r.current).length;
  return {
    period,
    rooms: out,
    occupied,
    vacant: out.length - occupied,
    expected: roundMoney(out.reduce((s, r) => s + r.expected, 0)),
    received: roundMoney(out.reduce((s, r) => s + r.received, 0)),
    sharedCosts: roundMoney(sharedTotal),
    ownerCosts: roundMoney(ownerCosts),
  };
}

/**
 * IRD's weekly standard-cost per boarder, by tax year (named by its end year). Only rates
 * checked against the published determination are listed; IRD sets each one after the year
 * ends (usually in May), so the current year is normally missing. Add a year only from IRD.
 */
export const IRD_BOARDER_WEEKLY_STANDARD_COST: Readonly<Record<number, { weekly: number; source: string }>> = {
  2024: {
    weekly: 231,
    source: 'https://www.taxtechnical.ird.govt.nz/determinations/standard-cost-household-service/boarding-service-providers/2024/det-19-01-cpi-2024',
  },
  2025: {
    weekly: 237,
    source: 'https://www.taxtechnical.ird.govt.nz/determinations/standard-cost-household-service/boarding-service-providers/2025/det-19-01-cpi-2025',
  },
  2026: {
    weekly: 245,
    source: 'https://www.taxtechnical.ird.govt.nz/determinations/standard-cost-household-service/boarding-service-providers/2026/det-19-01-cpi-2026',
  },
};

export const IRD_BOARDERS_URL =
  'https://www.ird.govt.nz/property/renting-out-residential-property/residential-rental-income-and-paying-tax-on-it/rules-for-working-out-rental-income-and-expenses/standard-cost-method-for-boarders-and-home-stay-students';

/** IRD's standard-cost method covers at most this many boarders at once. */
export const IRD_STANDARD_COST_MAX_BOARDERS = 4;

export type BoarderTaxInfo = {
  rate: { weekly: number; source: string } | null;
  /** Boarder-weeks in the period (each tenancy's days ÷ 7). */
  boarderWeeks: number;
  /** boarderWeeks × weekly rate; null when IRD hasn't set the year's rate. */
  weeklyStandardCosts: number | null;
  /** Most rooms let on any one day in the period. */
  mostBoardersAtOnce: number;
  received: number;
  /** Rent received less the rooms' share of shared expenses. Owner costs aren't included. */
  actualCostNet: number;
};

/** Figures to show beside IRD's two methods for boarders in your own home. Information only. */
export function boarderTaxInfo(occ: PropertyOccupancy, tenancies: readonly TenancyIn[], roomIds: readonly string[], endYear: number): BoarderTaxInfo {
  const rate = IRD_BOARDER_WEEKLY_STANDARD_COST[endYear] ?? null;
  const own = tenancies.filter((t) => roomIds.includes(t.roomId));
  let boarderDays = 0;
  let most = 0;
  if (occ.period) {
    for (const t of own) boarderDays += overlapDays(t, occ.period.start, occ.period.end);
    // The count only changes on a start date, so checking those days finds the peak.
    for (const t of own) {
      const day = t.startDate > occ.period.start ? t.startDate : occ.period.start;
      if (day > occ.period.end || (t.endDate && t.endDate < day)) continue;
      most = Math.max(most, own.filter((o) => tenancyCovers(o, day)).length);
    }
  }
  const boarderWeeks = Math.round((boarderDays / 7) * 10) / 10;
  return {
    rate,
    boarderWeeks,
    weeklyStandardCosts: rate ? roundMoney((boarderDays / 7) * rate.weekly) : null,
    mostBoardersAtOnce: most,
    received: occ.received,
    actualCostNet: roundMoney(occ.received - occ.sharedCosts),
  };
}
