/**
 * Mask bank account numbers inside display text.
 * Akahu names cash accounts "Main · 38-9014-0109286-01" (cashAccountDisplayName).
 * NZ numbers become "••••286-01": last 3 digits of the account body plus the suffix.
 */
const NZ_ACCOUNT = /\b\d{2}-\d{4}-(\d{7,8})-(\d{2,3})\b/g;
/** Any other long run of digits (spaces or dashes allowed): keep the last 3. */
const LONG_NUMBER = /\b\d(?:[\d -]{6,})\d\b/g;

export const ACCOUNT_MASK = '••••';

export function maskAccountNumbers(text: string): string {
  return text
    .replace(NZ_ACCOUNT, (_m, body: string, suffix: string) => `${ACCOUNT_MASK}${body.slice(-3)}-${suffix}`)
    .replace(LONG_NUMBER, (m) => {
      const digits = m.replace(/\D/g, '');
      return digits.length >= 8 ? `${ACCOUNT_MASK}${digits.slice(-3)}` : m;
    });
}
