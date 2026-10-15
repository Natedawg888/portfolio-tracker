/**
 * Pay worked out from output instead of hours (KAN-70):
 * - piece rate (employee): rate × units, PAYE through calculatePaye so numbers match the salary tool
 * - contract / schedular payments: rate × volume, withholding tax (WT) instead of PAYE
 * - share of catch: catch value × share %, self-employed income (no tax taken at source)
 *
 * All statutory figures come from PayTaxYearRates (payeRates.ts). Nothing here is hard-coded.
 * Weekly is the base period; a year is 52 weeks (same as payeCalc).
 */

import { calcIncomeTax, calculatePaye, type PayeBreakdown, type PayeInput } from './payeCalc';
import { PAYE_WEEKS_PER_YEAR, payTaxYearRates, type PayTaxYearRates } from './payeRates';

export type OutputPayType = 'piece' | 'schedular' | 'share_of_catch';

export const OUTPUT_PAY_TYPE_LABELS: Record<OutputPayType, string> = {
  piece: 'Piece rate',
  schedular: 'Contract (schedular)',
  share_of_catch: 'Share of catch',
};

export type UnitPresetGroup = { group: string; units: readonly string[] };

/** Unit presets by industry. A custom unit is also allowed. */
export const UNIT_PRESETS: readonly UnitPresetGroup[] = [
  { group: 'Horticulture', units: ['bin', 'tray', 'tree', 'vine', 'bucket', 'punnet', 'crate', 'carton'] },
  { group: 'Seafood', units: ['fish', 'kg', 'carton', 'dozen', 'unit'] },
  { group: 'Forestry', units: ['tree', 'hectare', 'm³'] },
  { group: 'Construction and trades', units: ['metre', 'm²', 'm³', 'block', 'room', 'roof', 'job'] },
  { group: 'Transport', units: ['parcel', 'load', 'job'] },
  { group: 'Other', units: ['animal', 'building', 'window', 'kg (scrap)', 'metre drilled'] },
] as const;

function round2(n: number): number {
  return Math.round((n + Number.EPSILON) * 100) / 100;
}

function nonNeg(n: number | undefined | null): number {
  return typeof n === 'number' && Number.isFinite(n) && n > 0 ? n : 0;
}

/** PAYE options carried over from the salary tool (everything except the pay amount). */
export type PieceRatePayeOptions = Omit<PayeInput, 'amount' | 'frequency' | 'hoursPerWeek'>;

export type PieceRateInput = {
  ratePerUnit: number;
  unitsPerWeek: number;
  hoursPerWeek: number;
  /** Add 8% holiday pay to each pay (seasonal / casual work). */
  holidayPayWithWages: boolean;
};

export type PieceRateGross = {
  /** Rate × units, before any top-up or holiday pay. */
  pieceEarnings: number;
  /** pieceEarnings ÷ hours. Null when hours are 0. */
  effectiveHourly: number | null;
  minimumWageHourly: number;
  /** Minimum wage × hours worked. */
  minimumForHours: number;
  belowMinimumWage: boolean;
  /** Amount the employer must add so pay reaches minimum wage for hours worked. */
  topUp: number;
  /** max(pieceEarnings, minimumForHours). */
  earnings: number;
  holidayPay: number;
  /** Weekly gross used for PAYE: earnings + holiday pay. */
  weeklyGross: number;
  annualGross: number;
};

/**
 * Weekly piece-rate gross with the minimum-wage top-up and optional 8% holiday pay.
 * Employers must pay at least minimum wage for hours worked, so the top-up is part of gross.
 */
export function pieceRateGross(input: PieceRateInput, rates: PayTaxYearRates = payTaxYearRates()): PieceRateGross {
  const pieceEarnings = round2(nonNeg(input.ratePerUnit) * nonNeg(input.unitsPerWeek));
  const hours = nonNeg(input.hoursPerWeek);
  const minimumWageHourly = rates.minimumWageAdultHourly;
  const minimumForHours = round2(minimumWageHourly * hours);
  const effectiveHourly = hours > 0 ? pieceEarnings / hours : null;
  const belowMinimumWage = hours > 0 && pieceEarnings < minimumForHours;
  const topUp = belowMinimumWage ? round2(minimumForHours - pieceEarnings) : 0;
  const earnings = round2(pieceEarnings + topUp);
  const holidayPay = input.holidayPayWithWages ? round2(earnings * rates.holidayPayPaygRate) : 0;
  const weeklyGross = round2(earnings + holidayPay);
  return {
    pieceEarnings,
    effectiveHourly,
    minimumWageHourly,
    minimumForHours,
    belowMinimumWage,
    topUp,
    earnings,
    holidayPay,
    weeklyGross,
    annualGross: round2(weeklyGross * PAYE_WEEKS_PER_YEAR),
  };
}

