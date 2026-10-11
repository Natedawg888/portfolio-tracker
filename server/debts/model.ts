/**
 * Debt request parsing. The interest schedule and payoff projection live in
 * src/lib/debtModel.ts (shared with the Debts page) and are re-exported here,
 * so server code keeps importing from this module.
 */
export * from '../../src/lib/debtModel.ts';
import {
  normaliseCreditorKind,
  roundMoney,
  type DebtInput,
  type DebtProductKind,
  type InterestPeriod,
} from '../../src/lib/debtModel.ts';

export function parseProductKind(
  raw: unknown,
): { ok: true; value: DebtProductKind | null } | { ok: false; error: string } {
  if (raw == null || raw === '') return { ok: true, value: null };
  if (typeof raw !== 'string') {
    return { ok: false, error: 'productKind must be a debt kind or blank' };
  }
  const v = raw.trim().toLowerCase().replace(/[\s-]+/g, '_');
  const aliases: Record<string, DebtProductKind> = {
    credit_card: 'credit_card',
    creditcard: 'credit_card',
    personal_loan: 'personal_loan',
    personalloan: 'personal_loan',
    student_loan: 'student_loan',
    studentloan: 'student_loan',
    car_loan: 'car_loan',
    carloan: 'car_loan',
    auto_loan: 'car_loan',
    mortgage: 'mortgage',
    bnpl: 'bnpl',
    buy_now_pay_later: 'bnpl',
  };
  const kind = aliases[v];
  if (!kind) {
    return {
      ok: false,
      error: 'productKind must be credit_card, personal_loan, student_loan, car_loan, mortgage, or bnpl',
    };
  }
  return { ok: true, value: kind };
}

export function parseInterestPeriod(
  raw: unknown,
): { ok: true; value: InterestPeriod | null } | { ok: false; error: string } {
  if (raw == null || raw === '' || raw === 'none') return { ok: true, value: null };
  if (typeof raw !== 'string') {
    return { ok: false, error: 'interestPeriod must be month, year, or blank' };
  }
  const v = raw.trim().toLowerCase();
  if (v === 'month' || v === 'monthly') return { ok: true, value: 'month' };
  if (v === 'year' || v === 'yearly' || v === 'annual') return { ok: true, value: 'year' };
  if (v === 'none' || v === 'no') return { ok: true, value: null };
  return { ok: false, error: 'interestPeriod must be month, year, or blank' };
}

function parseRequiredAmount(
  raw: unknown,
  label: string,
): { ok: true; value: number } | { ok: false; error: string } {
  const n = typeof raw === 'number' ? raw : typeof raw === 'string' && raw.trim() ? Number(raw.trim()) : Number.NaN;
  if (!Number.isFinite(n) || n < 0) {
    return { ok: false, error: `${label} must be a non-negative number` };
  }
  return { ok: true, value: roundMoney(n) };
}

function parseOptionalAmount(
  raw: unknown,
  label: string,
): { ok: true; value: number | null } | { ok: false; error: string } {
  if (raw == null || raw === '') return { ok: true, value: null };
  const parsed = parseRequiredAmount(raw, label);
  if (!parsed.ok) return { ok: false, error: `${label} must be a non-negative number or blank` };
  return parsed;
}

function parseOptionalRate(
  raw: unknown,
): { ok: true; value: number | null } | { ok: false; error: string } {
  const parsed = parseOptionalAmount(raw, 'interestRatePercent');
  if (!parsed.ok) return parsed;
  if (parsed.value != null && parsed.value > 100) {
    return { ok: false, error: 'interestRatePercent must be between 0 and 100, or blank' };
  }
  return parsed;
}

function parseOptionalMonths(
  raw: unknown,
): { ok: true; value: number | null } | { ok: false; error: string } {
  if (raw == null || raw === '') return { ok: true, value: null };
  const n = typeof raw === 'number' ? raw : typeof raw === 'string' && raw.trim() ? Number(raw.trim()) : Number.NaN;
  if (!Number.isFinite(n) || n < 0 || Math.floor(n) !== n) {
    return { ok: false, error: 'remainingTermMonths must be a whole number of months or blank' };
  }
  return { ok: true, value: n };
}

function parseIsLoan(raw: unknown): { ok: true; value: boolean } | { ok: false; error: string } {
  if (typeof raw === 'boolean') return { ok: true, value: raw };
  return { ok: false, error: 'isLoan must be true or false' };
}

function hasKey(body: Record<string, unknown>, key: string): boolean {
  return Object.prototype.hasOwnProperty.call(body, key);
}

function asBody(body: unknown): Record<string, unknown> {
  return body && typeof body === 'object' ? (body as Record<string, unknown>) : {};
}

