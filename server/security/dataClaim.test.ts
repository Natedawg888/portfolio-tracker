/**
 * First signup must not take over finance rows that already exist unless
 * ALLOW_EXISTING_DATA_CLAIM is set on the server.
 * Run: npm run test:isolation
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import type { AddressInfo } from 'node:net';
import type { Server } from 'node:http';
import express from 'express';

function assert(cond: unknown, msg: string): void {
  if (!cond) throw new Error(`FAIL: ${msg}`);
}

const allow = process.argv.includes('--allow');
const dir = fs.mkdtempSync(path.join(os.tmpdir(), `pt-claim-${allow ? 'allow' : 'deny'}-`));
process.env.DATABASE_PATH = path.join(dir, 'portfolio.db');
process.env.NODE_ENV = 'test';
if (allow) process.env.ALLOW_EXISTING_DATA_CLAIM = '1';
else delete process.env.ALLOW_EXISTING_DATA_CLAIM;

const { getDb, queryOne, run } = await import('../db/index.ts');
const { countFinanceRows, existingDataClaimAllowed, startupOwnerId } = await import('../lib/dataClaim.ts');
const { default: authRouter } = await import('../routes/auth.ts');
const { default: accountsRouter } = await import('../routes/accounts.ts');
const { attachUser, requireAuth, isPublicApiPath } = await import('../middleware/requireAuth.ts');

const app = express();
app.use(express.json());
app.use('/api', attachUser);
app.use('/api', (req, res, next) => {
  if (isPublicApiPath(req.path)) return next();
  return requireAuth(req, res, next);
});
app.use('/api/auth', authRouter);
app.use('/api/accounts', accountsRouter);

const server: Server = await new Promise((resolve) => {
  const s = app.listen(0, '127.0.0.1', () => resolve(s));
});
const port = (server.address() as AddressInfo).port;
const base = `http://127.0.0.1:${port}`;

async function post(pathname: string, body: unknown) {
  const res = await fetch(`${base}${pathname}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
    body: JSON.stringify(body),
  });
  const setCookie = res.headers.get('set-cookie') ?? undefined;
  const json = (await res.json().catch(() => ({}))) as Record<string, unknown>;
  return { status: res.status, json, cookie: setCookie?.split(';')[0] };
}

async function get(pathname: string, cookie: string) {
  const res = await fetch(`${base}${pathname}`, {
    headers: { Accept: 'application/json', Cookie: cookie },
  });
  const json = await res.json().catch(() => null);
  return { status: res.status, json };
}

try {
  const db = await getDb();
  const now = new Date().toISOString();
  run(
    db,
    `INSERT INTO holdings (id, user_id, asset_class, name, created_at, updated_at, asset, amount)
     VALUES (?,?,?,?,?,?,?,?)`,
    ['hld_pre', null, 'crypto', 'Preexisting Secret BTC', now, now, 'BTC', 2],
  );
  run(
    db,
    `INSERT INTO bank_accounts
       (id, user_id, name, institution, account_type, currency, balance, notes, created_at, updated_at)
     VALUES (?,?,?,?,?,?,?,?,?,?)`,
    ['acct_pre', null, 'Kiwibank secret', 'Kiwibank', 'checking', 'NZD', 80, null, now, now],
  );

  const financeCount = countFinanceRows(db);
  assert(financeCount >= 2, 'seeded finance rows are visible to the claim check');
  const restartOwner = startupOwnerId({
    earliestUserId: 'user_future',
    financeRowCount: financeCount,
    claimAllowed: existingDataClaimAllowed(),
  });
  if (allow) {
    assert(restartOwner === 'user_future', 'flag allows startup to adopt an earliest user');
  } else {
    assert(restartOwner === null, 'startup must not adopt a user when finance rows already exist');
    assert(
      startupOwnerId({ earliestUserId: 'user_future', financeRowCount: 0, claimAllowed: false }) ===
        'user_future',
      'empty install can still assign an owner',
    );
  }

  const reg = await post('/api/auth/register', {
    email: allow ? 'claim-allow@example.test' : 'claim-deny@example.test',
    password: 'SmokeTest1a',
    firstName: 'Claim',
    lastName: allow ? 'Allow' : 'Deny',
  });
  assert(reg.status === 201, `register status ${reg.status}`);
  assert(Boolean(reg.cookie), 'first account receives a session');
  const user = reg.json.user as { id?: string } | undefined;
  assert(typeof user?.id === 'string' && user.id.length > 0, 'register returns a user id');

  const holding = queryOne<{ user_id: string | null; name: string }>(
    db,
    `SELECT user_id, name FROM holdings WHERE id = ?`,
    ['hld_pre'],
  );
  const account = queryOne<{ user_id: string | null; name: string }>(
    db,
    `SELECT user_id, name FROM bank_accounts WHERE id = ?`,
    ['acct_pre'],
  );
  const owner = queryOne<{ value: string }>(
    db,
    `SELECT value FROM meta WHERE key = 'data_owner_user_id'`,
  );
  const accounts = await get('/api/accounts', reg.cookie!);
  const body = JSON.stringify(accounts.json ?? {});

  if (allow) {
    assert(reg.json.claimedExistingData === true, 'flagged first signup claims existing rows');
    assert(holding?.user_id === user!.id, 'holding is assigned to the bootstrapped user');
    assert(account?.user_id === user!.id, 'bank account is assigned to the bootstrapped user');
    assert(owner?.value === user!.id, 'data owner is the bootstrapped user');
    assert(accounts.status === 200, 'claimed user can read accounts');
    assert(body.includes('Kiwibank secret'), 'claimed user can see the preexisting account');
  } else {
    assert(reg.json.claimedExistingData === false, 'unflagged first signup does not claim existing rows');
    assert(holding?.user_id == null || holding?.user_id === '', 'preexisting holding stays unowned');
    assert(account?.user_id == null || account?.user_id === '', 'preexisting bank account stays unowned');
    assert(!owner?.value, 'data owner is not set for a preexisting database');
    assert(accounts.status === 200, 'new account still works');
    assert(!body.includes('Kiwibank secret'), 'API does not reveal the preexisting account name');
    assert(!body.includes('Preexisting Secret'), 'API does not reveal the preexisting holding name');
  }

  console.log(allow ? 'OK: existing data claim allowed by env flag' : 'OK: existing finance rows not claimed');
} finally {
  await new Promise<void>((resolve) => server.close(() => resolve()));
}

if (!allow) {
  const child = spawnSync(
    process.execPath,
    ['--import', 'tsx', fileURLToPath(import.meta.url), '--allow'],
    { encoding: 'utf8', env: { ...process.env, ALLOW_EXISTING_DATA_CLAIM: '1' } },
  );
  if (child.stdout) process.stdout.write(child.stdout);
  if (child.status !== 0) {
    if (child.stderr) process.stderr.write(child.stderr);
    throw new Error(`allow-claim child failed (${child.status})`);
  }
}
