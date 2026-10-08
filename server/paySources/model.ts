/**
 * Validate a saved pay source body (KAN-70). The client sends calculator inputs only;
 * weekly figures are recomputed on the server with the same calculator the page uses.
 */
import type { OutputPaySourceInputs, PieceRatePayeOptions } from '../../src/lib/outputPayCalc.ts';
import { CURRENT_PAY_TAX_YEAR, PAY_TAX_YEARS } from '../../src/lib/payeRates.ts';

export type PaySourceDraft = {
  name: string;
  taxYear: number;
  inputs: OutputPaySourceInputs;
};

type Parsed<T> = { ok: true; value: T } | { ok: false; error: string };

const MAX_AMOUNT = 10_000_000;

function obj(raw: unknown): Record<string, unknown> | null {
  return raw && typeof raw === 'object' && !Array.isArray(raw) ? (raw as Record<string, unknown>) : null;
}

function num(o: Record<string, unknown>, key: string, label: string, max = MAX_AMOUNT): Parsed<number> {
  const raw = o[key];
  const n = typeof raw === 'number' ? raw : typeof raw === 'string' && raw.trim() ? Number(raw) : 0;
  if (!Number.isFinite(n) || n < 0 || n > max) {
    return { ok: false, error: `${label} must be a number from 0 to ${max}` };
  }
  return { ok: true, value: n };
}

function bool(o: Record<string, unknown>, key: string): boolean {
  return o[key] === true;
}

function unitLabel(raw: unknown): Parsed<string> {
  const unit = typeof raw === 'string' ? raw.trim() : '';
  if (!unit) return { ok: false, error: 'Unit is required' };
  if (unit.length > 40) return { ok: false, error: 'Unit must be 40 characters or fewer' };
  return { ok: true, value: unit };
}

function parsePayeOptions(raw: unknown): Parsed<PieceRatePayeOptions> {
  const o = obj(raw) ?? {};
  const employment = o.employment === 'secondary' ? 'secondary' : 'primary';
  const fields: Array<[string, string, number?]> = [
    ['secondaryTotalAnnualIncome', 'Total annual income'],
    ['otherAnnualGross', 'Other annual gross'],
    ['kiwiSaverEmployeeRatePct', 'KiwiSaver employee rate', 100],
    ['kiwiSaverEmployerRatePct', 'KiwiSaver employer rate', 100],
    ['payrollGivingAnnual', 'Payroll giving'],
  ];
  const values: Record<string, number> = {};
  for (const [key, label, max] of fields) {
    const p = num(o, key, label, max);
    if (!p.ok) return p;
    values[key] = p.value;
  }
  return {
    ok: true,
    value: {
      employment,
      secondaryTotalAnnualIncome: values.secondaryTotalAnnualIncome,
      otherAnnualGross: values.otherAnnualGross,
      kiwiSaverOptIn: bool(o, 'kiwiSaverOptIn'),
      kiwiSaverEmployeeRatePct: values.kiwiSaverEmployeeRatePct,
      kiwiSaverEmployerRatePct: values.kiwiSaverEmployerRatePct,
      salarySacrifice: bool(o, 'salarySacrifice'),
      studentLoan: bool(o, 'studentLoan'),
      ietc: bool(o, 'ietc'),
      payrollGivingAnnual: values.payrollGivingAnnual,
    },
  };
}

export function parsePaySourceInputs(raw: unknown): Parsed<OutputPaySourceInputs> {
  const o = obj(raw);
  if (!o) return { ok: false, error: 'inputs are required' };
  switch (o.payType) {
    case 'piece': {
      const unit = unitLabel(o.unit);
      if (!unit.ok) return unit;
      const p = obj(o.piece);
      if (!p) return { ok: false, error: 'piece inputs are required' };
      const rate = num(p, 'ratePerUnit', 'Rate per unit');
      if (!rate.ok) return rate;
      const units = num(p, 'unitsPerWeek', 'Units per week');
      if (!units.ok) return units;
      const hours = num(p, 'hoursPerWeek', 'Hours per week', 168);
      if (!hours.ok) return hours;
      const paye = parsePayeOptions(o.paye);
      if (!paye.ok) return paye;
      return {
        ok: true,
        value: {
          payType: 'piece',
          unit: unit.value,
          piece: {
            ratePerUnit: rate.value,
            unitsPerWeek: units.value,
            hoursPerWeek: hours.value,
            holidayPayWithWages: bool(p, 'holidayPayWithWages'),
          },
          paye: paye.value,
        },
      };
    }
    case 'schedular': {
      const unit = unitLabel(o.unit);
      if (!unit.ok) return unit;
      const s = obj(o.schedular);
      if (!s) return { ok: false, error: 'schedular inputs are required' };
      const rate = num(s, 'ratePerUnit', 'Rate per unit or job');
      if (!rate.ok) return rate;
      const units = num(s, 'unitsPerWeek', 'Volume per week');
      if (!units.ok) return units;
      const wt = num(s, 'withholdingRatePct', 'Withholding rate', 100);
      if (!wt.ok) return wt;
      const activity = Number(o.activityNumber);
      return {
        ok: true,
        value: {
          payType: 'schedular',
          unit: unit.value,
          activityNumber: Number.isInteger(activity) && activity > 0 ? activity : null,
          schedular: {
            ratePerUnit: rate.value,
            unitsPerWeek: units.value,
            withholdingRatePct: wt.value,
            gstRegistered: bool(s, 'gstRegistered'),
          },
        },
      };
    }
    case 'share_of_catch': {
      const c = obj(o.shareOfCatch);
      if (!c) return { ok: false, error: 'share of catch inputs are required' };
      const value = num(c, 'catchValue', 'Catch value');
      if (!value.ok) return value;
      const trips = num(c, 'tripsPerWeek', 'Trips per week', 50);
      if (!trips.ok) return trips;
      const share = num(c, 'sharePct', 'Share', 100);
      if (!share.ok) return share;
      const expenses = num(c, 'expensesPerWeek', 'Expenses per week');
      if (!expenses.ok) return expenses;
      return {
        ok: true,
        value: {
          payType: 'share_of_catch',
          shareOfCatch: {
            catchValue: value.value,
            per: c.per === 'trip' ? 'trip' : 'week',
            tripsPerWeek: trips.value,
            sharePct: share.value,
            expensesPerWeek: expenses.value,
          },
        },
      };
    }
    default:
      return { ok: false, error: 'payType must be piece, schedular or share_of_catch' };
  }
}

export function parsePaySourceBody(raw: unknown): Parsed<PaySourceDraft> {
  const o = obj(raw);
  if (!o) return { ok: false, error: 'Body is required' };
  const name = typeof o.name === 'string' ? o.name.trim().replace(/\s+/g, ' ') : '';
  if (!name) return { ok: false, error: 'Name is required' };
  if (name.length > 120) return { ok: false, error: 'Name must be 120 characters or fewer' };
  const year = o.taxYear == null ? CURRENT_PAY_TAX_YEAR : Number(o.taxYear);
  if (!Number.isInteger(year) || !PAY_TAX_YEARS[year]) {
    return { ok: false, error: 'taxYear must be a tax year with published rates' };
  }
  const inputs = parsePaySourceInputs(o.inputs);
  if (!inputs.ok) return inputs;
  return { ok: true, value: { name, taxYear: year, inputs: inputs.value } };
}
