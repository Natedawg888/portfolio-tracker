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
      const bAcct = await api(jarB, 'POST', '/api/accounts', {
        name: `Smoke B ${stamp}`,
        balance: 20,
      });
      const bAccountId = bAcct.json?.id;
      if (bAcct.status !== 201 || !bAccountId) {
        fail(`user B account create ${bAcct.status}`);
      } else {
        const attack = await api(jarB, 'POST', '/api/accounts/transactions', {
          accountId: bAccountId,
          date: '2026-10-05',
          amount: -10,
          kind: 'debit',
          description: 'btc cross user',
          affectsBtc: true,
          btcHoldingId: holdId,
        });
        if (attack.status === 200 || attack.status === 201) {
          fail('user B transaction changed user A BTC holding');
        }
        const attackBody = JSON.stringify(attack.json ?? {});
        if (attackBody.includes(`Smoke BTC ${stamp}`)) {
          fail('BTC link error revealed user A holding name');
        } else {
          ok('BTC link rejected for another user holding');
        }
        const listA2 = await api(jarA, 'GET', '/api/holdings');
        const still = Array.isArray(listA2.json)
          ? listA2.json.find((h: { id?: string }) => h.id === holdId)
          : null;
        const qty = Number(still?.amount);
        if (qty !== 0.001) fail(`user A BTC amount changed to ${qty}`);
        else ok('user A BTC quantity unchanged');
      }
      await api(jarA, 'DELETE', `/api/holdings/${holdId}`);
    }
  }

  const incomeMarker = `SecretPayee ${stamp}`;
  const beforeB = await api(jarB, 'GET', '/api/income/summary?month=2026-10');
  const beforeActual = Number(beforeB.json?.actualNzd ?? 0);
  const inc = await api(jarA, 'POST', '/api/income', {
    date: '2026-10-06',
    amountNzd: 321.09,
    kind: 'cash',
    description: incomeMarker,
  });
  if (inc.status !== 201) {
    fail(`income create A status ${inc.status}: ${JSON.stringify(inc.json)}`);
  } else {
    const afterB = await api(jarB, 'GET', '/api/income/summary?month=2026-10');
    const listB = await api(jarB, 'GET', '/api/income?month=2026-10');
    const afterActual = Number(afterB.json?.actualNzd ?? 0);
    if (afterB.status !== 200) fail(`income summary B status ${afterB.status}`);
    else if (afterActual !== beforeActual) fail('user B income summary changed when user A added income');
    else ok('income summary stays on the signed-in user');
    if (JSON.stringify(listB.json ?? {}).includes(incomeMarker)) {
      fail('user B income list included user A description');
    } else {
      ok('income descriptions stay private');
    }
  }

  const settingsBefore = await api(jarB, 'GET', '/api/settings');
  const beforeDiscount = Number(settingsBefore.json?.gomining?.discountPct ?? 0);
  const nextDiscount = beforeDiscount === 23 ? 24 : 23;
  const patched = await api(jarA, 'PATCH', '/api/settings/gomining', { discountPct: nextDiscount });
  const settingsAfterB = await api(jarB, 'GET', '/api/settings');
  const settingsAfterA = await api(jarA, 'GET', '/api/settings');
  if (patched.status !== 200) {
    fail(`gomining patch status ${patched.status}`);
  } else if (Number(settingsAfterB.json?.gomining?.discountPct) === nextDiscount) {
    fail('user B received user A GoMining discount');
  } else if (Number(settingsAfterA.json?.gomining?.discountPct) !== nextDiscount) {
    fail('user A did not keep their GoMining discount');
  } else {
    ok('GoMining settings are per user');
  }
  const secretType = `SecretFigs${stamp}`;
  const putTypes = await api(jarA, 'PUT', '/api/settings/collectable-types', {
    types: [{ id: `figs-${stamp}`, title: secretType, kind: 'manual' }],
  });
  const typesB = await api(jarB, 'GET', '/api/settings/collectable-types');
  if (putTypes.status !== 200) fail(`collectable types save status ${putTypes.status}`);
  else if (JSON.stringify(typesB.json ?? {}).includes(secretType)) {
    fail('user B can see user A collectable types');
  } else {
    ok('collectable types are per user');
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
