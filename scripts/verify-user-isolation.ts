/**
 * Verify per-user ledger isolation (owner keeps data; others empty; env token owner-only).
 * Run from repo root: node --import tsx scripts/verify-user-isolation.ts
 */
import { getDb, queryAll } from '../server/db/index.ts';
import { getDataOwnerUserId } from '../server/lib/userScope.ts';
import { resolveAkahuUserToken } from '../server/akahu/connections.ts';
import { computeNetWorth } from '../server/lib/netWorth.ts';
import { loadDotEnv } from '../server/akahu/loadEnv.ts';

loadDotEnv();
const db = await getDb();
const users = queryAll(db, 'SELECT id, email, created_at FROM users ORDER BY created_at ASC');
const owner = getDataOwnerUserId(db);
console.log('owner', owner);
for (const u of users) {
  const id = String(u.id);
  const nw = await computeNetWorth(db, id);
  const tok = await resolveAkahuUserToken(id);
  console.log(String(u.email), {
    isOwner: id === owner,
    totalKnownNzd: nw.totalKnownNzd,
    holdings: nw.counts.holdings,
    accounts: nw.counts.accounts,
    tokenSource: tok?.source ?? null,
  });
}
process.exit(0);