export function parseCreateDebt(
  body: unknown,
): { ok: true; value: DebtInput } | { ok: false; error: string } {
  const b = asBody(body);
  const name = typeof b.name === 'string' ? b.name.trim() : '';
  if (!name) return { ok: false, error: 'name is required' };
  const outstanding = parseRequiredAmount(b.outstandingNzd ?? 0, 'outstandingNzd');
  if (!outstanding.ok) return outstanding;
  const product = parseProductKind(hasKey(b, 'productKind') ? b.productKind : null);
  if (!product.ok) return product;
  const period = parseInterestPeriod(hasKey(b, 'interestPeriod') ? b.interestPeriod : null);
  if (!period.ok) return period;
  const rate = parseOptionalRate(hasKey(b, 'interestRatePercent') ? b.interestRatePercent : null);
  if (!rate.ok) return rate;
  const minimum = parseOptionalAmount(
    hasKey(b, 'minimumPaymentNzd') ? b.minimumPaymentNzd : null,
    'minimumPaymentNzd',
  );
  if (!minimum.ok) return minimum;
  const actual = parseOptionalAmount(
    hasKey(b, 'actualPaymentNzd') ? b.actualPaymentNzd : null,
    'actualPaymentNzd',
  );
  if (!actual.ok) return actual;
  const term = parseOptionalMonths(hasKey(b, 'remainingTermMonths') ? b.remainingTermMonths : null);
  if (!term.ok) return term;
  const interestPaid = parseOptionalAmount(
    hasKey(b, 'interestPaidNzd') ? b.interestPaidNzd : null,
    'interestPaidNzd',
  );
  if (!interestPaid.ok) return interestPaid;
  let isLoan = false;
  if (hasKey(b, 'isLoan')) {
    const parsed = parseIsLoan(b.isLoan);
    if (!parsed.ok) return parsed;
    isLoan = parsed.value;
  }
  const notes =
    typeof b.notes === 'string' && b.notes.trim() ? b.notes.trim() : null;
  return {
    ok: true,
    value: {
      name,
      kind: normaliseCreditorKind(b.kind ?? b.type),
      notes,
      outstandingNzd: outstanding.value,
      productKind: product.value,
      isLoan,
      interestPeriod: period.value,
      interestRatePercent: rate.value,
      minimumPaymentNzd: minimum.value,
      actualPaymentNzd: actual.value,
      remainingTermMonths: term.value,
      interestPaidNzd: interestPaid.value,
    },
  };
}

export function parsePatchDebt(
  body: unknown,
): { ok: true; value: Partial<DebtInput> } | { ok: false; error: string } {
  const b = asBody(body);
  const patch: Partial<DebtInput> = {};
  if (hasKey(b, 'name')) {
    const name = typeof b.name === 'string' ? b.name.trim() : '';
    if (!name) return { ok: false, error: 'name is required' };
    patch.name = name;
  }
  if (hasKey(b, 'kind') || hasKey(b, 'type')) {
    patch.kind = normaliseCreditorKind(hasKey(b, 'kind') ? b.kind : b.type);
  }
  if (hasKey(b, 'notes')) {
    if (b.notes != null && typeof b.notes !== 'string') {
      return { ok: false, error: 'notes must be a string or null' };
    }
    patch.notes = typeof b.notes === 'string' && b.notes.trim() ? b.notes.trim() : null;
  }
  if (hasKey(b, 'outstandingNzd')) {
    const outstanding = parseRequiredAmount(b.outstandingNzd, 'outstandingNzd');
    if (!outstanding.ok) return outstanding;
    patch.outstandingNzd = outstanding.value;
  }
  if (hasKey(b, 'productKind')) {
    const product = parseProductKind(b.productKind);
    if (!product.ok) return product;
    patch.productKind = product.value;
  }
  if (hasKey(b, 'isLoan')) {
    const parsed = parseIsLoan(b.isLoan);
    if (!parsed.ok) return parsed;
    patch.isLoan = parsed.value;
  }
  if (hasKey(b, 'interestPeriod')) {
    const period = parseInterestPeriod(b.interestPeriod);
    if (!period.ok) return period;
    patch.interestPeriod = period.value;
  }
  if (hasKey(b, 'interestRatePercent')) {
    const rate = parseOptionalRate(b.interestRatePercent);
    if (!rate.ok) return rate;
    patch.interestRatePercent = rate.value;
  }
  if (hasKey(b, 'minimumPaymentNzd')) {
    const minimum = parseOptionalAmount(b.minimumPaymentNzd, 'minimumPaymentNzd');
    if (!minimum.ok) return minimum;
    patch.minimumPaymentNzd = minimum.value;
  }
  if (hasKey(b, 'actualPaymentNzd')) {
    const actual = parseOptionalAmount(b.actualPaymentNzd, 'actualPaymentNzd');
    if (!actual.ok) return actual;
    patch.actualPaymentNzd = actual.value;
  }
  if (hasKey(b, 'remainingTermMonths')) {
    const term = parseOptionalMonths(b.remainingTermMonths);
    if (!term.ok) return term;
    patch.remainingTermMonths = term.value;
  }
  if (hasKey(b, 'interestPaidNzd')) {
    const interestPaid = parseOptionalAmount(b.interestPaidNzd, 'interestPaidNzd');
    if (!interestPaid.ok) return interestPaid;
    patch.interestPaidNzd = interestPaid.value;
  }
  return { ok: true, value: patch };
}
