/** Reserved mailbox for a business account created from a personal one. Never sent to clients. */
export const LINKED_ACCOUNT_EMAIL_DOMAIN = 'accounts.koruledger.invalid';

/** True for the reserved address stored on a business account created from a personal one. */
export function isSyntheticLinkedEmail(email: string | null | undefined): boolean {
  const value = String(email ?? '').trim().toLowerCase();
  const at = value.lastIndexOf('@');
  return at > 0 && value.slice(at + 1) === LINKED_ACCOUNT_EMAIL_DOMAIN;
}

/** Address safe to show or send. Synthetic linked addresses stay on the server. */
export function publicEmail(email: string | null | undefined): string | null {
  if (!email || isSyntheticLinkedEmail(email)) return null;
  return email;
}
