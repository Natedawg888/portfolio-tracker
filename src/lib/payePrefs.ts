/**
 * Persist PAYE calculator inputs (esp. investing + charity credits) in localStorage
 * so applied credits restore on page load.
 *
 * Investing credits: never seed $0 placeholder rows. Empty = [].
 * Portfolio/income auto-fill (Paye.tsx) only adds rows when real NZD exists.
 */

import type { EmploymentKind, PayFrequency } from './payeCalc';
import {
  KIWISAVER_ACCOUNT_DEFAULT_EMPLOYEE_RATE,
  KIWISAVER_EMPLOYER_MIN_RATE,
  PAYE_DEFAULT_HOURS_PER_WEEK,
  type InvestingCreditKind,
  INVESTING_CREDIT_KIND_OPTIONS,
} from './payeRates';

export const PAYE_PREFS_STORAGE_KEY = 'portfolio-tracker-paye-prefs';

export type PersistedCreditDraft = {
  id: string;
  kind: InvestingCreditKind;
  label: string;
  annualAmount: string;
};

/** Budget Charity txn linked into PAYE IR526 donation credits. */
export type CharityDonationLink = {
  txnId: string;
  amountNzd: number;
  date: string;
  description: string;
  receiptUrl?: string | null;
};

/** Pay type selector on the PAYE page. Output-paid types are KAN-70. */
export type PayePayType = 'salary' | 'hourly' | 'piece' | 'schedular' | 'share_of_catch';

const PAY_TYPES: PayePayType[] = ['salary', 'hourly', 'piece', 'schedular', 'share_of_catch'];

export type PayePrefs = {
  payType: PayePayType;
  amount: string;
  frequency: PayFrequency;
  hoursPerWeek: string;
  employment: EmploymentKind;
  secondaryTotal: string;
  otherAnnual: string;
  kiwiSaverOptIn: boolean;
  ksRate: string;
  ksCustom: boolean;
  ksEmployerRate: string;
  salarySacrifice: boolean;
  studentLoan: boolean;
  ietc: boolean;
  payrollGivingOn: boolean;
  payrollGivingAnnual: string;
  /** Annual donations outside payroll (IR526 donation tax credit). */
  charityDonationsOn: boolean;
  charityDonationsAnnual: string;
  /** Donations linked from Budget Charity transactions (drives annual when present). */
  charityLinks: CharityDonationLink[];
  extraCredits: PersistedCreditDraft[];
};

const KIND_SET = new Set<string>(INVESTING_CREDIT_KIND_OPTIONS.map((o) => o.kind));

function newCreditId(): string {
  return `c-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`;
}

/**
 * No invented investing-credit rows. First visit / empty prefs → [].
 * Manual Add credit and portfolio/income auto-fill (when real NZD exists) populate this.
 */
export function defaultInvestingCreditDrafts(): PersistedCreditDraft[] {
  return [];
}

export function defaultPayePrefs(): PayePrefs {
  return {
    payType: 'salary',
    amount: '75000',
    frequency: 'year',
    hoursPerWeek: String(PAYE_DEFAULT_HOURS_PER_WEEK),
    employment: 'primary',
    secondaryTotal: '90000',
    otherAnnual: '70000',
    kiwiSaverOptIn: true,
    ksRate: String(KIWISAVER_ACCOUNT_DEFAULT_EMPLOYEE_RATE),
    ksCustom: false,
    ksEmployerRate: String(KIWISAVER_EMPLOYER_MIN_RATE),
    salarySacrifice: false,
    studentLoan: false,
    ietc: true,
    payrollGivingOn: false,
    payrollGivingAnnual: '0',
    charityDonationsOn: false,
    charityDonationsAnnual: '0',
    charityLinks: [],
    extraCredits: defaultInvestingCreditDrafts(),
  };
}

function normalizeCredit(raw: unknown): PersistedCreditDraft | null {
  if (!raw || typeof raw !== 'object') return null;
  const o = raw as Record<string, unknown>;
  const kind = typeof o.kind === 'string' && KIND_SET.has(o.kind) ? (o.kind as InvestingCreditKind) : null;
  if (!kind) return null;
  const id = typeof o.id === 'string' && o.id.trim() ? o.id : newCreditId();
  const annualAmount =
    typeof o.annualAmount === 'string'
      ? o.annualAmount
      : typeof o.annualAmount === 'number' && Number.isFinite(o.annualAmount)
        ? String(o.annualAmount)
        : '0';
  // Drop legacy first-visit $0 seeds (default-imputation / default-rwt).
  if (id.startsWith('default-') && !(Number(annualAmount) > 0)) return null;
  return {
    id,
    kind,
    label: typeof o.label === 'string' ? o.label : '',
    annualAmount,
  };
}

