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
