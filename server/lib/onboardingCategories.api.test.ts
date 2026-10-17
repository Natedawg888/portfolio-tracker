/**
 * What the onboarding categories step relies on (src/lib/onboardingCategories.ts): deleting a
 * starter category keeps it deleted when seeding runs again, and recreating it with its slug gives
 * the user a row the app finds by that slug again. Built-in ones can't be deleted.
 * Run: npm run test:onboarding-categories
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import type { AddressInfo } from 'node:net';
import type { Server } from 'node:http';
import express from 'express';

const dbPath = path.join(os.tmpdir(), `pt-onb-cats-${process.pid}-${Date.now()}.db`);
process.env.DATABASE_PATH = dbPath;

function assert(cond: unknown, msg: string): void {
  if (!cond) throw new Error(`FAIL: ${msg}`);
}

const { getDb, run, queryAll } = await import('../db/index.ts');
const { seedCategoriesForUser, resolveCategoryId } = await import('./categories.ts');
const { createSession, SESSION_COOKIE } = await import('../auth/sessions.ts');
const { attachUser, requireAuth } = await import('../middleware/requireAuth.ts');
const { default: budgetsRouter } = await import('../routes/budgets.ts');

const db = await getDb();
const userId = 'onb_cats_user';
const now = new Date().toISOString();
run(db, `INSERT INTO users (id, email, password_hash, created_at, updated_at) VALUES (?,?,?,?,?)`, [userId, 'onb@example.test', 'hash', now, now]);
seedCategoriesForUser(db, userId);

const app = express();
app.use(express.json());
app.use('/api', attachUser, requireAuth);
app.use('/api/budgets', budgetsRouter);
const server: Server = await new Promise((resolve) => {
  const s = app.listen(0, '127.0.0.1', () => resolve(s));
});
const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
const cookie = `${SESSION_COOKIE}=${(await createSession(userId)).rawToken}`;
async function call(method: string, p: string, body?: unknown) {
  const res = await fetch(`${base}/api/budgets${p}`, { method, headers: { Cookie: cookie, 'Content-Type': 'application/json' }, body: body ? JSON.stringify(body) : undefined });
  return { status: res.status, json: (await res.json().catch(() => ({}))) as Record<string, unknown> };
}

try {
  const list = (await call('GET', '/categories')).json as unknown as { id: string; slug: string; name: string }[];
  assert(list.every((c) => typeof c.slug === 'string'), 'categories come with their slug');
  const subs = list.find((c) => c.slug === 'cat-subscriptions')!;
  const debt = list.find((c) => c.slug === 'cat-debt')!;
  assert((await call('DELETE', `/categories/${encodeURIComponent(debt.id)}`)).status === 400, 'a built-in category can’t be deleted');
  assert((await call('DELETE', `/categories/${encodeURIComponent(subs.id)}`)).status === 200, 'an unused starter category is deleted');
  seedCategoriesForUser(db, userId);
  assert(!resolveCategoryId(db, userId, 'cat-subscriptions'), 'seeding again doesn’t bring it back');

  const back = await call('POST', '/categories', { name: 'Subscriptions', type: 'spending', slug: 'cat-subscriptions', id: 'cat-subscriptions', sortOrder: 70 });
  assert(back.status === 201 && back.json.slug === 'cat-subscriptions', 'recreated with its slug');
  assert(back.json.id === `cat-subscriptions__${userId}`, 'with the usual per-user id');
  assert(resolveCategoryId(db, userId, 'cat-subscriptions') === back.json.id, 'the app finds it by slug again');
  seedCategoriesForUser(db, userId);
  assert(queryAll(db, `SELECT id FROM budget_categories WHERE user_id = ? AND slug = 'cat-subscriptions'`, [userId]).length === 1, 'no duplicate after seeding');

  const pets = await call('POST', '/categories', { name: 'Pets', type: 'spending' });
  assert(pets.status === 201 && pets.json.type === 'spending', 'a new category is created');
  console.log('onboarding categories api: ok');
} finally {
  await new Promise<void>((resolve) => server.close(() => resolve()));
  for (const suffix of ['', '.tmp']) if (fs.existsSync(`${dbPath}${suffix}`)) fs.unlinkSync(`${dbPath}${suffix}`);
}
