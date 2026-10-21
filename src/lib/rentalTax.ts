/**
 * Rental tax rules (KAN-93). Pure helpers for the Rentals page. Tax years are named by the
 * year they end in, as in rental.ts (2025 = 1 Apr 2024 – 31 Mar 2025). General information,
 * not tax advice.
 *
 * A. Interest limitation: 80% of residential rental interest is deductible in 2024/25, 100%
 *    from 1 April 2025. Earlier years had other limits that aren't modelled here.
 * B. Loss ring-fencing (since 2019/20): a net rental loss can't reduce other income. It carries
 *    forward to later rental profit, pooled across properties (portfolio basis, the default)
 *    or kept per property.
 * C. Bright-line: residential land with a sale agreement on/after 1 July 2024 is taxable when
 *    the agreement is within 2 years of settlement. Your main home is excluded.
 *
 * Your own home with rooms let (ownHome) is outside A and B, and excluded from C.
 */
import { roundMoney } from './debtModel.ts';
import { taxYearOf, taxYearRange, type RentalEntryKind } from './rental.ts';

export const RENTAL_TAX_SOURCES = {
  interest: {
    label: 'IRD — Property interest rules',
    url: 'https://www.ird.govt.nz/property/renting-out-residential-property/residential-rental-income-and-paying-tax-on-it/rental-expense-deductions/property-interest-rules',
  },
  ringFencing: {
    label: 'IRD — Choosing a basis to work out residential rental income',
    url: 'https://www.ird.govt.nz/property/renting-out-residential-property/residential-rental-property-deductions/choosing-a-basis-to-work-out-residential-rental-income',
  },
  brightLine: {
    label: 'IRD — The bright-line test',
    url: 'https://www.ird.govt.nz/property/buying-and-selling/when-you-need-to-pay/the-brightline-test',
  },
} as const;

// ---------------------------------------------------------------- A. interest limitation

/** First tax year (by end year) whose interest rule is modelled: 2024/25. */
export const INTEREST_RULES_FROM_YEAR = 2025;
const INTEREST_SHARE: Readonly<Record<number, number>> = { 2025: 0.8 };

/** Share of mortgage interest deductible in a tax year: 0.8 for 2024/25, 1 from 2025/26. */
export function interestDeductibleShare(endYear: number): number {
  return INTEREST_SHARE[endYear] ?? 1;
}

// ---------------------------------------------------------------- B. ring-fencing

/** Ring-fencing applies from the 2019/20 tax year (ending 31 March 2020). */
export const RING_FENCING_FROM_YEAR = 2020;

export type RentalLossBasis = 'portfolio' | 'property';
export const RENTAL_LOSS_BASIS_DEFAULT: RentalLossBasis = 'portfolio';

export function isRentalLossBasis(v: unknown): v is RentalLossBasis {
  return v === 'portfolio' || v === 'property';
}

type TaxEntry = { propertyId: string; date: string; kind: RentalEntryKind; category: string; amountNzd: number };
type TaxProperty = { id: string; ownHome: boolean };

export type RentalTaxYear = {
  income: number;
  /** Expenses with interest cut to its deductible share. */
  deductibleExpenses: number;
  interest: number;
  deductibleInterest: number;
  /** income − deductibleExpenses. Negative is a loss. */
  net: number;
  /** Ring-fenced loss brought in from earlier years. */
  broughtForward: number;
  /** Of that, used against this year's profit. */
  lossUsed: number;
  /** Rental income that counts as taxable this year; never below 0. */
  taxable: number;
  carriedForward: number;
};

/** One tax year's figures for the entries given (all already for the right properties). */
function yearFigures(entries: readonly TaxEntry[], endYear: number): Pick<RentalTaxYear, 'income' | 'deductibleExpenses' | 'interest' | 'deductibleInterest' | 'net'> {
  const { start, end } = taxYearRange(endYear);
  let income = 0;
  let other = 0;
  let interest = 0;
  for (const e of entries) {
    if (e.date < start || e.date > end) continue;
    if (e.kind === 'income') income += e.amountNzd;
    else if (e.category === 'interest') interest += e.amountNzd;
    else other += e.amountNzd;
  }
  const deductibleInterest = roundMoney(interest * interestDeductibleShare(endYear));
  const deductibleExpenses = roundMoney(other + deductibleInterest);
  income = roundMoney(income);
  return { income, deductibleExpenses, interest: roundMoney(interest), deductibleInterest, net: roundMoney(income - deductibleExpenses) };
}

/** Year-by-year ring-fencing for one pool of entries, from its first year up to endYear. */
function ringFence(entries: readonly TaxEntry[], endYear: number): RentalTaxYear {
  const first = Math.max(RING_FENCING_FROM_YEAR, entries.reduce((min, e) => Math.min(min, taxYearOf(e.date)), endYear));
  if (endYear < RING_FENCING_FROM_YEAR) {
    const f = yearFigures(entries, endYear);
    return { ...f, broughtForward: 0, lossUsed: 0, taxable: Math.max(0, f.net), carriedForward: 0 };
  }
  let carried = 0;
  let out: RentalTaxYear | null = null;
  for (let y = first; y <= endYear; y++) {
    const f = yearFigures(entries, y);
    const broughtForward = carried;
    const lossUsed = f.net > 0 ? Math.min(broughtForward, f.net) : 0;
    const taxable = roundMoney(Math.max(0, f.net) - lossUsed);
    carried = roundMoney(broughtForward - lossUsed + Math.max(0, -f.net));
    out = { ...f, broughtForward, lossUsed: roundMoney(lossUsed), taxable, carriedForward: carried };
  }
  return out!;
}

