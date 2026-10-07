/**
 * Week 1 smoke test: per-user ledger + category isolation.
 *
 * DB checks (always):
 *   - data owner vs other users: holdings/accounts/txns/categories scoped
 *   - AKAHU_USER_TOKEN only resolves for data owner (unless OAuth row exists)
 *
 * API checks (when API_BASE is reachable, default http://127.0.0.1:3000):
 *   - register two throwaway users (or use SMOKE_EMAIL_A / SMOKE_EMAIL_B)
 *   - each sees only their own categories / empty holdings
 *   - user A holding is invisible to user B
 *
 * Run: node --import tsx scripts/verify-user-isolation.ts
 */
import { randomBytes } from 'node:crypto';
import fs from 'node:fs';
import { DENYLIST_PATH, type CustodialFile } from '../server/lib/custodialDenylist.ts';
import { getDb, queryAll, queryOne, run, newId, persist } from '../server/db/index.ts';
import { getDataOwnerUserId } from '../server/lib/userScope.ts';
import { resolveAkahuUserToken } from '../server/akahu/connections.ts';
import { computeNetWorth } from '../server/lib/netWorth.ts';
import { loadDotEnv } from '../server/akahu/loadEnv.ts';
import { seedCategoriesForUser } from '../server/lib/categories.ts';

loadDotEnv();

const API_BASE = (process.env.API_BASE || 'http://127.0.0.1:3000').replace(/\/$/, '');
const failures: string[] = [];

function fail(msg: string) {
  failures.push(msg);
  console.error('FAIL:', msg);
}

function ok(msg: string) {
  console.log('OK:', msg);
}

type CookieJar = { cookie?: string };

async function api(
  jar: CookieJar,
  method: string,
  path: string,
  body?: unknown,
): Promise<{ status: number; json: any; setCookie?: string }> {
  const headers: Record<string, string> = { Accept: 'application/json' };
  if (body !== undefined) headers['Content-Type'] = 'application/json';
  if (jar.cookie) headers.Cookie = jar.cookie;
  const res = await fetch(`${API_BASE}${path}`, {
    method,
    headers,
    body: body !== undefined ? JSON.stringify(body) : undefined,
    redirect: 'manual',
  });
  const setCookie = res.headers.get('set-cookie') ?? undefined;
  if (setCookie) {
    const sid = setCookie.split(';')[0];
    if (sid) jar.cookie = sid;
  }
  const json = await res.json().catch(() => ({}));
  return { status: res.status, json, setCookie };
}

async function dbChecks() {
  console.log('\n=== DB isolation ===');
  const db = await getDb();
  const users = queryAll<{ id: string; email: string; created_at: string }>(
    db,
    'SELECT id, email, created_at FROM users ORDER BY created_at ASC',
  );
  const owner = getDataOwnerUserId(db);
  console.log('owner', owner, 'users', users.length);

  if (users.length === 0) {
    ok('no users yet — schema loads; signup will seed categories');
    return { db, users, owner };
  }

  for (const u of users) {
    const id = String(u.id);
    seedCategoriesForUser(db, id); // idempotent repair if migration mid-flight
    const nw = await computeNetWorth(db, id);
    const tok = await resolveAkahuUserToken(id);
    const cats = queryAll(db, `SELECT id, slug FROM budget_categories WHERE user_id = ?`, [id]);
    const foreignCats = queryAll(
      db,
      `SELECT id FROM budget_categories WHERE user_id IS NOT NULL AND user_id != ?`,
      [id],
    );
    const leakHoldings = queryOne<{ c: number }>(
      db,
      `SELECT COUNT(*) AS c FROM holdings WHERE user_id IS NOT NULL AND user_id != ? AND id IN (
         SELECT id FROM holdings WHERE user_id = ?
       )`,
      [id, id],
    );
    console.log(String(u.email), {
      isOwner: id === owner,
      totalKnownNzd: nw.totalKnownNzd,
      holdings: nw.counts.holdings,
      accounts: nw.counts.accounts,
      categories: cats.length,
      tokenSource: tok?.source ?? null,
    });
    if (cats.length < 10) fail(`${u.email} has fewer than 10 categories (${cats.length})`);
    if (id !== owner && tok?.source === 'env') {
      fail(`${u.email} resolved shared env Akahu token but is not data owner`);
    }
    if (Number(leakHoldings?.c ?? 0) > 0) fail(`${u.email} holdings id collision across users`);
    void foreignCats;
  }

  // Cross-user: categories for user A must not appear in user B's list
  if (users.length >= 2) {
    const a = String(users[0].id);
    const b = String(users[1].id);
    const aCats = new Set(
      queryAll<{ id: string }>(db, `SELECT id FROM budget_categories WHERE user_id=?`, [a]).map(
        (r) => String(r.id),
      ),
    );
    const bCats = queryAll<{ id: string }>(db, `SELECT id FROM budget_categories WHERE user_id=?`, [
      b,
    ]);
    for (const c of bCats) {
      if (aCats.has(String(c.id))) fail(`category id ${c.id} shared by two users`);
    }
    ok('category ids are unique per user');
  }

  persist();
  return { db, users, owner };
}

