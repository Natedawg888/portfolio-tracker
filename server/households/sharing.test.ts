/**
 * Household sharing, phase 2 (KAN-77): sharing own items only, each member seeing only what
 * is shared plus their own, the dashboard (net worth, budget spending from shared accounts
 * only, bills, goals, who-made-it transactions), adults editing shared items, viewers not,
 * and shares disappearing when someone leaves, is removed, or the household is deleted.
 * Run: npm run test:household
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import type { AddressInfo } from 'node:net';
import type { Server } from 'node:http';
import express from 'express';

const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'pt-hh-sharing-'));
process.env.DATABASE_PATH = path.join(dataDir, 'portfolio.db');
process.env.AUTH_ENCRYPTION_KEY = 'c'.repeat(64);
process.env.PLAN_PLUS_EMAILS = 'olive@example.com';
delete process.env.RESEND_API_KEY;

function assert(cond: unknown, msg: string): void {
  if (!cond) throw new Error(`FAIL: ${msg}`);
}

const { getDb, run, queryOne, queryAll } = await import('../db/index.ts');
const { createSession, SESSION_COOKIE } = await import('../auth/sessions.ts');
const { attachUser, requireAuth, isPublicApiPath } = await import('../middleware/requireAuth.ts');
const { aucklandToday } = await import('../debts/model.ts');
const { default: householdRouter } = await import('../routes/household.ts');

const now = '2026-10-05T00:00:00.000Z';
const today = aucklandToday();
const month = today.slice(0, 7);
const soon = new Date(Date.parse(`${today}T00:00:00Z`) + 5 * 86_400_000).toISOString().slice(0, 10);
const db = await getDb();
for (const [id, first] of [['olive', 'Olive'], ['adam', 'Adam'], ['vic', 'Vic'], ['sam', 'Sam']]) {
  run(db, `INSERT INTO users (id, email, password_hash, first_name, last_name, created_at, updated_at) VALUES (?,?,?,?,?,?,?)`, [id, `${id}@example.com`, 'h', first, 'Test', now, now]);
}
const cat = (id: string, user: string, slug: string | null, name: string) =>
  run(db, `INSERT INTO budget_categories (id, user_id, slug, name, type, is_income, sort_order) VALUES (?,?,?,?, 'spending', 0, 1)`, [id, user, slug, name]);
cat('food_o', 'olive', 'cat-food', 'Food & groceries');
cat('food_a', 'adam', 'cat-food', 'Food & groceries');
cat('pets_o', 'olive', null, 'Pets');
cat('pets_a', 'adam', null, 'pets');
cat('secret_a', 'adam', null, 'Hobbies');
const acct = (id: string, user: string, name: string, balance: number, type = 'cheque') =>
  run(db, `INSERT INTO bank_accounts (id, user_id, name, institution, account_type, currency, balance, created_at, updated_at) VALUES (?,?,?,?,?, 'NZD', ?,?,?)`, [id, user, name, 'Bank', type, balance, now, now]);
acct('acct_o', 'olive', 'Olive everyday', 1000);
acct('acct_a', 'adam', 'Adam everyday', 500);
acct('acct_p', 'adam', 'Adam private', 2000);
acct('card_o', 'olive', 'Joint card', -250, 'credit');
const txn = (id: string, user: string, account: string, category: string, amount: number, desc: string) =>
  run(db, `INSERT INTO transactions (id, user_id, account_id, date, description, amount, kind, category_id, currency, source, created_at) VALUES (?,?,?,?,?,?, 'debit', ?, 'NZD', 'manual', ?)`, [id, user, account, `${month}-02`, desc, amount, category, now]);
txn('t_o', 'olive', 'acct_o', 'food_o', -50, 'Pak n Save');
txn('t_a', 'adam', 'acct_a', 'food_a', -30, 'Countdown');
txn('t_p', 'adam', 'acct_p', 'food_a', -999, 'Private groceries');
txn('t_pet', 'adam', 'acct_a', 'pets_a', -20, 'Vet');
run(db, `INSERT INTO budgets (id, user_id, category_id, period_start, period_end, amount_nzd) VALUES ('b_food','olive','food_o',?,?,400)`, [`${month}-01`, `${month}-28`]);
run(db, `INSERT INTO savings_goals (id, user_id, name, target_nzd, current_amount_nzd, created_at, updated_at) VALUES ('g_hol','olive','Holiday',3000,500,?,?)`, [now, now]);
run(db, `INSERT INTO savings_goals (id, user_id, name, target_nzd, current_amount_nzd, created_at, updated_at) VALUES ('g_sec','adam','Secret',100,10,?,?)`, [now, now]);
run(db, `INSERT INTO recurring_items (id, user_id, name, kind, amount_nzd, cadence, next_due, status, source, created_at, updated_at) VALUES ('r_power','olive','Power','bill',180,'monthly',?, 'active','manual',?,?)`, [soon, now, now]);
run(db, `INSERT INTO holdings (id, user_id, asset_class, name, created_at, updated_at, last_valuation_nzd) VALUES ('h_art','olive','art','Painting',?,?,1200)`, [now, now]);

const app = express();
app.use(express.json());
app.use('/api', attachUser);
app.use('/api', (req, res, next) => (isPublicApiPath(req.path) ? next() : requireAuth(req, res, next)));
app.use('/api/household', householdRouter);
const server: Server = await new Promise((resolve) => {
  const s = app.listen(0, '127.0.0.1', () => resolve(s));
});
const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}/api/household`;
type Json = Record<string, any>;
async function call(method: string, p: string, cookie: string, body?: unknown): Promise<{ status: number; json: Json; text: string }> {
  const headers: Record<string, string> = { Accept: 'application/json', Cookie: cookie };
  if (body !== undefined) headers['Content-Type'] = 'application/json';
  const res = await fetch(`${base}${p}`, { method, headers, body: body !== undefined ? JSON.stringify(body) : undefined });
  const text = await res.text();
  let json: Json = {};
  try { json = JSON.parse(text); } catch { /* empty */ }
  return { status: res.status, json, text };
}

