/**
 * Creating accounts, shared by email sign-up and single sign-on (Google / Apple / Microsoft).
 * The first account on an empty install becomes the data owner. A database that already has
 * finance or bank rows is not handed to the first registrant unless ALLOW_EXISTING_DATA_CLAIM
 * is set on the server (lib/dataClaim.ts). Later accounts start with empty ledgers and their
 * own budget categories.
 */
import type { Database } from 'sql.js';
import { newId, queryOne, run } from '../db/index.ts';
import { claimUnscopedRowsForOwner } from '../lib/userScope.ts';
import { mayClaimExistingFinance } from '../lib/dataClaim.ts';
import { seedCategoriesForUser } from '../lib/categories.ts';
import { initialPreferencesJsonForNewUser } from '../../src/lib/onboardingPrefs.ts';

/**
 * password_hash for accounts created through single sign-on. It isn't a valid scrypt
 * string, so verifyPassword() always fails until the user sets a password.
 */
export const NO_PASSWORD = '!sso-only';

export function hasPassword(passwordHash: string | null | undefined): boolean {
  return Boolean(passwordHash && passwordHash !== NO_PASSWORD);
}

/** Ways this account can sign in: its password, each connected provider, each passkey. */
export function signInMethodCount(db: Database, userId: string): number {
  const pw = queryOne<{ password_hash: string }>(db, `SELECT password_hash FROM users WHERE id = ?`, [userId]);
  const count = (table: string) => Number(queryOne<{ c: number }>(db, `SELECT COUNT(*) AS c FROM ${table} WHERE user_id = ?`, [userId])?.c ?? 0);
  return (hasPassword(pw?.password_hash) ? 1 : 0) + count('user_identities') + count('user_passkeys');
}

export function composeDisplayName(first: string | null, last: string | null): string | null {
  const parts = [first, last].filter((p): p is string => Boolean(p && p.trim()));
  if (parts.length === 0) return null;
  return parts.join(' ').slice(0, 80);
}

export type CreatedUser = {
  id: string;
  createdAt: string;
  displayName: string | null;
  preferencesJson: string | null;
  claimedExistingData: boolean;
};

export function createUserAccount(
  db: Database,
  input: { email: string; passwordHash: string; firstName: string | null; lastName: string | null },
): CreatedUser {
  const usersBefore = Number(queryOne<{ c: number }>(db, `SELECT COUNT(*) AS c FROM users`)?.c ?? 0);
  const id = newId('user');
  const now = new Date().toISOString();
  const displayName = composeDisplayName(input.firstName, input.lastName);
  const prefsJson = initialPreferencesJsonForNewUser(input.email);
  run(
    db,
    `INSERT INTO users (id, email, password_hash, first_name, last_name, display_name, avatar_url, preferences_json, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, NULL, ?, ?, ?)`,
    [id, input.email, input.passwordHash, input.firstName, input.lastName, displayName, prefsJson, now, now],
  );

  let claimedExistingData = false;
  if (usersBefore === 0 && mayClaimExistingFinance(db)) {
    run(db, `INSERT OR REPLACE INTO meta (key, value) VALUES ('data_owner_user_id', ?)`, [id]);
    run(db, `INSERT OR REPLACE INTO meta (key, value) VALUES ('data_claimed_at', ?)`, [now]);
    claimUnscopedRowsForOwner(db, id);
    claimedExistingData = true;
  }
  // Every user gets their own budget category set (owner claims legacy globals).
  seedCategoriesForUser(db, id);
  // Later signups intentionally get empty finance rows (holdings/txns/etc.).
  return { id, createdAt: now, displayName, preferencesJson: prefsJson, claimedExistingData };
}