export type PieceRateResult = PieceRateGross & {
  paye: PayeBreakdown;
  weeklyTakeHome: number;
};

/** Piece rate through the existing PAYE engine (PAYE, ACC, KiwiSaver, student loan, credits). */
export function calculatePieceRate(
  input: PieceRateInput,
  payeOptions: PieceRatePayeOptions,
  rates: PayTaxYearRates = payTaxYearRates(),
): PieceRateResult {
  const gross = pieceRateGross(input, rates);
  const paye = calculatePaye({
    ...payeOptions,
    taxYear: rates.startYear,
    amount: gross.weeklyGross,
    frequency: 'week',
    hoursPerWeek: nonNeg(input.hoursPerWeek),
  });
  return { ...gross, paye, weeklyTakeHome: round2(paye.takeHome / PAYE_WEEKS_PER_YEAR) };
}

export type SchedularInput = {
  ratePerUnit: number;
  /** Units or jobs per week. */
  unitsPerWeek: number;
  /** Withholding rate in percent (standard for the activity, elected, or tailored). */
  withholdingRatePct: number;
  gstRegistered: boolean;
};

export type SchedularResult = {
  /** GST-exclusive amount earned. */
  weeklyGross: number;
  /** GST added on top when registered (owed to IRD in the GST return). */
  weeklyGst: number;
  /** What is invoiced: gross + GST. */
  weeklyInvoice: number;
  /** Withholding tax on the GST-exclusive amount. */
  weeklyTaxWithheld: number;
  /** Paid into the bank: invoice − withholding. */
  weeklyPaid: number;
  /** Paid excluding GST: gross − withholding. This is the figure that is yours to spend. */
  weeklyNet: number;
  annualGross: number;
  annualTaxWithheld: number;
  annualNet: number;
  withholdingRate: number;
  notes: string[];
};

export function calculateSchedular(input: SchedularInput, rates: PayTaxYearRates = payTaxYearRates()): SchedularResult {
  const weeklyGross = round2(nonNeg(input.ratePerUnit) * nonNeg(input.unitsPerWeek));
  const withholdingRate = Math.min(1, nonNeg(input.withholdingRatePct) / 100);
  const weeklyGst = input.gstRegistered ? round2(weeklyGross * rates.gstRate) : 0;
  const weeklyInvoice = round2(weeklyGross + weeklyGst);
  const weeklyTaxWithheld = round2(weeklyGross * withholdingRate);
  const weeklyPaid = round2(weeklyInvoice - weeklyTaxWithheld);
  const weeklyNet = round2(weeklyGross - weeklyTaxWithheld);
  const notes = [
    'Schedular payments use tax code WT. Withholding tax is taken instead of PAYE — no PAYE, KiwiSaver or student loan is deducted by the payer.',
    'Withholding is a prepayment. You file an income tax return after 31 March; tax may still be due (or refunded) once expenses are counted.',
    'ACC invoices you directly for levies on self-employed income. Provisional tax may apply if residual income tax is over $5,000.',
  ];
  if (input.gstRegistered) {
    notes.push(
      `GST registered: withholding is worked out on the GST-exclusive amount. The ${round2(rates.gstRate * 100)}% GST you invoice is owed to IRD in your GST return.`,
    );
  }
  if (withholdingRate > 0 && withholdingRate < rates.schedularElectedMinRate) {
    notes.push(
      `A rate below ${round2(rates.schedularElectedMinRate * 100)}% needs a tailored tax rate certificate (IR23BS).`,
    );
  }
  return {
    weeklyGross,
    weeklyGst,
    weeklyInvoice,
    weeklyTaxWithheld,
    weeklyPaid,
    weeklyNet,
    annualGross: round2(weeklyGross * PAYE_WEEKS_PER_YEAR),
    annualTaxWithheld: round2(weeklyTaxWithheld * PAYE_WEEKS_PER_YEAR),
    annualNet: round2(weeklyNet * PAYE_WEEKS_PER_YEAR),
    withholdingRate,
    notes,
  };
}

export type CatchPeriod = 'trip' | 'week';

export type ShareOfCatchInput = {
  /** Catch value for one trip or one week. */
  catchValue: number;
  per: CatchPeriod;
  /** Trips per week when catchValue is per trip. */
  tripsPerWeek: number;
  sharePct: number;
  /** Your own costs per week (gear, food, travel). Optional. */
  expensesPerWeek: number;
};