try {
  const C = Object.fromEntries(await Promise.all(['olive', 'adam', 'vic', 'sam'].map(async (u) => [u, `${SESSION_COOKIE}=${(await createSession(u)).rawToken}`])));
  await call('POST', '/', C.olive, { name: 'Home' });
  for (const [who, role] of [['adam', 'adult'], ['vic', 'viewer']]) {
    const inv = await call('POST', '/invites', C.olive, { email: `${who}@example.com`, role });
    await call('POST', '/invites/accept', C[who], { token: inv.json.invite.link.split('#token=')[1] });
  }

  // Nothing shared yet.
  let d = (await call('GET', '/dashboard', C.adam)).json;
  assert(d.budgets.length === 0 && d.goals.length === 0 && d.netWorth.totalNzd === 0 && d.transactions.length === 0, 'nothing shared by default');
  assert((await call('GET', '/dashboard', C.sam)).status === 404, 'a stranger has no dashboard');

  // Only your own items can be shared.
  assert((await call('PUT', '/shares', C.adam, { kind: 'goal', itemId: 'g_hol', shared: true })).status === 404, 'can’t share someone else’s goal');
  assert((await call('PUT', '/shares', C.adam, { kind: 'nope', itemId: 'x', shared: true })).status === 400, 'kind checked');
  const share = (who: string, kind: string, itemId: string, shared = true) => call('PUT', '/shares', C[who], { kind, itemId, shared });
  let r = await share('olive', 'budget', 'food_o');
  assert(r.status === 200 && r.json.budget.find((b: Json) => b.id === 'food_o').shared, 'Olive shares her food budget');
  await share('olive', 'budget', 'pets_o');
  await share('olive', 'goal', 'g_hol');
  await share('olive', 'bill', 'r_power');
  await share('olive', 'holding', 'h_art');
  await share('olive', 'account', 'acct_o');
  await share('olive', 'account', 'card_o');
  await share('adam', 'account', 'acct_a');

  // Done-when: each sees the shared items plus their own, never the other's unshared ones.
  for (const who of ['olive', 'adam', 'vic']) {
    d = (await call('GET', '/dashboard', C[who])).json;
    const text = JSON.stringify(d);
    assert(d.goals.length === 1 && d.goals[0].name === 'Holiday' && d.goals[0].owner === 'Olive Test', `${who} sees the shared goal`);
    assert(!text.includes('Secret') && !text.includes('Adam private') && !text.includes('Private groceries') && !text.includes('999'), `${who} never sees Adam’s unshared goal, account or spending`);
    assert(!text.includes('Hobbies'), `${who} doesn’t see unshared categories`);
  }
  const shareableAdam = (await call('GET', '/shareable', C.adam)).json;
  assert(shareableAdam.goal.map((g: Json) => g.name).join() === 'Secret' && !JSON.stringify(shareableAdam).includes('Holiday'), 'the shareable list is only your own items');

  // Dashboard figures.
  d = (await call('GET', '/dashboard', C.adam)).json;
  const food = d.budgets.find((b: Json) => b.name === 'Food & groceries');
  assert(food.plannedNzd === 400 && food.spentNzd === 80 && food.remainingNzd === 320, `budget spent counts shared accounts only (50 + 30), got ${food.spentNzd}`);
  const pets = d.budgets.find((b: Json) => b.name === 'Pets');
  assert(pets.spentNzd === 20 && pets.plannedNzd === null, 'custom categories match by name across members');
  assert(d.netWorth.totalNzd === 1000 - 250 + 500 + 1200, `shared net worth = accounts + card + holding, got ${d.netWorth.totalNzd}`);
  assert(d.netWorth.holdings[0].name === 'Painting' && d.netWorth.holdings[0].valueNzd === 1200, 'holding valued by its owner’s valuation');
  assert(d.bills.length === 1 && d.bills[0].name === 'Power' && d.bills[0].nextDue === soon, 'upcoming shared bill');
  const who = Object.fromEntries(d.transactions.map((t: Json) => [t.description, t.member]));
  assert(who['Pak n Save'] === 'Olive Test' && who.Countdown === 'Adam Test' && !('Private groceries' in who), 'transactions on shared accounts show who made them');

  // Editing: adults yes, viewers no, unshared items no.
  assert((await call('PATCH', '/shared/budget/food_o', C.vic, { amountNzd: 500 })).status === 403, 'a viewer can’t edit');
  assert((await call('PATCH', '/shared/goal/g_hol', C.vic, { targetNzd: 1 })).status === 403, 'a viewer can’t edit goals');
  assert((await call('PATCH', '/shared/budget/food_o', C.adam, { amountNzd: -5 })).status === 400, 'plan validated');
  assert((await call('PATCH', '/shared/budget/food_o', C.adam, { amountNzd: 450 })).status === 200, 'an adult edits the shared budget');
  assert(Number(queryOne<{ amount_nzd: number }>(db, `SELECT amount_nzd FROM budgets WHERE id = 'b_food'`)?.amount_nzd) === 450, 'in the owner’s own plan row');
  assert((await call('PATCH', '/shared/goal/g_hol', C.adam, { currentAmountNzd: 750, name: 'Hacked' })).status === 200, 'an adult updates the shared goal');
  const goal = queryOne<{ name: string; current_amount_nzd: number }>(db, `SELECT name, current_amount_nzd FROM savings_goals WHERE id = 'g_hol'`)!;
  assert(goal.current_amount_nzd === 750 && goal.name === 'Holiday', 'amount changed; the name stays with the owner');
  assert((await call('PATCH', '/shared/bill/r_power', C.adam, { amountNzd: 195 })).status === 200, 'an adult updates a shared bill');
  assert((await call('PATCH', '/shared/goal/g_sec', C.olive, { targetNzd: 1 })).status === 404, 'unshared goals can’t be edited by others');
  assert((await call('PATCH', '/shared/budget/food_a', C.olive, { amountNzd: 1 })).status === 404, 'nor unshared budgets');
  d = (await call('GET', '/dashboard', C.vic)).json;
  assert(d.canEdit === false && d.budgets.find((b: Json) => b.name === 'Food & groceries').plannedNzd === 450, 'the viewer sees the change but can’t edit');
  const acts = (await call('GET', '/', C.olive)).json.household.activity.map((a: Json) => `${a.actorName}: ${a.action}`);
  assert(acts.includes('Olive Test: shared a goal') && acts.includes('Adam Test: changed a shared budget'), 'sharing and edits are in the activity log');

  // Unsharing hides it again.
  await share('olive', 'goal', 'g_hol', false);
  assert((await call('GET', '/dashboard', C.adam)).json.goals.length === 0, 'unshared goal disappears');
  assert((await call('PATCH', '/shared/goal/g_hol', C.adam, { targetNzd: 1 })).status === 404, 'and can’t be edited');

  // Leaving removes that member's shares; their items are untouched.
  await call('POST', '/leave', C.adam);
  assert(!queryOne(db, `SELECT 1 FROM household_shares WHERE owner_id = 'adam'`), 'Adam’s shares are gone');
  assert(queryOne(db, `SELECT 1 FROM bank_accounts WHERE id = 'acct_a' AND user_id = 'adam'`), 'his account is still his');
  assert((await call('GET', '/dashboard', C.adam)).status === 404, 'and he no longer sees the dashboard');
  d = (await call('GET', '/dashboard', C.olive)).json;
  assert(!JSON.stringify(d).includes('Adam everyday') && d.budgets.find((b: Json) => b.name === 'Food & groceries').spentNzd === 50, 'his account no longer counts');

  // Removal and household delete.
  await call('DELETE', '/members/vic', C.olive);
  assert((await call('GET', '/dashboard', C.vic)).status === 404, 'a removed member loses the dashboard at once');
  await call('DELETE', '/', C.olive);
  assert(queryAll(db, `SELECT * FROM household_shares`).length === 0, 'deleting the household drops every share');
  assert(queryOne(db, `SELECT 1 FROM savings_goals WHERE id = 'g_hol' AND user_id = 'olive'`) && queryOne(db, `SELECT 1 FROM holdings WHERE id = 'h_art' AND user_id = 'olive'`), 'and every item stays with its owner');
  console.log('household sharing tests passed');
} finally {
  server.close();
  fs.rmSync(dataDir, { recursive: true, force: true });
}
