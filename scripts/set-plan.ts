/**
 * Grant or change a user's plan (KAN-77), until billing exists. Run on the server:
 *
 *   npm run plan:set -- someone@example.com plus
 *
 * Plans: free | plus | pro | business. Plus and Pro unlock households; Business unlocks the
 * business reports (KAN-125).
 *
 * Stop the API first: it keeps the database in memory and would overwrite this change.
 * On Railway, prefer the PLAN_PLUS_EMAILS / PLAN_PRO_EMAILS / PLAN_BUSINESS_EMAILS variables
 * (see entitlements.ts).
 */
import { getDb, queryOne } from '../server/db/index.ts';
import { normalizeEmail } from '../server/auth/passwords.ts';
import { isPlan, setPlan } from '../server/lib/entitlements.ts';

const email = normalizeEmail(process.argv[2] ?? '');
const plan = process.argv[3];
if (!email || !isPlan(plan)) {
  console.error('Usage: npm run plan:set -- <email> <free|plus|pro|business>');
  process.exit(1);
}
const db = await getDb();
const user = queryOne<{ id: string }>(db, `SELECT id FROM users WHERE email = ?`, [email]);
if (!user) {
  console.error(`No account for ${email}`);
  process.exit(1);
}
setPlan(db, user.id, plan, `set by operator ${new Date().toISOString().slice(0, 10)}`);
console.log(`${email} is now on ${plan}.`);