export type ShareOfCatchResult = {
  weeklyCatchValue: number;
  weeklyShare: number;
  weeklyExpenses: number;
  /** Share − expenses. No tax is taken at source. */
  weeklyNet: number;
  annualShare: number;
  annualNet: number;
  /** Income tax on annualNet if it were the only income — a guide, not an assessment. */
  estimatedAnnualIncomeTax: number;
  notes: string[];
};

export function weeklyCatchValue(input: Pick<ShareOfCatchInput, 'catchValue' | 'per' | 'tripsPerWeek'>): number {
  const value = nonNeg(input.catchValue);
  return round2(input.per === 'trip' ? value * nonNeg(input.tripsPerWeek) : value);
}

export function calculateShareOfCatch(input: ShareOfCatchInput): ShareOfCatchResult {
  const weekly = weeklyCatchValue(input);
  const share = Math.min(100, nonNeg(input.sharePct)) / 100;
  const weeklyShare = round2(weekly * share);
  const weeklyExpenses = round2(nonNeg(input.expensesPerWeek));
  const weeklyNet = round2(weeklyShare - weeklyExpenses);
  const annualNet = round2(weeklyNet * PAYE_WEEKS_PER_YEAR);
  const estimatedAnnualIncomeTax = round2(calcIncomeTax(annualNet));
  return {
    weeklyCatchValue: weekly,
    weeklyShare,
    weeklyExpenses,
    weeklyNet,
    annualShare: round2(weeklyShare * PAYE_WEEKS_PER_YEAR),
    annualNet,
    estimatedAnnualIncomeTax,
    notes: [
      'Share fishing is self-employed income: no PAYE is deducted. You pay income tax through your end-of-year return (and provisional tax if residual income tax is over $5,000).',
      'ACC invoices you directly for levies on self-employed earnings.',
      'If the boat operator takes schedular withholding tax (IR330C activity 12, 20%), use Contract (schedular) instead.',
    ],
  };
}

export type PayRangePoint = { label: 'Low' | 'Typical' | 'High'; quantity: number; weeklyGross: number; weeklyNet: number };

/**
 * Low / typical / high week. `quantity` is the thing that moves week to week
 * (units for piece rate and contract, weekly catch value for share of catch).
 * Low and high are skipped when blank.
 */
export function payRange(
  typical: number,
  low: number | null,
  high: number | null,
  figures: (quantity: number) => { weeklyGross: number; weeklyNet: number },
): PayRangePoint[] {
  const out: PayRangePoint[] = [];
  const add = (label: PayRangePoint['label'], q: number | null) => {
    if (q == null || !Number.isFinite(q) || q < 0) return;
    out.push({ label, quantity: q, ...figures(q) });
  };
  add('Low', low);
  add('Typical', typical);
  add('High', high);
  return out;
}

/** Inputs stored on a saved pay source. The server recomputes figures from these. */
export type OutputPaySourceInputs =
  | {
      payType: 'piece';
      unit: string;
      piece: PieceRateInput;
      paye: PieceRatePayeOptions;
    }
  | { payType: 'schedular'; unit: string; schedular: SchedularInput; activityNumber: number | null }
  | { payType: 'share_of_catch'; shareOfCatch: ShareOfCatchInput };

/**
 * Typical weekly figures for a saved source.
 * weeklyNet is what lands in the user's pocket: piece take-home after PAYE etc.;
 * schedular paid excluding GST; share of catch after expenses (tax is due at year-end).
 */
export function outputPaySourceFigures(
  inputs: OutputPaySourceInputs,
  rates: PayTaxYearRates = payTaxYearRates(),
): { weeklyGross: number; weeklyNet: number } {
  switch (inputs.payType) {
    case 'piece': {
      const r = calculatePieceRate(inputs.piece, inputs.paye, rates);
      return { weeklyGross: r.weeklyGross, weeklyNet: r.weeklyTakeHome };
    }
    case 'schedular': {
      const r = calculateSchedular(inputs.schedular, rates);
      return { weeklyGross: r.weeklyGross, weeklyNet: r.weeklyNet };
    }
    case 'share_of_catch': {
      const r = calculateShareOfCatch(inputs.shareOfCatch);
      return { weeklyGross: r.weeklyShare, weeklyNet: r.weeklyNet };
    }
  }
}

/** Weekly → calendar month (52 weeks ÷ 12). */
export function weeklyToMonthly(weekly: number): number {
  return round2((weekly * PAYE_WEEKS_PER_YEAR) / 12);
}
