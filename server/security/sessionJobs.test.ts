/**
 * Background jobs only during an active session (KAN-115): with DATA_ENCRYPTION=1 a job skips
 * users without an unlocked session, runs the others in their crypto context with a private copy
 * of the key, and encrypts what it saved in plain; with the flag off nothing is skipped.
 * Run: npm run test:isolation
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { randomBytes } from 'node:crypto';

function eq(actual: unknown, expected: unknown, msg: string): void {
  if (JSON.stringify(actual) !== JSON.stringify(expected)) throw new Error(`FAIL: ${msg} (got ${JSON.stringify(actual)}, expected ${JSON.stringify(expected)})`);
}

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'pt-sessionjobs-'));
process.env.DATABASE_PATH = path.join(dir, 'portfolio.db');
process.env.NODE_ENV = 'test';
process.env.DATA_ENCRYPTION = '1';

const { getDb, run } = await import('../db/index.ts');
const { sessionKeyStore, decryptField } = await import('./dataKey.ts');
const { cryptoContext } = await import('./fieldCrypto.ts');
const { runAsUser, jobUserFilter } = await import('./sessionJobs.ts');
const { runAlertsForEveryone } = await import('../alerts/digest.ts');

try {
  const db = await getDb();
  const now = new Date().toISOString();
  for (const u of ['job_a', 'job_b']) run(db, `INSERT INTO users (id, email, password_hash, created_at, updated_at) VALUES (?,?,?,?,?)`, [u, `${u}@x.test`, 'hash', now, now]);
  const keyA = randomBytes(32);
  sessionKeyStore.set('sess_a', 'job_a', keyA);

  eq([...(jobUserFilter() ?? [])], ['job_a'], 'filter: only unlocked users');
  eq(await runAsUser(db, 'job_b', () => 'ran'), { ran: false }, 'locked user skipped');

  // The unlocked user's job runs in their context with a copy of the key.
  let seen: Buffer | null = null;
  const r = await runAsUser(db, 'job_a', async () => {
    await new Promise((res) => setTimeout(res, 5));
    const ctx = cryptoContext();
    eq(ctx?.userId, 'job_a', 'context user survives an await');
    eq(ctx?.key?.equals(keyA), true, 'context holds the key');
    seen = ctx!.key;
    sessionKeyStore.clear('sess_a'); // signing out mid-job zeroes the session's key...
    eq(ctx!.key!.equals(keyA), true, "...but not the job's copy");
    // A job saves a plain note; it's encrypted once the job finishes.
    run(db, `INSERT INTO savings_goals (id, user_id, name, notes, target_nzd, current_amount_nzd, created_at, updated_at) VALUES ('g_job', 'job_a', 'Job', 'written by a job', 1, 0, ?, ?)`, [now, now]);
    return 42;
  });
  eq(r, { ran: true, value: 42 }, 'unlocked user ran');
  eq(seen!.every((b: number) => b === 0), true, "job's key copy zeroed afterwards");
  const stmt = db.prepare(`SELECT notes FROM savings_goals WHERE id = 'g_job'`);
  stmt.step();
  const sealed = String(stmt.getAsObject().notes);
  stmt.free();
  eq(sealed.startsWith('ue1:') && decryptField(keyA, sealed, 'job_a') === 'written by a job', true, 'plain value saved by the job is encrypted after');
  eq(cryptoContext(), undefined, 'no context leaks out of the job');

  // Alerts: the daily pass skips locked users.
  sessionKeyStore.set('sess_a2', 'job_a', keyA);
  const pass = await runAlertsForEveryone('2026-11-24', async () => ({ ok: true }) as never);
  eq([pass.users, pass.skipped], [2, 1], 'alerts: one user run, one skipped');

  // Flag off: nobody is skipped.
  process.env.DATA_ENCRYPTION = '0';
  eq(jobUserFilter(), null, 'flag off: no filter');
  eq(await runAsUser(db, 'job_b', () => 'ran'), { ran: true, value: 'ran' }, 'flag off: locked user runs');
  eq((await runAlertsForEveryone('2026-11-24', async () => ({ ok: true }) as never)).skipped, 0, 'flag off: alerts skip nobody');
  sessionKeyStore.clearUser('job_a');
  console.log('session jobs tests passed');
} finally {
  fs.rmSync(dir, { recursive: true, force: true });
}
process.exit(0);
