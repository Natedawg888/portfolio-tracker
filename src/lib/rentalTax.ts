/**
 * Rental tax rules (KAN-93): what the rental figures mean for an IR3R, as an estimate.
 * Pure helpers for the Rentals page. Tax years are named by their end year (see rental.ts).
 *
 * A. Interest limitation (IRD "Property interest rules"): 2024/25 (year 2025) → 80% of
 *    mortgage interest is deductible; from 1 April 2025 → 100%. Not limited: your own home
 *    with boarders or flatmates, and new builds. Earlier years depended on when the money
 *    was borrowed; that isn't worked out here (counted at 100%, with a note).
 * B. Loss ring-fencing (from 2019/20, year 2020): a rental loss can't reduce salary or other
 *    income. It carries forward to later rental profit, across all properties (portfolio,
 *    the default) or property by property. Your own home is outside the ring-fence.
 * C. Bright-line (IRD "The bright-line test"): residential land with a sale agreement on or
 *    after 1 July 2024, within 2 years of settling the purchase, is taxable unless it was
 *    your main home. Older sales had 2/5/10-year periods: flagged, not worked out.
 * General information, not tax advice.
 */
import { roundMoney } from './debtModel.ts';
import { taxYearOf, taxYearRange } from './rental.ts';

export const IRD_INTEREST_URL =
  'https://www.ird.govt.nz/property/renting-out-residential-property/residential-rental-income-and-paying-tax-on-it/rental-expense-deductions/property-interest-rules';
export const IRD_RING_FENCING_URL = 'https://www.ird.govt.nz/property/renting-out-residential-property/residential-rental-property-deductions';
export const IRD_BRIGHT_LINE_URL = 'https://www.ird.govt.nz/property/buying-and-selling/when-you-need-to-pay/the-brightline-test';

/** First tax year with residential loss ring-fencing (2019/20). */
export const RING_FENCE_FROM_YEAR = 2020;
/** Sale agreements from this date use the 2-year bright-line period. */
export const BRIGHT_LINE_2Y_FROM = '2024-07-01';

export type LossBasis = 'portfolio' | 'property';

/** Share of residential rental interest deductible in a tax year; note set when the year's rule isn't worked out. */
export function interestRule(endYear: number): { share: number; note: string | null } {
  if (endYear === 2025) return { share: 0.8, note: null };
  if (endYear >= 2026) return { share: 1, note: null };
  if (endYear >= 2022) return { share: 1, note: 'Interest rules for this year depended on when the money was borrowed. Counted in full here.' };
  return { share: 1, note: null };
}

type TaxProperty = { id: string; ownHome: boolean; newBuild: boolean };
type TaxEntry = { propertyId: string; date: string; kind: 'income' | 'expense'; category: string; amountNzd: number };

export type PropertyTaxYear = {
  income: number;
  /** All expenses as recorded, interest included. */
  expenses: number;
  interest: number;
  deductibleInterest: number;
  /** income − expenses, with interest counted at the deductible share. */
  net: number;
  /** Inside the residential ring-fence (not your own home, and from 2019/20). */
  ringFenced: boolean;
  /** Property basis only. */
  broughtForward?: number;
  taxable?: number;
  carriedForward?: number;
};

export type RentalTaxYear = {
  endYear: number;
  basis: LossBasis;
  interestShare: number;
  interestNote: string | null;
  interest: number;
  deductibleInterest: number;
  /** Net of the ring-fenced properties. */
  net: number;
  /** Ring-fenced loss from earlier years. */
  broughtForward: number;
  /** Rental income to declare from the ring-fenced properties: never below 0. */
  taxable: number;
  carriedForward: number;
  /** Net of properties outside the ring-fence (your own home); a loss here isn't carried. */
  outsideNet: number;
  properties: Record<string, PropertyTaxYear>;
};

function propertyYear(entries: readonly TaxEntry[], endYear: number, p: TaxProperty): PropertyTaxYear {
  const { start, end } = taxYearRange(endYear);
  const share = p.ownHome || p.newBuild ? 1 : interestRule(endYear).share;
  let income = 0;
  let expenses = 0;
  let interest = 0;
  for (const e of entries) {
    if (e.propertyId !== p.id || e.date < start || e.date > end) continue;
    if (e.kind === 'income') income += e.amountNzd;
    else {
      expenses += e.amountNzd;
      if (e.category === 'interest') interest += e.amountNzd;
    }
  }
  const deductibleInterest = roundMoney(interest * share);
  return {
    income: roundMoney(income),
    expenses: roundMoney(expenses),
    interest: roundMoney(interest),
    deductibleInterest,
    net: roundMoney(income - (expenses - interest) - deductibleInterest),
    ringFenced: !p.ownHome && endYear >= RING_FENCE_FROM_YEAR,
  };
}

