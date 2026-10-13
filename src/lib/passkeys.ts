/**
 * Passkeys in the browser (KAN-75). The browser and OS keep the passkey (Face ID,
 * Touch ID, Windows Hello or the device PIN); the server only ever sees public keys.
 *
 * A small, non-secret hint in localStorage ({ email, name }) remembers that this
 * device has a passkey for that account, so the login page can show "Continue as
 * <name>". Losing it only hides the button; "Sign in with a passkey" still works.
 */
import { WebAuthnError, browserSupportsWebAuthn, startAuthentication, startRegistration } from '@simplewebauthn/browser';
import { api, type AuthUser, type PasskeyInfo } from '../api/client';

const HINT_KEY = 'koru.auth.passkeyHint';
const DISMISSED_KEY = 'koru.auth.passkeyOfferDismissed';

export type PasskeyHint = { email: string; name: string };

export function passkeysSupported(): boolean {
  try {
    return browserSupportsWebAuthn();
  } catch {
    return false;
  }
}

/** Parse a stored hint; anything unexpected is treated as no hint. */
export function parseHint(raw: string | null): PasskeyHint | null {
  if (!raw) return null;
  try {
    const v = JSON.parse(raw) as Partial<PasskeyHint>;
    return typeof v.email === 'string' && v.email && typeof v.name === 'string' && v.name ? { email: v.email, name: v.name } : null;
  } catch {
    return null;
  }
}

/** The name on the "Continue as" button: display name, else first name, else the email. */
export function hintName(user: Pick<AuthUser, 'email'> & { displayName?: string | null; firstName?: string | null }): string {
  return (user.displayName || user.firstName || user.email).trim();
}

export function readHint(): PasskeyHint | null {
  try {
    return parseHint(localStorage.getItem(HINT_KEY));
  } catch {
    return null;
  }
}

export function writeHint(hint: PasskeyHint | null): void {
  try {
    if (hint) localStorage.setItem(HINT_KEY, JSON.stringify(hint));
    else localStorage.removeItem(HINT_KEY);
  } catch {
    /* storage blocked: the button just won't show */
  }
}

/** Emails that said "Not now" to the passkey offer on this browser. */
export function parseDismissed(raw: string | null): string[] {
  if (!raw) return [];
  try {
    const v = JSON.parse(raw) as unknown;
    return Array.isArray(v) ? v.filter((e): e is string => typeof e === 'string').slice(-20) : [];
  } catch {
    return [];
  }
}

export function offerDismissed(email: string): boolean {
  try {
    return parseDismissed(localStorage.getItem(DISMISSED_KEY)).includes(email.toLowerCase());
  } catch {
    return true;
  }
}

export function dismissOffer(email: string): void {
  try {
    const list = parseDismissed(localStorage.getItem(DISMISSED_KEY)).filter((e) => e !== email.toLowerCase());
    localStorage.setItem(DISMISSED_KEY, JSON.stringify([...list, email.toLowerCase()].slice(-20)));
  } catch {
    /* nothing to remember */
  }
}

/** True when the person closed or cancelled the browser's passkey prompt. */
export function wasCancelled(err: unknown): boolean {
  if (err instanceof WebAuthnError) return err.code === 'ERROR_CEREMONY_ABORTED' || err.name === 'NotAllowedError';
  return err instanceof Error && (err.name === 'NotAllowedError' || err.name === 'AbortError');
}

/** Ask the browser for a passkey and sign in with it. */
export async function signInWithPasskey(remember: boolean): Promise<AuthUser> {
  const optionsJSON = await api.auth.passkeyLoginOptions({ remember });
  const response = await startAuthentication({ optionsJSON });
  const { user } = await api.auth.passkeyLoginVerify({ response });
  return user;
}

/** Create a passkey on this device for the signed-in account. */
export async function addPasskey(opts: { password?: string; name?: string } = {}): Promise<PasskeyInfo> {
  const optionsJSON = await api.auth.passkeyRegisterOptions({ password: opts.password });
  const response = await startRegistration({ optionsJSON });
  return api.auth.passkeyRegisterVerify({ response, name: opts.name });
}

const METHOD_WORDS: Record<string, string> = {
  password: 'with password',
  two_factor: 'with password and 2FA code',
  passkey: 'with a passkey',
  sso: 'with Google, Apple or Microsoft',
  register: 'by creating the account',
};

/** "Signed in with a passkey", "Passkey added", … for the recent sign-ins list. */
export function authEventText(kind: string, method: string | null): string {
  if (kind === 'passkey_added') return 'Passkey added';
  if (kind === 'passkey_removed') return 'Passkey removed';
  const how = method ? METHOD_WORDS[method] : null;
  return how ? `Signed in ${how}` : 'Signed in';
}
