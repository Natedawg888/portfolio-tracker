/**
 * Settings → Business form helpers (KAN-71): formatting as you type and the inline
 * messages for the bank account, GST number, NZBN and invoice prefix.
 * Format checks only. The server (server/invoices/model.ts) still validates GST and NZBN on save.
 */
import { DEFAULT_INVOICE_PREFIX, nextInvoiceNumber } from './invoiceCalc.ts';
import type { BusinessProfile } from '../types/index.ts';

export type FieldCheck = {
  /** ok: shown with a ✓. hint: neutral guidance. error: blocks saving. */
  tone: 'ok' | 'hint' | 'error';
  text: string;
};

export function digitsOf(value: string): string {
  return value.replace(/\D/g, '');
}

/** Join digit groups with hyphens. A hyphen appears only once the next group has a digit. */
function group(digits: string, sizes: number[]): string {
  const parts: string[] = [];
  let at = 0;
  for (const size of sizes) {
    if (at >= digits.length) break;
    parts.push(digits.slice(at, at + size));
    at += size;
  }
  return parts.join('-');
}

// ---------------------------------------------------------------- bank account

/** NZ account: bank (2) - branch (4) - account (7) - suffix (2 or 3). 15 or 16 digits. */
export function formatBankAccount(value: string): string {
  return group(digitsOf(value).slice(0, 16), [2, 4, 7, 3]);
}

/** Only digits, hyphens and spaces count as an account number someone typed. */
function bankLooksNumeric(value: string): boolean {
  return /^[\d\s-]*$/.test(value);
}

/** Saved values with the right number of digits are shown in the standard format; anything else is left as saved. */
export function normalizeSavedBankAccount(value: string): string {
  const digits = digitsOf(value);
  if (bankLooksNumeric(value) && (digits.length === 15 || digits.length === 16)) return formatBankAccount(value);
  return value;
}

export function checkBankAccount(value: string): FieldCheck {
  const v = value.trim();
  if (!v) return { tone: 'hint', text: 'Bank-branch-account-suffix, for example 12-3456-7890123-00.' };
  if (!bankLooksNumeric(v)) return { tone: 'error', text: 'Use numbers only, for example 12-3456-7890123-00.' };
  const n = digitsOf(v).length;
  if (n === 15 || n === 16) return { tone: 'ok', text: 'Looks like a valid NZ account number format' };
  return {
    tone: 'error',
    text: `NZ account numbers have 15 or 16 digits. This has ${n}.`,
  };
}

// ---------------------------------------------------------------- GST number

/** 9 digits → 123-456-789. Exactly 8 → 12-345-678. */
export function formatGstNumber(value: string): string {
  const digits = digitsOf(value).slice(0, 9);
  return digits.length === 8 ? group(digits, [2, 3, 3]) : group(digits, [3, 3, 3]);
}

export function checkGstNumber(value: string, registered: boolean): FieldCheck {
  const n = digitsOf(value).length;
  if (n === 0) {
    return registered
      ? { tone: 'error', text: 'Required while GST registered. 8 or 9 digits, for example 123-456-789.' }
      : { tone: 'hint', text: '8 or 9 digits, for example 123-456-789.' };
  }
  if (n === 8 || n === 9) return { tone: 'ok', text: 'Looks like a valid GST number format' };
  return { tone: 'error', text: `GST numbers have 8 or 9 digits. This has ${n}.` };
}

// ---------------------------------------------------------------- NZBN

export function formatNzbn(value: string): string {
  return digitsOf(value).slice(0, 13);
}

export function checkNzbn(value: string): FieldCheck {
  const n = digitsOf(value).length;
  if (n === 0) return { tone: 'hint', text: '13 digits. Leave blank if you don’t have one.' };
  if (n === 13) return { tone: 'ok', text: 'Looks like a valid NZBN format' };
  return { tone: 'error', text: `An NZBN has 13 digits. This has ${n}.` };
}

// ---------------------------------------------------------------- invoice prefix

/** The prefix the server will save: trimmed, and INV- when blank. */
export function effectivePrefix(value: string): string {
  return value.trim() || DEFAULT_INVOICE_PREFIX;
}

export function checkInvoicePrefix(value: string): FieldCheck | null {
  if (/\d$/.test(value.trim())) {
    return { tone: 'error', text: 'The prefix can’t end in a number, or it would run into the invoice number.' };
  }
  return null;
}

/**
 * "Next invoice: INV-0003, then INV-0004", from the numbers already used.
 * Same rule as the server (nextInvoiceNumber), so it matches what the next invoice gets.
 */
export function nextNumbersLine(prefix: string, usedNumbers: string[]): string {
  const p = effectivePrefix(prefix);
  const first = nextInvoiceNumber(usedNumbers, p);
  const second = nextInvoiceNumber([...usedNumbers, first], p);
  return `Next invoice: ${first}, then ${second}`;
}

// ---------------------------------------------------------------- caret

/**
 * Where the caret goes after reformatting: just after the same number of digits
 * that were before it, so typing or deleting mid-number doesn't jump to the end.
 */
export function caretAfterFormat(formatted: string, digitsBeforeCaret: number): number {
  if (digitsBeforeCaret <= 0) return 0;
  let seen = 0;
  for (let i = 0; i < formatted.length; i++) {
    if (/\d/.test(formatted[i])) seen++;
    if (seen === digitsBeforeCaret) return i + 1;
  }
  return formatted.length;
}

/**
 * Apply a keystroke to a formatted number field. Returns the new value and caret.
 * Backspace over a hyphen removes the digit before it, so the hyphen can't trap the caret.
 */
export function applyFormattedInput(
  prev: string,
  raw: string,
  caret: number,
  format: (value: string) => string,
): { value: string; caret: number } {
  let digitsBefore = digitsOf(raw.slice(0, caret)).length;
  let source = raw;
  if (raw.length < prev.length && digitsOf(raw) === digitsOf(prev) && digitsBefore > 0) {
    const all = digitsOf(raw);
    source = all.slice(0, digitsBefore - 1) + all.slice(digitsBefore);
    digitsBefore -= 1;
  }
  const value = format(source);
  return { value, caret: caretAfterFormat(value, digitsBefore) };
}

// ---------------------------------------------------------------- unsaved changes

/** Fields that differ from what's saved. Hidden GST number doesn't count while GST is off. */
export function changedFields(saved: BusinessProfile, form: BusinessProfile): (keyof BusinessProfile)[] {
  const keys = Object.keys(saved) as (keyof BusinessProfile)[];
  return keys.filter((k) => {
    if (k === 'gstNumber' && !form.gstRegistered && !saved.gstRegistered) return false;
    const a = saved[k];
    const b = form[k];
    return typeof a === 'string' && typeof b === 'string' ? a.trim() !== b.trim() : a !== b;
  });
}