/** Apply a loss pool to one year's net: what's taxable and what carries on. */
function applyPool(net: number, pool: number): { taxable: number; carriedForward: number } {
  if (net <= 0) return { taxable: 0, carriedForward: roundMoney(pool - net) };
  const used = Math.min(pool, net);
  return { taxable: roundMoney(net - used), carriedForward: roundMoney(pool - used) };
}

/**
 * The tax view of one year, carrying ring-fenced losses forward from the first year with
 * entries. Losses from before what's recorded here aren't known, so they start at 0.
 */
export function rentalTaxYear(properties: readonly TaxProperty[], entries: readonly TaxEntry[], endYear: number, basis: LossBasis): RentalTaxYear {
  const first = entries.reduce((y, e) => Math.min(y, taxYearOf(e.date)), endYear);
  let pool = 0;
  const pools = new Map<string, number>();
  let out: RentalTaxYear | null = null;
  for (let y = first; y <= endYear; y += 1) {
    const rule = interestRule(y);
    const per: Record<string, PropertyTaxYear> = {};
    let net = 0;
    let outsideNet = 0;
    let interest = 0;
    let deductibleInterest = 0;
    let taxable = 0;
    let broughtForward = 0;
    let carriedForward = 0;
    for (const p of properties) {
      const py = propertyYear(entries, y, p);
      per[p.id] = py;
      interest += py.interest;
      deductibleInterest += py.deductibleInterest;
      if (!py.ringFenced) {
        outsideNet += py.net;
        continue;
      }
      net += py.net;
      if (basis === 'property') {
        const bf = pools.get(p.id) ?? 0;
        const r = applyPool(py.net, bf);
        Object.assign(py, { broughtForward: bf, taxable: r.taxable, carriedForward: r.carriedForward });
        pools.set(p.id, r.carriedForward);
        broughtForward += bf;
        taxable += r.taxable;
        carriedForward += r.carriedForward;
      }
    }
    if (basis === 'portfolio') {
      broughtForward = pool;
      const r = applyPool(roundMoney(net), pool);
      taxable = r.taxable;
      carriedForward = r.carriedForward;
      pool = r.carriedForward;
    }
    out = {
      endYear: y,
      basis,
      interestShare: rule.share,
      interestNote: rule.note,
      interest: roundMoney(interest),
      deductibleInterest: roundMoney(deductibleInterest),
      net: roundMoney(net),
      broughtForward: roundMoney(broughtForward),
      taxable: roundMoney(taxable),
      carriedForward: roundMoney(carriedForward),
      outsideNet: roundMoney(outsideNet),
      properties: per,
    };
  }
  return out!;
}

/** Same day `years` later; 29 February → 28 February. */
export function addYears(ymd: string, years: number): string {
  const [y, m, d] = ymd.split('-').map(Number);
  const target = new Date(Date.UTC(y + years, m - 1, d));
  if (target.getUTCMonth() !== m - 1) target.setUTCDate(0);
  return target.toISOString().slice(0, 10);
}

export type BrightLineStatus = 'incomplete' | 'main_home' | 'older_rules' | 'inside' | 'outside';
export type BrightLine = {
  status: BrightLineStatus;
  /** Last day a sale agreement falls inside the 2-year period. */
  endsOn: string | null;
  /** Sale price − cost − sale costs, when inside and the figures are known. Can be a loss. */
  gainNzd: number | null;
};

/**
 * Bright-line for a sold property. Start: purchase settlement; end: the binding sale
 * agreement. An agreement on the 2-year anniversary is treated as inside (IRD doesn't say).
 * null when the property isn't sold.
 */
export function brightLine(p: {
  purchaseDate: string | null;
  purchaseCostNzd: number | null;
  saleAgreementDate: string | null;
  salePriceNzd: number | null;
  saleCostsNzd: number | null;
  mainHome: boolean;
}): BrightLine | null {
  if (!p.saleAgreementDate) return null;
  if (p.mainHome) return { status: 'main_home', endsOn: null, gainNzd: null };
  if (p.saleAgreementDate < BRIGHT_LINE_2Y_FROM) return { status: 'older_rules', endsOn: null, gainNzd: null };
  if (!p.purchaseDate) return { status: 'incomplete', endsOn: null, gainNzd: null };
  const endsOn = addYears(p.purchaseDate, 2);
  if (p.saleAgreementDate > endsOn) return { status: 'outside', endsOn, gainNzd: null };
  const gainNzd = p.salePriceNzd != null && p.purchaseCostNzd != null ? roundMoney(p.salePriceNzd - p.purchaseCostNzd - (p.saleCostsNzd ?? 0)) : null;
  return { status: 'inside', endsOn, gainNzd };
}
