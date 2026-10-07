/** Single sign-on helpers shared by the sign-in page and Settings → Security. */
import type { SsoProvider } from '../api/client';

/** Full-page navigation to the server, which redirects to the provider. */
export function ssoStartUrl(id: SsoProvider['id'], opts: { remember?: boolean; mode?: 'signin' | 'add' | 'link' } = {}): string {
  const q = new URLSearchParams({ remember: opts.remember === false ? '0' : '1' });
  if (opts.mode && opts.mode !== 'signin') q.set('mode', opts.mode);
  return `/api/auth/sso/${id}/start?${q}`;
}

const MESSAGES: Record<string, string> = {
  CANCELLED: 'Sign-in was cancelled.',
  NOT_CONFIGURED: 'That sign-in option isn’t set up on this server.',
  STATE_MISSING: 'That sign-in took too long or started in another browser. Try again.',
  STATE_MISMATCH: 'That sign-in couldn’t be verified. Try again.',
  TOKEN_INVALID: 'That sign-in couldn’t be verified. Try again.',
  PROVIDER_ERROR: 'The sign-in provider had a problem. Try again.',
  NO_EMAIL: 'That account didn’t share an email address, so we can’t find or create your account.',
  ACCOUNT_EXISTS:
    'An account with this email already exists. Sign in with your password, then connect it under Settings → Security.',
  IDENTITY_IN_USE: 'That account is already connected to a different KoruLedger account.',
  SIGN_IN_FIRST: 'Sign in first, then connect the account under Settings → Security.',
};

export function ssoErrorMessage(code: string | null): string | null {
  if (!code) return null;
  return MESSAGES[code] ?? 'Sign-in didn’t work. Try again.';
}
