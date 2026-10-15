/**
 * Households, phase 1 (KAN-77): Plus gating, create / rename / delete, invites (email match,
 * expiry, single use, revoke), roles, viewer and removed-member access, leave, transfer,
 * plan lapse, activity log and account delete.
 * Run: npm run test:household
 *
 * Uses a throwaway data dir. Does not touch data/.
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import type { AddressInfo } from 'node:net';
import type { Server } from 'node:http';
import express from 'express';

const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'pt-household-'));
process.env.DATABASE_PATH = path.join(dataDir, 'portfolio.db');
process.env.AUTH_ENCRYPTION_KEY = 'b'.repeat(64);
delete process.env.RESEND_API_KEY;
process.env.PUBLIC_URL = 'https://app.example.nz';
process.env.PLAN_PLUS_EMAILS = 'olive@example.com, Pat@Example.com';

function assert(cond: unknown, msg: string): void {
  if (!cond) throw new Error(`FAIL: ${msg}`);
}

const { getDb, run, queryAll, queryOne } = await import('../db/index.ts');
const { deleteScopedDataForUser } = await import('../lib/userScope.ts');
const { planOf, setPlan, hasFeature } = await import('../lib/entitlements.ts');
const { createSession, SESSION_COOKIE } = await import('../auth/sessions.ts');
const { attachUser, requireAuth, isPublicApiPath } = await import('../middleware/requireAuth.ts');
const { default: householdRouter } = await import('../routes/household.ts');

const now = '2026-10-05T00:00:00.000Z';
const db = await getDb();
const people = {
  olive: 'Olive Owner',
  adam: 'Adam Adult',
  vic: 'Vic Viewer',
  pat: 'Pat Plus',
  sam: 'Sam Stranger',
} as const;
for (const [id, name] of Object.entries(people)) {
  const [first, last] = name.split(' ');
  run(db, `INSERT INTO users (id, email, password_hash, first_name, last_name, created_at, updated_at) VALUES (?,?,?,?,?,?,?)`, [id, `${id}@example.com`, 'h', first, last, now, now]);
}

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
async function call(method: string, p: string, cookie?: string, body?: unknown): Promise<{ status: number; json: Json; text: string }> {
  const headers: Record<string, string> = { Accept: 'application/json' };
  if (body !== undefined) headers['Content-Type'] = 'application/json';
  if (cookie) headers.Cookie = cookie;
  const res = await fetch(`${base}${p}`, { method, headers, body: body !== undefined ? JSON.stringify(body) : undefined });
  const text = await res.text();
  let json: Json = {};
  try { json = JSON.parse(text); } catch { /* empty */ }
  return { status: res.status, json, text };
}
const tokenOf = (link: string) => link.split('#token=')[1];