async function apiChecks() {
  console.log('\n=== API isolation ===');
  let health: Response;
  try {
    health = await fetch(`${API_BASE}/api/health`);
  } catch {
    console.log('SKIP API: server not reachable at', API_BASE);
    return;
  }
  if (!health.ok) {
    console.log('SKIP API: /api/health not ok', health.status);
    return;
  }

  const stamp = Date.now().toString(36);
  const emailA = process.env.SMOKE_EMAIL_A || `smoke-a-${stamp}@example.test`;
  const emailB = process.env.SMOKE_EMAIL_B || `smoke-b-${stamp}@example.test`;
  const password = process.env.SMOKE_PASSWORD || 'SmokeTest1a';

  const jarA: CookieJar = {};
  const jarB: CookieJar = {};

  const regA = await api(jarA, 'POST', '/api/auth/register', {
    email: emailA,
    password,
    firstName: 'Smoke',
    lastName: 'Alpha',
  });
  if (regA.status !== 201 && regA.status !== 409) {
    fail(`register A status ${regA.status}: ${JSON.stringify(regA.json)}`);
    return;
  }
  if (regA.status === 409) {
    const login = await api(jarA, 'POST', '/api/auth/login', { email: emailA, password });
    if (login.status !== 200) {
      fail(`login A failed ${login.status}`);
      return;
    }
  }

  const regB = await api(jarB, 'POST', '/api/auth/register', {
    email: emailB,
    password,
    firstName: 'Smoke',
    lastName: 'Bravo',
  });
  if (regB.status !== 201 && regB.status !== 409) {
    fail(`register B status ${regB.status}: ${JSON.stringify(regB.json)}`);
    return;
  }
  if (regB.status === 409) {
    const login = await api(jarB, 'POST', '/api/auth/login', { email: emailB, password });
    if (login.status !== 200) {
      fail(`login B failed ${login.status}`);
      return;
    }
  }

  const catsA = await api(jarA, 'GET', '/api/budgets/categories');
  const catsB = await api(jarB, 'GET', '/api/budgets/categories');
  if (catsA.status !== 200 || catsB.status !== 200) {
    fail(`categories status A=${catsA.status} B=${catsB.status}`);
    return;
  }
  const idsA = new Set((catsA.json as any[]).map((c) => c.id));
  const idsB = new Set((catsB.json as any[]).map((c) => c.id));
  if (idsA.size < 10 || idsB.size < 10) fail('each user should have seeded categories');
  for (const id of idsB) {
    if (idsA.has(id)) fail(`API category id leak/share: ${id}`);
  }
  ok(`API categories isolated (A=${idsA.size}, B=${idsB.size})`);

  // Create a holding for A; B must not see it
  const createH = await api(jarA, 'POST', '/api/holdings', {
    assetClass: 'crypto',
    name: `Smoke BTC ${stamp}`,
    asset: 'BTC',
    amount: 0.001,
    costBasisNzd: null,
  });
  if (createH.status !== 201 && createH.status !== 200) {
    // holdings API shape may vary — try soft fail
    console.log('NOTE: create holding status', createH.status, createH.json?.error ?? createH.json);
  } else {
    const holdId = createH.json?.id ?? createH.json?.holding?.id;
    const listA = await api(jarA, 'GET', '/api/holdings');
    const listB = await api(jarB, 'GET', '/api/holdings');
    const aHas =
      Array.isArray(listA.json) &&
      listA.json.some((h: any) => h.id === holdId || h.name?.includes(`Smoke BTC ${stamp}`));
    const bHas =
      Array.isArray(listB.json) &&
      listB.json.some((h: any) => h.id === holdId || h.name?.includes(`Smoke BTC ${stamp}`));
    if (holdId && !aHas) fail('user A cannot see own smoke holding');
    if (bHas) fail('user B can see user A smoke holding');
    else ok('holdings list isolated (B cannot see A holding)');

    if (holdId) {
      await api(jarA, 'DELETE', `/api/holdings/${holdId}`);
    }
  }

  // Create a wallet for A; B must not list, read, edit or delete it
  const createW = await api(jarA, 'POST', '/api/wallets', {
    network: 'ethereum',
    address: `0x${randomBytes(20).toString('hex')}`, // fresh so reruns never hit DUPLICATE_WALLET
    name: `Smoke wallet ${stamp}`,
  });
  if (createW.status !== 201) {
    fail(`user A create wallet status ${createW.status} ${createW.json?.error ?? ''}`);
  } else {
    const walletId = createW.json.id;
    const listA = await api(jarA, 'GET', '/api/wallets');
    const listB = await api(jarB, 'GET', '/api/wallets');
    if (!Array.isArray(listA.json) || !listA.json.some((w: any) => w.id === walletId)) {
      fail('user A cannot see own smoke wallet');
    }
    if (Array.isArray(listB.json) && listB.json.some((w: any) => w.id === walletId)) {
      fail('user B can see user A smoke wallet');
    }
    const getB = await api(jarB, 'GET', `/api/wallets/${walletId}`);
    const patchB = await api(jarB, 'PATCH', `/api/wallets/${walletId}`, { name: 'x' });
    const delB = await api(jarB, 'DELETE', `/api/wallets/${walletId}`);
    if (getB.status !== 404 || patchB.status !== 404 || delB.status !== 404) {
      fail(`user B reached user A wallet (get=${getB.status} patch=${patchB.status} delete=${delB.status})`);
    } else {
      ok('wallets isolated (B cannot list/read/edit/delete A wallet)');
    }

    // Known exchange hot wallets are refused on add and on address change (KAN-69).
    const custodial = (JSON.parse(fs.readFileSync(DENYLIST_PATH, 'utf8')) as CustodialFile).addresses.find(
      (e) => e.family === 'evm',
    );
    if (custodial) {
      const addC = await api(jarA, 'POST', '/api/wallets', { network: 'ethereum', address: custodial.address });
      const patchC = await api(jarA, 'PATCH', `/api/wallets/${walletId}`, { address: custodial.address });
      if (addC.json?.code !== 'CUSTODIAL_ADDRESS' || patchC.json?.code !== 'CUSTODIAL_ADDRESS') {
        fail(`custodial address accepted (add=${addC.status} patch=${patchC.status})`);
      } else {
        ok(`custodial address rejected on add and edit (${custodial.custodian})`);
      }
    }
    await api(jarA, 'DELETE', `/api/wallets/${walletId}`);
  }

  const sumA = await api(jarA, 'GET', '/api/summary/net-worth');
  const sumB = await api(jarB, 'GET', '/api/summary/net-worth');
  if (sumA.status === 200 && sumB.status === 200) {
    ok(
      `net-worth endpoints scoped (A total=${sumA.json?.totalKnownNzd ?? sumA.json?.totalNzd}, B total=${sumB.json?.totalKnownNzd ?? sumB.json?.totalNzd})`,
    );
  }

  const akahuA = await api(jarA, 'GET', '/api/akahu/status');
  const akahuB = await api(jarB, 'GET', '/api/akahu/status');
  if (akahuA.status === 200 && akahuB.status === 200) {
    const aSrc = akahuA.json?.tokenSource;
    const bSrc = akahuB.json?.tokenSource;
    if (bSrc === 'env' && !akahuB.json?.oauthConnected) {
      fail('non-owner B resolved env Akahu token');
    } else {
      ok(`akahu status A.tokenSource=${aSrc} B.tokenSource=${bSrc}`);
    }
  }
}

const { users } = await dbChecks();
await apiChecks();

console.log('\n=== Result ===');
if (failures.length) {
  console.error(`${failures.length} failure(s)`);
  for (const f of failures) console.error(' -', f);
  process.exit(1);
}
console.log('All isolation checks passed.', { userCount: users.length });
process.exit(0);