function sumYears(rows: readonly RentalTaxYear[]): RentalTaxYear {
  const keys = ['income', 'deductibleExpenses', 'interest', 'deductibleInterest', 'net', 'broughtForward', 'lossUsed', 'taxable', 'carriedForward'] as const;
  const out = Object.fromEntries(keys.map((k) => [k, 0])) as RentalTaxYear;
  for (const r of rows) for (const k of keys) out[k] = roundMoney(out[k] + r[k]);
  return out;
}

export type RentalTaxView = {
  endYear: number;
  basis: RentalLossBasis;
  /** Ring-fenced rental properties (not your home). */
  rental: RentalTaxYear;
  /** Each ring-fenced property worked out on its own (what the per-property basis adds up). */
  perProperty: Record<string, RentalTaxYear>;
  /** False before 2024/25: interest limits back then aren't modelled, so interest is shown in full. */
  interestModelled: boolean;
  interestShare: number;
};

/**
 * Taxable rental income for a tax year after interest limitation and ring-fencing.
 * A loss is never subtracted from other income: taxable is 0 and the loss carries forward.
 * Your own home with rooms let is left out (it isn't ring-fenced).
 */
export function rentalTaxView(
  entries: readonly TaxEntry[],
  properties: readonly TaxProperty[],
  endYear: number,
  basis: RentalLossBasis = RENTAL_LOSS_BASIS_DEFAULT,
): RentalTaxView {
  const fenced = properties.filter((p) => !p.ownHome).map((p) => p.id);
  const ofProperty = (id: string) => entries.filter((e) => e.propertyId === id);
  const perProperty: Record<string, RentalTaxYear> = {};
  for (const id of fenced) perProperty[id] = ringFence(ofProperty(id), endYear);
  const fencedSet = new Set(fenced);
  const rental =
    basis === 'portfolio'
      ? ringFence(entries.filter((e) => fencedSet.has(e.propertyId)), endYear)
      : sumYears(Object.values(perProperty));
  return {
    endYear,
    basis,
    rental,
    perProperty,
    interestModelled: endYear >= INTEREST_RULES_FROM_YEAR,
    interestShare: interestDeductibleShare(endYear),
  };
}

// ---------------------------------------------------------------- C. bright-line

/** The 2-year bright-line applies to sales whose end date (sale agreement) is on/after this day. */
export const BRIGHT_LINE_2Y_FROM = '2024-07-01';
export const BRIGHT_LINE_YEARS = 2;

/** `ymd` plus whole years; 29 Feb becomes 28 Feb in a non-leap year. */
export function addYears(ymd: string, years: number): string {
  const y = Number(ymd.slice(0, 4)) + years;
  const md = ymd.slice(5);
  const leap = (y % 4 === 0 && y % 100 !== 0) || y % 400 === 0;
  return `${y}-${md === '02-29' && !leap ? '02-28' : md}`;
}

export type BrightLineInput = {
  /** Start date: usually when the title was registered to you (settlement). */
  purchaseDate: string | null;
  /** End date: usually the date of the binding sale agreement. */
  saleAgreementDate: string | null;
  purchasePrice: number | null;
  salePrice: number | null;
  /** Costs of buying, improving and selling (legal, agent, capital improvements). */
  saleCosts: number | null;
  ownHome: boolean;
};

export type BrightLineResult =
  | { status: 'not_sold' }
  | { status: 'no_purchase_date' }
  | { status: 'main_home' }
  /** Sale agreement before 1 July 2024: the older 2/5/10-year periods applied; not worked out here. */
  | { status: 'earlier_rules' }
  | { status: 'outside'; periodEnds: string }
  /** gain is sale price − purchase price − costs, or null when a price is missing. */
  | { status: 'inside'; periodEnds: string; gain: number | null };

/**
 * Whether a sale falls inside the 2-year bright-line. The period runs from the purchase date
 * up to (not including) the same date 2 years on, so a sale agreed on that anniversary or
 * later is outside. Outside bright-line a sale can still be taxable (bought to sell, dealing).
 */
export function brightLineCheck(p: BrightLineInput): BrightLineResult {
  if (!p.saleAgreementDate) return { status: 'not_sold' };
  if (p.ownHome) return { status: 'main_home' };
  if (!p.purchaseDate) return { status: 'no_purchase_date' };
  if (p.saleAgreementDate < BRIGHT_LINE_2Y_FROM) return { status: 'earlier_rules' };
  const periodEnds = addYears(p.purchaseDate, BRIGHT_LINE_YEARS);
  if (p.saleAgreementDate >= periodEnds) return { status: 'outside', periodEnds };
  const gain = p.salePrice != null && p.purchasePrice != null ? roundMoney(p.salePrice - p.purchasePrice - (p.saleCosts ?? 0)) : null;
  return { status: 'inside', periodEnds, gain };
}
