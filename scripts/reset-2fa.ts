/**
 * Account recovery when someone has lost their phone AND their backup codes (KAN-16).
 * Run on the server, by the operator, after confirming who is asking:
 *
 *   npm run auth:reset-2fa -- someone@example.com
 *
 * Turns two-factor sign-in off, removes backup codes and trusted devices, and signs the
 * account out everywhere. The password is unchanged; they sign in with it and can turn
 * 2FA back on under Settings → Security.
 */
import { getDb, queryOne } from '../server/db/index.ts';
import { normalizeEmail } from '../server/auth/passwords.ts';
import { destroySessionsForUser } from '../server/auth/sessions.ts';
import { disableTwoFactor, isTwoFactorEnabled } from '../server/auth/twoFactor.ts';

const email = normalizeEmail(process.argv[2] ?? '');
if (!email) {
  console.error('Usage: npm run auth:reset-2fa -- <email>');
  process.exit(1);
}
const db = await getDb();
const user = queryOne<{ id: string }>(db, 'SELECT id FROM users WHERE email = ?', [email]);
if (!user) {
  console.error(`No account with email ${email}`);
  process.exit(1);
}
const wasOn = isTwoFactorEnabled(db, user.id);
disableTwoFactor(db, user.id);
const sessions = destroySessionsForUser(db, user.id);
console.log(
  `${email}: two-factor sign-in ${wasOn ? 'turned off' : 'was already off'}; backup codes and trusted devices removed; ${sessions} session(s) signed out.`,
);