try {
  // Plans: env list (case-insensitive) and table; higher wins; default free.
  assert(planOf(db, 'olive') === 'plus' && planOf(db, 'pat') === 'plus', 'Plus from PLAN_PLUS_EMAILS');
  assert(planOf(db, 'adam') === 'free' && !hasFeature(db, 'adam', 'household'), 'free by default');
  setPlan(db, 'sam', 'pro');
  assert(planOf(db, 'sam') === 'pro' && hasFeature(db, 'sam', 'household'), 'Pro from the table');
  setPlan(db, 'sam', 'free');

  assert((await call('GET', '/')).status === 401, 'signed out is 401');
  const C = Object.fromEntries(await Promise.all(Object.keys(people).map(async (u) => [u, `${SESSION_COOKIE}=${(await createSession(u)).rawToken}`])));

  // Gating: a free user can't create one.
  let r = await call('POST', '/', C.adam, { name: 'Adam house' });
  assert(r.status === 402 && r.json.code === 'PLAN_REQUIRED', 'free users can’t create a household');
  assert((await call('GET', '/', C.adam)).json.household === null, 'no household yet');

  // Create.
  assert((await call('POST', '/', C.olive, { name: ' ' })).status === 400, 'name required');
  r = await call('POST', '/', C.olive, { name: '  The   Smiths ' });
  assert(r.status === 201 && r.json.household.name === 'The Smiths' && r.json.household.myRole === 'owner', 'created, name tidied');
  assert((await call('POST', '/', C.olive, { name: 'Again' })).status === 409, 'one household per person');

  // Invites: validation, owner only, link shape.
  assert((await call('POST', '/invites', C.olive, { email: 'nope' })).status === 400, 'email checked');
  r = await call('POST', '/invites', C.olive, { email: 'Adam@Example.com', role: 'adult' });
  assert(r.status === 201 && r.json.invite.emailed === false, 'invite created; email not set up so not emailed');
  assert(r.json.invite.link.startsWith('https://app.example.nz/household/join#token='), 'link uses the public URL and a #fragment');
  const adamToken = tokenOf(r.json.invite.link);
  assert(r.json.household.invites.length === 1 && r.json.household.invites[0].email === 'adam@example.com', 'owner sees the pending invite');
  const stored = queryOne<{ token_hash: string }>(db, `SELECT token_hash FROM household_invites`)!;
  assert(stored.token_hash !== adamToken && stored.token_hash.length === 64, 'only the token hash is stored');
  r = await call('POST', '/invites', C.olive, { email: 'vic@example.com', role: 'viewer' });
  const vicToken = tokenOf(r.json.invite.link);

  // Only the invited account can use it.
  assert((await call('POST', '/invites/accept', C.sam, { token: adamToken })).status === 403, 'someone else can’t use Adam’s invite');
  assert((await call('POST', '/invites/accept', C.adam, { token: 'x'.repeat(43) })).status === 404, 'unknown token');
  const pv = await call('POST', '/invites/preview', C.adam, { token: adamToken });
  assert(pv.status === 200 && pv.json.householdName === 'The Smiths' && pv.json.inviterName === 'Olive Owner' && pv.json.role === 'adult', 'preview');
  r = await call('POST', '/invites/accept', C.adam, { token: adamToken });
  assert(r.status === 200 && r.json.household.myRole === 'adult' && r.json.household.members.length === 2, 'Adam joined as an adult');
  assert(r.json.household.invites.length === 0, 'members other than the owner never see invited email addresses');
  assert((await call('POST', '/invites/accept', C.adam, { token: adamToken })).status === 410, 'an invite works once');
  r = await call('POST', '/invites/accept', C.vic, { token: vicToken });
  assert(r.json.household.myRole === 'viewer', 'Vic joined as a viewer');

  // Expired and revoked invites.
  r = await call('POST', '/invites', C.olive, { email: 'pat@example.com', role: 'adult' });
  const patToken = tokenOf(r.json.invite.link);
  run(db, `UPDATE household_invites SET expires_at = '2020-01-01T00:00:00.000Z' WHERE email = 'pat@example.com'`);
  assert((await call('POST', '/invites/accept', C.pat, { token: patToken })).status === 410, 'expired');
  r = await call('POST', '/invites', C.olive, { email: 'pat@example.com', role: 'adult' });
  const patToken2 = tokenOf(r.json.invite.link);
  const patInvite = r.json.household.invites.find((i: Json) => i.email === 'pat@example.com' && !i.expired);
  assert((await call('DELETE', `/invites/${patInvite.id}`, C.adam)).status === 403, 'only the owner revokes');
  assert((await call('DELETE', `/invites/${patInvite.id}`, C.olive)).status === 200, 'revoked');
  assert((await call('POST', '/invites/accept', C.pat, { token: patToken2 })).status === 404, 'revoked invite is dead');

  // Viewer and adult can't do owner things.
  for (const who of ['vic', 'adam']) {
    assert((await call('PATCH', '/', C[who], { name: 'Mine' })).status === 403, `${who} can't rename`);
    assert((await call('POST', '/invites', C[who], { email: 'x@example.com' })).status === 403, `${who} can't invite`);
    assert((await call('DELETE', '/members/olive', C[who])).status === 403, `${who} can't remove`);
    assert((await call('DELETE', '/', C[who])).status === 403, `${who} can't delete`);
  }
  // Strangers see nothing and can't act on it.
  assert((await call('GET', '/', C.sam)).json.household === null, 'a stranger sees no household');
  assert((await call('DELETE', '/members/adam', C.sam)).status === 404, 'a stranger can’t remove members');

  // Roles.
  assert((await call('PATCH', '/members/vic', C.olive, { role: 'owner' })).status === 400, 'can’t make an owner by role');
  r = await call('PATCH', '/members/vic', C.olive, { role: 'adult' });
  assert(r.json.household.members.find((m: Json) => m.userId === 'vic').role === 'adult', 'role changed');
  await call('PATCH', '/members/vic', C.olive, { role: 'viewer' });

  // Removal takes effect on the next request.
  assert((await call('DELETE', '/members/vic', C.olive)).status === 200, 'Vic removed');
  assert((await call('GET', '/', C.vic)).json.household === null, 'removed member loses access immediately');
  assert((await call('POST', '/leave', C.vic)).status === 404, 'and has nothing to leave');

  // Leave and transfer.
  assert((await call('POST', '/leave', C.olive)).status === 400, 'the owner can’t just leave');
  assert((await call('POST', '/transfer', C.olive, { userId: 'adam' })).status === 402, 'the new owner needs Plus');
  setPlan(db, 'adam', 'plus');
  r = await call('POST', '/transfer', C.olive, { userId: 'adam' });
  assert(r.status === 200 && r.json.household.myRole === 'adult', 'Olive is now an adult');
  assert((await call('GET', '/', C.adam)).json.household.myRole === 'owner', 'Adam owns it');
  assert((await call('POST', '/leave', C.olive)).status === 200, 'Olive leaves');
  assert((await call('GET', '/', C.olive)).json.household === null, 'and is out');

  // Plan lapse: changes need Plus, but leaving and deleting always work.
  setPlan(db, 'adam', 'free');
  let view = (await call('GET', '/', C.adam)).json;
  assert(view.household.active === false, 'household shows as inactive');
  assert((await call('POST', '/invites', C.adam, { email: 'y@example.com' })).json.code === 'PLAN_REQUIRED', 'no invites without Plus');
  setPlan(db, 'adam', 'plus');

  // Activity log.
  view = (await call('GET', '/', C.adam)).json;
  const actions = view.household.activity.map((a: Json) => `${a.actorName}: ${a.action}`);
  for (const want of ['Olive Owner: created the household', 'Adam Adult: joined as an adult', 'Olive Owner: removed Vic Viewer', 'Olive Owner: made Adam Adult the owner', 'Olive Owner: left the household']) {
    assert(actions.includes(want), `activity has "${want}"`);
  }
  assert(!/token|adam@example|vic@example/.test(JSON.stringify(view.household.activity)), 'no tokens or emails in the activity log');

  // Account delete: an owner's household passes to an adult with Plus...
  r = await call('POST', '/invites', C.adam, { email: 'pat@example.com', role: 'adult' });
  await call('POST', '/invites/accept', C.pat, { token: tokenOf(r.json.invite.link) });
  const hhId = view.household.id;
  deleteScopedDataForUser(db, 'adam');
  assert(queryOne<{ owner_id: string }>(db, `SELECT owner_id FROM households WHERE id = ?`, [hhId])?.owner_id === 'pat', 'Pat inherits the household');
  assert(!queryOne(db, `SELECT 1 FROM household_members WHERE user_id = 'adam'`), 'Adam is gone from it');
  // ...and with nobody to take it, it is deleted.
  deleteScopedDataForUser(db, 'pat');
  assert(!queryOne(db, `SELECT 1 FROM households WHERE id = ?`, [hhId]), 'household deleted');
  assert(queryAll(db, `SELECT * FROM household_members WHERE household_id = ?`, [hhId]).length === 0, 'with its members');
  assert(queryAll(db, `SELECT * FROM household_invites WHERE household_id = ?`, [hhId]).length === 0, 'and invites');

  // Owner delete works even after the plan lapses.
  await call('POST', '/', C.olive, { name: 'Second' });
  process.env.PLAN_PLUS_EMAILS = '';
  assert((await call('DELETE', '/', C.olive)).status === 200, 'owner deletes without Plus');
  assert((await call('GET', '/', C.olive)).json.household === null, 'gone');
  console.log('household tests passed');
} finally {
  server.close();
  fs.rmSync(dataDir, { recursive: true, force: true });
}
