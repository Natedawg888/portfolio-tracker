/**
 * KiwiSaver employee contribution rate is saved per user. 3% is the starting rate.
 * No contribution dollar amount is stored.
 * Run: npm run test:dividends
 */
import { getDb, queryOne, run } from '../db/index.ts';
import { readKiwiSaverEmployeeRate, saveKiwiSaverEmployeeRate } from './employeeRate.ts';

function assert(cond: unknown, msg: string): void {
  if (!cond) throw new Error(`FAIL: ${msg}`);
}

const userA = 'ksrate_user_a';
const userB = 'ksrate_user_b';

function cleanup(db: Awaited<ReturnType<typeof getDb>>) {
  run(db, `DELETE FROM users WHERE id IN (?, ?)`, [userA, userB]);
}

function insertUser(db: Awaited<ReturnType<typeof getDb>>, id: string, email: string) {
  const now = new Date().toISOString();
  run(
    db,
    `INSERT INTO users (id, email, password_hash, preferences_json, created_at, updated_at)
     VALUES (?, ?, 'test-hash', ?, ?, ?)`,
    [id, email, JSON.stringify({ assetClasses: { stocks: true } }), now, now],
  );
}

async function main() {
  const db = await getDb();
  cleanup(db);
  insertUser(db, userA, 'ksrate-a@example.test');
  insertUser(db, userB, 'ksrate-b@example.test');

  try {
    const initial = readKiwiSaverEmployeeRate(db, userA);
    assert(initial.found, 'user A exists');
    assert(initial.saved === false, 'nothing is saved until the user chooses a rate');
    assert(initial.employeeRatePct === 3, 'the starting rate offered is 3%');
    assert(!('contributionNzd' in initial), 'the rate response does not invent a contribution amount');

    const saved = saveKiwiSaverEmployeeRate(db, userA, 3);
    assert(saved.ok, 'user A can save 3%');
    if (!saved.ok) return;
    assert(saved.employeeRatePct === 3, 'saving 3% returns 3%');
    const again = readKiwiSaverEmployeeRate(db, userA);
    assert(again.saved === true && again.employeeRatePct === 3, '3% round-trips for user A');

    const prefs = queryOne<{ preferences_json: string }>(
      db,
      `SELECT preferences_json FROM users WHERE id = ?`,
      [userA],
    );
    const parsed = JSON.parse(String(prefs?.preferences_json)) as {
      kiwiSaverEmployeeRatePct?: number;
      assetClasses?: { stocks?: boolean };
      contributionNzd?: number;
    };
    assert(parsed.kiwiSaverEmployeeRatePct === 3, 'the saved preference is the rate 3');
    assert(parsed.assetClasses?.stocks === true, 'saving the rate keeps the user\'s other preferences');
    assert(parsed.contributionNzd == null, 'preferences do not store a contribution dollar amount');

    const other = saveKiwiSaverEmployeeRate(db, userB, 4);
    assert(other.ok && other.employeeRatePct === 4, 'user B can save a different rate');
    assert(readKiwiSaverEmployeeRate(db, userA).employeeRatePct === 3, 'user B does not change user A');
    assert(readKiwiSaverEmployeeRate(db, userB).employeeRatePct === 4, 'user B reads their own rate');

    const missing = saveKiwiSaverEmployeeRate(db, 'ksrate_missing_user', 3);
    assert(!missing.ok, 'an unknown user cannot save a rate');

    for (const bad of [0, -1, 101, 3.333, 'nope', null]) {
      const rejected = saveKiwiSaverEmployeeRate(db, userA, bad);
      assert(!rejected.ok, `rejects invalid rate ${String(bad)}`);
    }
    assert(readKiwiSaverEmployeeRate(db, userA).employeeRatePct === 3, 'a rejected rate leaves the saved 3% in place');

    console.log('kiwisaver employee rate tests passed');
  } finally {
    cleanup(db);
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
