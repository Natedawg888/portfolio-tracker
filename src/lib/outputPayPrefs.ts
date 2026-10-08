/**
 * Last-used piece rate / contract / share-of-catch inputs on the PAYE page (KAN-70).
 * Browser storage only, as a convenience — saved income sources live on the server.
 */

import type { CatchPeriod, OutputPaySourceInputs, PieceRatePayeOptions } from './outputPayCalc';
import type { PayTaxYearRates } from './payeRates';

export const OUTPUT_PAY_STORAGE_KEY = 'portfolio-tracker-output-pay';

export type OutputPayPrefs = {
  unit: string;
  // Piece rate
  pieceRate: string;
  unitsPerDay: string;
  daysPerWeek: string;
  pieceHours: string;
  holidayPay: boolean;
  pieceLow: string;
  pieceHigh: string;
  // Contract (schedular)
  contractRate: string;
  contractVolume: string;
  /** IR330C activity number as a string, or 'custom' for an elected / tailored rate. */
  activity: string;
  customWtRate: string;
  gstRegistered: boolean;
  contractLow: string;
  contractHigh: string;
  // Share of catch
  catchValue: string;
  catchPer: CatchPeriod;
  tripsPerWeek: string;
  sharePct: string;
  expensesPerWeek: string;
  catchLow: string;
  catchHigh: string;
};

export function defaultOutputPayPrefs(): OutputPayPrefs {
  return {
    unit: 'bin',
    pieceRate: '',
    unitsPerDay: '',
    daysPerWeek: '5',
    pieceHours: '40',
    holidayPay: false,
    pieceLow: '',
    pieceHigh: '',
    contractRate: '',
    contractVolume: '',
    activity: '3',
    customWtRate: '',
    gstRegistered: false,
    contractLow: '',
    contractHigh: '',
    catchValue: '',
    catchPer: 'trip',
    tripsPerWeek: '1',
    sharePct: '',
    expensesPerWeek: '',
    catchLow: '',
    catchHigh: '',
  };
}

export function normalizeOutputPayPrefs(raw: unknown): OutputPayPrefs {
  const base = defaultOutputPayPrefs();
  if (!raw || typeof raw !== 'object') return base;
  const o = raw as Record<string, unknown>;
  const out = { ...base } as Record<string, unknown>;
  for (const [key, value] of Object.entries(base)) {
    const v = o[key];
    if (typeof value === 'string' && typeof v === 'string') out[key] = v.slice(0, 60);
    else if (typeof value === 'boolean' && typeof v === 'boolean') out[key] = v;
  }
  out.catchPer = o.catchPer === 'week' ? 'week' : 'trip';
  return out as OutputPayPrefs;
}

export function loadOutputPayPrefs(): OutputPayPrefs {
  try {
    const raw = localStorage.getItem(OUTPUT_PAY_STORAGE_KEY);
    return raw ? normalizeOutputPayPrefs(JSON.parse(raw)) : defaultOutputPayPrefs();
  } catch {
    return defaultOutputPayPrefs();
  }
}

export function saveOutputPayPrefs(prefs: OutputPayPrefs): void {
  try {
    localStorage.setItem(OUTPUT_PAY_STORAGE_KEY, JSON.stringify(prefs));
  } catch {
    /* private mode / blocked storage */
  }
}

function n(text: string): number {
  const v = Number(text);
  return Number.isFinite(v) && v > 0 ? v : 0;
}

/** Withholding rate in percent for the chosen IR330C activity, or the custom rate. */
export function withholdingPct(prefs: OutputPayPrefs, rates: PayTaxYearRates): number {
  if (prefs.activity === 'custom') return n(prefs.customWtRate);
  const row = rates.schedularActivities.find((a) => String(a.number) === prefs.activity);
  return row ? Math.round(row.rate * 1000) / 10 : 0;
}

/** Optional low / high field: null when blank. */
export function optionalQuantity(text: string): number | null {
  if (!text.trim()) return null;
  const v = Number(text);
  return Number.isFinite(v) && v >= 0 ? v : null;
}

export function pieceUnitsPerWeek(p: OutputPayPrefs): number {
  return n(p.unitsPerDay) * n(p.daysPerWeek);
}

/** Calculator inputs for the selected pay type, as saved on an income source. */
export function prefsToSourceInputs(
  payType: OutputPaySourceInputs['payType'],
  p: OutputPayPrefs,
  paye: PieceRatePayeOptions,
  withholdingRatePct: number,
): OutputPaySourceInputs {
  switch (payType) {
    case 'piece':
      return {
        payType: 'piece',
        unit: p.unit,
        piece: {
          ratePerUnit: n(p.pieceRate),
          unitsPerWeek: pieceUnitsPerWeek(p),
          hoursPerWeek: n(p.pieceHours),
          holidayPayWithWages: p.holidayPay,
        },
        paye,
      };
    case 'schedular':
      return {
        payType: 'schedular',
        unit: p.unit,
        activityNumber: p.activity === 'custom' ? null : Number(p.activity) || null,
        schedular: {
          ratePerUnit: n(p.contractRate),
          unitsPerWeek: n(p.contractVolume),
          withholdingRatePct,
          gstRegistered: p.gstRegistered,
        },
      };
    case 'share_of_catch':
      return {
        payType: 'share_of_catch',
        shareOfCatch: {
          catchValue: n(p.catchValue),
          per: p.catchPer,
          tripsPerWeek: n(p.tripsPerWeek),
          sharePct: n(p.sharePct),
          expensesPerWeek: n(p.expensesPerWeek),
        },
      };
  }
}

/** Put a saved source's inputs back into the form. Units per day uses the saved days per week. */
export function sourceInputsToPrefs(inputs: OutputPaySourceInputs, current: OutputPayPrefs): OutputPayPrefs {
  const s = (v: number) => String(Math.round(v * 10000) / 10000);
  switch (inputs.payType) {
    case 'piece': {
      const days = n(current.daysPerWeek) || 5;
      return {
        ...current,
        unit: inputs.unit,
        pieceRate: s(inputs.piece.ratePerUnit),
        daysPerWeek: s(days),
        unitsPerDay: s(inputs.piece.unitsPerWeek / days),
        pieceHours: s(inputs.piece.hoursPerWeek),
        holidayPay: inputs.piece.holidayPayWithWages,
      };
    }
    case 'schedular':
      return {
        ...current,
        unit: inputs.unit,
        contractRate: s(inputs.schedular.ratePerUnit),
        contractVolume: s(inputs.schedular.unitsPerWeek),
        activity: inputs.activityNumber != null ? String(inputs.activityNumber) : 'custom',
        customWtRate: inputs.activityNumber != null ? current.customWtRate : s(inputs.schedular.withholdingRatePct),
        gstRegistered: inputs.schedular.gstRegistered,
      };
    case 'share_of_catch':
      return {
        ...current,
        catchValue: s(inputs.shareOfCatch.catchValue),
        catchPer: inputs.shareOfCatch.per,
        tripsPerWeek: s(inputs.shareOfCatch.tripsPerWeek),
        sharePct: s(inputs.shareOfCatch.sharePct),
        expensesPerWeek: s(inputs.shareOfCatch.expensesPerWeek),
      };
  }
}
