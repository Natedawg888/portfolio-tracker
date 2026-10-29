/** A household invite opened before signing in is kept for this tab only (KAN-77). */
export const PENDING_INVITE_KEY = 'koru.pendingHouseholdInvite';

export function readPendingInvite(): string | null {
  try {
    return sessionStorage.getItem(PENDING_INVITE_KEY);
  } catch {
    return null;
  }
}

export function writePendingInvite(token: string | null): void {
  try {
    if (token) sessionStorage.setItem(PENDING_INVITE_KEY, token);
    else sessionStorage.removeItem(PENDING_INVITE_KEY);
  } catch {
    /* storage blocked: the link still works while the join page stays open */
  }
}

/** The same for a business invite (KAN-129): an accountant or viewer let into someone's books. */
export const PENDING_BUSINESS_INVITE_KEY = 'koru.pendingBusinessInvite';

export function readPendingBusinessInvite(): string | null {
  try {
    return sessionStorage.getItem(PENDING_BUSINESS_INVITE_KEY);
  } catch {
    return null;
  }
}

export function writePendingBusinessInvite(token: string | null): void {
  try {
    if (token) sessionStorage.setItem(PENDING_BUSINESS_INVITE_KEY, token);
    else sessionStorage.removeItem(PENDING_BUSINESS_INVITE_KEY);
  } catch {
    /* storage blocked: the link still works while the join page stays open */
  }
}