export function normalizePayePrefs(raw: unknown): PayePrefs {
  const base = defaultPayePrefs();
  if (!raw || typeof raw !== 'object') return base;
  const o = raw as Record<string, unknown>;

  if (typeof o.amount === 'string') base.amount = o.amount;
  else if (typeof o.amount === 'number' && Number.isFinite(o.amount)) base.amount = String(o.amount);

  const freqs: PayFrequency[] = ['hour', 'week', 'fortnight', 'month', 'year'];
  if (typeof o.frequency === 'string' && freqs.includes(o.frequency as PayFrequency)) {
    base.frequency = o.frequency as PayFrequency;
  }
  if (typeof o.payType === 'string' && PAY_TYPES.includes(o.payType as PayePayType)) {
    base.payType = o.payType as PayePayType;
  } else {
    // Saved before the pay type selector: an hourly frequency meant hourly pay.
    base.payType = base.frequency === 'hour' ? 'hourly' : 'salary';
  }
  if (typeof o.hoursPerWeek === 'string') base.hoursPerWeek = o.hoursPerWeek;
  if (o.employment === 'primary' || o.employment === 'secondary') base.employment = o.employment;
  if (typeof o.secondaryTotal === 'string') base.secondaryTotal = o.secondaryTotal;
  if (typeof o.otherAnnual === 'string') base.otherAnnual = o.otherAnnual;
  if (typeof o.kiwiSaverOptIn === 'boolean') base.kiwiSaverOptIn = o.kiwiSaverOptIn;
  if (typeof o.ksRate === 'string') base.ksRate = o.ksRate;
  if (typeof o.ksCustom === 'boolean') base.ksCustom = o.ksCustom;
  if (typeof o.ksEmployerRate === 'string') base.ksEmployerRate = o.ksEmployerRate;
  if (typeof o.salarySacrifice === 'boolean') base.salarySacrifice = o.salarySacrifice;
  if (typeof o.studentLoan === 'boolean') base.studentLoan = o.studentLoan;
  if (typeof o.ietc === 'boolean') base.ietc = o.ietc;
  if (typeof o.payrollGivingOn === 'boolean') base.payrollGivingOn = o.payrollGivingOn;
  if (typeof o.payrollGivingAnnual === 'string') base.payrollGivingAnnual = o.payrollGivingAnnual;
  if (typeof o.charityDonationsOn === 'boolean') base.charityDonationsOn = o.charityDonationsOn;
  if (typeof o.charityDonationsAnnual === 'string') base.charityDonationsAnnual = o.charityDonationsAnnual;
  else if (typeof o.charityDonationsAnnual === 'number' && Number.isFinite(o.charityDonationsAnnual)) {
    base.charityDonationsAnnual = String(o.charityDonationsAnnual);
  }

  if (Array.isArray(o.charityLinks)) {
    const links: CharityDonationLink[] = [];
    for (const raw of o.charityLinks) {
      if (!raw || typeof raw !== 'object') continue;
      const L = raw as Record<string, unknown>;
      if (typeof L.txnId !== 'string' || !L.txnId.trim()) continue;
      const amount =
        typeof L.amountNzd === 'number' && Number.isFinite(L.amountNzd)
          ? L.amountNzd
          : typeof L.amountNzd === 'string'
            ? Number(L.amountNzd)
            : NaN;
      if (!Number.isFinite(amount)) continue;
      links.push({
        txnId: L.txnId.trim(),
        amountNzd: Math.abs(amount),
        date: typeof L.date === 'string' ? L.date : '',
        description: typeof L.description === 'string' ? L.description : '',
        receiptUrl: typeof L.receiptUrl === 'string' ? L.receiptUrl : L.receiptUrl === null ? null : null,
      });
    }
    base.charityLinks = links;
    if (links.length > 0) {
      const sum = Math.round(links.reduce((s, l) => s + l.amountNzd, 0) * 100) / 100;
      base.charityDonationsOn = true;
      base.charityDonationsAnnual = String(sum);
    }
  }

  if (Array.isArray(o.extraCredits)) {
    // Empty array stays empty — never re-seed $0 placeholders.
    base.extraCredits = o.extraCredits.map(normalizeCredit).filter(Boolean) as PersistedCreditDraft[];
  }

  return base;
}

export function loadPayePrefs(): PayePrefs {
  try {
    const raw = localStorage.getItem(PAYE_PREFS_STORAGE_KEY);
    if (!raw) return defaultPayePrefs();
    return normalizePayePrefs(JSON.parse(raw));
  } catch {
    return defaultPayePrefs();
  }
}

export function savePayePrefs(prefs: PayePrefs): void {
  try {
    localStorage.setItem(PAYE_PREFS_STORAGE_KEY, JSON.stringify(prefs));
  } catch {
    /* private mode / blocked storage */
  }
}
