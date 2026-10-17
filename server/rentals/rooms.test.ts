/**
 * Rentals rooms API (KAN-83): a home with three rooms, two let; validation (negative rent and
 * bond, overlapping tenancies, own home only when let by room); rent per room matched to bank
 * deposits without double counting, and deleting rent or a room never deleting a deposit;
 * shared expenses; user isolation and account delete.
 * Run: npm run test:rentals
 *
 * Uses a throwaway data dir. Does not touch data/.
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import type { AddressInfo } from 'node:net';
import type { Server } from 'node:http';
import express from 'express';

const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'pt-rooms-'));
process.env.DATABASE_PATH = path.join(dataDir, 'portfolio.db');

function assert(cond: unknown, msg: string): void {
  if (!cond) throw new Error(`FAIL: ${msg}`);
}

const { getDb, run, queryAll, queryOne } = await import('../db/index.ts');
const { deleteScopedDataForUser, SCOPED_TABLES } = await import('../lib/userScope.ts');
const { createSession, SESSION_COOKIE } = await import('../auth/sessions.ts');
const { attachUser, requireAuth, isPublicApiPath } = await import('../middleware/requireAuth.ts');
const { default: rentalsRouter } = await import('../routes/rentals.ts');
const { linkMirroredIncomeToBankCredits } = await import('../lib/incomeBankLink.ts');
const { propertyOccupancy } = await import('../../src/lib/rentalRooms.ts');

const userA = 'room_user_a';
const userB = 'room_user_b';
const now = '2026-10-05T00:00:00.000Z';
const db = await getDb();
for (const t of ['rental_rooms', 'rental_tenancies']) {
  assert(queryOne(db, `SELECT name FROM sqlite_master WHERE type='table' AND name=?`, [t]), `schema creates ${t}`);
  assert((SCOPED_TABLES as readonly string[]).includes(t), `${t} is user-scoped`);
}
for (const [id, email] of [[userA, 'a@example.com'], [userB, 'b@example.com']]) {
  run(db, `INSERT INTO users (id, email, password_hash, created_at, updated_at) VALUES (?,?,?,?,?)`, [id, email, 'hash', now, now]);
}

const app = express();
app.use(express.json());
app.use('/api', attachUser);
app.use('/api', (req, res, next) => (isPublicApiPath(req.path) ? next() : requireAuth(req, res, next)));
app.use('/api/rentals', rentalsRouter);
const server: Server = await new Promise((resolve) => {
  const s = app.listen(0, '127.0.0.1', () => resolve(s));
});
const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
type Json = Record<string, any>;
async function call(method: string, p: string, cookie?: string, body?: unknown): Promise<{ status: number; json: Json }> {
  const headers: Record<string, string> = { Accept: 'application/json' };
  if (body !== undefined) headers['Content-Type'] = 'application/json';
  if (cookie) headers.Cookie = cookie;
  const res = await fetch(`${base}${p}`, { method, headers, body: body !== undefined ? JSON.stringify(body) : undefined });
  return { status: res.status, json: (await res.json().catch(() => ({}))) as Json };
}

const incomeRow = (entryId: string) =>
  queryOne<{ id: string; description: string; transaction_id: string | null }>(db, `SELECT * FROM income_records WHERE rental_entry_id = ?`, [entryId]);
const txnExists = (id: string) => Boolean(queryOne(db, `SELECT id FROM transactions WHERE id = ?`, [id]));
const deposit = (id: string, userId: string, date: string, amount: number) =>
  run(
    db,
    `INSERT INTO transactions (id, user_id, date, description, amount, kind, currency, source, created_at) VALUES (?,?,?,?,?, 'credit', 'NZD', 'akahu', ?)`,
    [id, userId, date, 'BOARD', amount, now],
  );

try {
  const A = `${SESSION_COOKIE}=${(await createSession(userA)).rawToken}`;
  const B = `${SESSION_COOKIE}=${(await createSession(userB)).rawToken}`;
  assert((await call('POST', '/api/rentals/rooms', undefined, { propertyId: 'x', name: 'x' })).status === 401, 'signed out is 401');

  // Property type.
  assert((await call('POST', '/api/rentals/properties', A, { name: 'Bad', letType: 'flat' })).status === 400, 'let type checked');
  assert((await call('POST', '/api/rentals/properties', A, { name: 'Bad', ownHome: true })).status === 400, 'own home needs rooms');
  const flat = (await call('POST', '/api/rentals/properties', A, { name: 'Flat' })).json;
  assert(flat.letType === 'whole' && flat.ownHome === false, 'default is a whole property');
  assert((await call('POST', '/api/rentals/rooms', A, { propertyId: flat.id, name: 'Room' })).status === 400, 'no rooms on a whole property');
  const homeRes = await call('POST', '/api/rentals/properties', A, { name: 'Home', letType: 'rooms', ownHome: true });
  assert(homeRes.status === 201 && homeRes.json.letType === 'rooms' && homeRes.json.ownHome === true, 'home let by room');
  const home = homeRes.json;

  // Rooms.
  assert((await call('POST', '/api/rentals/rooms', A, { propertyId: home.id, name: ' ' })).status === 400, 'room name required');
  assert((await call('POST', '/api/rentals/rooms', A, { propertyId: home.id, name: 'R', share: 0 })).status === 400, 'share must be positive');
  assert((await call('POST', '/api/rentals/rooms', A, { propertyId: 'nope', name: 'R' })).status === 404, 'unknown property');
  assert((await call('POST', '/api/rentals/rooms', B, { propertyId: home.id, name: 'R' })).status === 404, 'B cannot add a room to A’s home');
  const r1 = (await call('POST', '/api/rentals/rooms', A, { propertyId: home.id, name: 'Room 1', note: 'ensuite' })).json;
  const r2 = (await call('POST', '/api/rentals/rooms', A, { propertyId: home.id, name: 'Room 2', share: 1 })).json;
  const r3 = (await call('POST', '/api/rentals/rooms', A, { propertyId: home.id, name: 'Room 3', share: 2 })).json;
  assert(r1.note === 'ensuite' && r1.share === 1 && r3.share === 2, 'rooms saved');

  // Tenancies: validation.
  const tenancy = (body: Json, cookie = A) =>
    call('POST', '/api/rentals/tenancies', cookie, { roomId: r1.id, tenantLabel: 'Sam', rentAmount: 250, rentFrequency: 'weekly', startDate: '2026-10-01', ...body });
  assert((await tenancy({ rentAmount: -1 })).status === 400, 'negative rent rejected');
  assert((await tenancy({ bondAmount: -100 })).status === 400, 'negative bond rejected');
  assert((await tenancy({ rentFrequency: 'daily' })).status === 400, 'frequency checked');
  assert((await tenancy({ tenantLabel: '' })).status === 400, 'tenant label required');
  assert((await tenancy({ endDate: '2026-09-01' })).status === 400, 'end before start rejected');
  assert((await tenancy({ bondLodged: true })).status === 400, 'cannot lodge a bond of 0');
  assert((await tenancy({}, B)).status === 404, 'B cannot add a tenancy to A’s room');
  const sam = await tenancy({ bondAmount: 1000, bondLodged: true, billsIncluded: true });
  assert(sam.status === 201 && sam.json.bondLodged && sam.json.billsIncluded && sam.json.endDate === null, 'tenancy saved');
  assert(!('email' in sam.json) && !('phone' in sam.json), 'no contact details stored');

  // Overlap.
  const clash = await tenancy({ tenantLabel: 'Jo', startDate: '2027-01-01' });
  assert(clash.status === 400 && /Overlaps Sam/.test(clash.json.error), 'open-ended tenancy blocks a later one');
  const earlier = await tenancy({ tenantLabel: 'Ash', startDate: '2026-06-01', endDate: '2026-09-30' });
  assert(earlier.status === 201, 'back-to-back earlier tenancy is fine');
  assert((await call('PATCH', `/api/rentals/tenancies/${earlier.json.id}`, A, { endDate: '2026-10-01' })).status === 400, 'edit into overlap rejected');
  assert((await call('PATCH', `/api/rentals/tenancies/${earlier.json.id}`, A, { rentAmount: -5 })).status === 400, 'edit to negative rent rejected');
  assert((await call('PATCH', `/api/rentals/tenancies/${earlier.json.id}`, B, { rentAmount: 5 })).status === 404, 'B cannot edit A’s tenancy');
  assert((await call('PATCH', `/api/rentals/tenancies/${earlier.json.id}`, A, { rentAmount: 240 })).json.rentAmount === 240, 'edit saved');
  const kim = await tenancy({ roomId: r2.id, tenantLabel: 'Kim', rentAmount: 560, rentFrequency: 'fortnightly', startDate: '2026-10-01' });
  assert(kim.status === 201, 'second room let');
  assert((await tenancy({ roomId: r2.id, tenantLabel: 'Kim', startDate: '2026-10-01' })).status === 400, 'same room same day rejected');

  // Rent per room: mirrored into Income with the room name, matched to the deposit once.
  deposit('dep_sam', userA, '2026-10-08', 250);
  deposit('dep_kim', userA, '2026-10-08', 250); // same amount, same day: a second, separate deposit
  deposit('dep_b', userB, '2026-10-08', 250);
  const rent = (body: Json, cookie = A) =>
    call('POST', '/api/rentals/entries', cookie, { propertyId: home.id, date: '2026-10-08', kind: 'income', category: 'rent', amountNzd: 250, ...body });
  assert((await rent({ roomId: 'nope' })).status === 404, 'unknown room');
  assert((await rent({ propertyId: flat.id, roomId: r1.id })).status === 400, 'room must be in the property');
  assert((await rent({ roomId: r1.id, kind: 'expense', category: 'rates' })).status === 400, 'expenses are not per room');
  const samRent = await rent({ roomId: r1.id, description: 'Rent · Sam' });
  assert(samRent.status === 201 && samRent.json.roomId === r1.id, 'rent recorded for the room');
  assert(incomeRow(samRent.json.id)!.description === 'Rent · Sam · Room 1 · Home', 'income row names the room');
  const kimRent = await rent({ roomId: r2.id });
  const samLink = incomeRow(samRent.json.id)!.transaction_id;
  const kimLink = incomeRow(kimRent.json.id)!.transaction_id;
  assert(samLink && kimLink && samLink !== kimLink, 'each rent payment links its own deposit');
  assert(samLink !== 'dep_b' && kimLink !== 'dep_b', 'another user’s deposit never matches');
  linkMirroredIncomeToBankCredits(db, userA);
  const linkedTo = queryAll<{ transaction_id: string }>(
    db,
    `SELECT transaction_id FROM income_records WHERE user_id = ? AND transaction_id IN ('dep_sam','dep_kim')`,
    [userA],
  );
  assert(linkedTo.length === 2, 'no deposit is linked twice after another pass');
  const third = await rent({ roomId: r1.id, date: '2026-10-09' });
  assert(incomeRow(third.json.id)!.transaction_id === null, 'a third payment with no deposit left stays unlinked');

  // Deleting rent never deletes the deposit.
  assert((await call('DELETE', `/api/rentals/entries/${samRent.json.id}`, A)).status === 200, 'rent deleted');
  assert(!incomeRow(samRent.json.id) && txnExists(samLink!), 'its income row goes, the deposit stays');
  assert((await call('DELETE', `/api/rentals/entries/${kimRent.json.id}`, B)).status === 404, 'B cannot delete A’s rent');

  // Shared expenses.
  const shared = (body: Json) =>
    call('POST', '/api/rentals/entries', A, { propertyId: home.id, date: '2026-10-03', kind: 'expense', category: 'utilities', amountNzd: 400, shared: true, ...body });
  assert((await shared({ propertyId: flat.id })).status === 400, 'whole property expenses are not shared');
  assert((await shared({ kind: 'income', category: 'rent' })).status === 400, 'income is not shared');
  const power = await shared({});
  assert(power.status === 201 && power.json.shared === true, 'shared expense saved');
  const moved = await call('PATCH', `/api/rentals/entries/${power.json.id}`, A, { propertyId: flat.id });
  assert(moved.status === 200 && moved.json.shared === false, 'moving to a whole property drops the split');
  await call('PATCH', `/api/rentals/entries/${power.json.id}`, A, { propertyId: home.id, shared: true });

  // Occupancy from the listed data: three rooms, two let, one vacant; expected vs received.
  const list = (await call('GET', '/api/rentals', A)).json;
  assert(list.rooms.length === 3 && list.tenancies.length === 3, 'rooms and tenancies listed');
  const occ = propertyOccupancy(home.id, list.rooms, list.tenancies, list.entries, 2027, '2026-10-14');
  assert(occ.occupied === 2 && occ.vacant === 1, 'two let, one vacant');
  assert(occ.expected === 5242.86 && occ.received === 500, `expected vs received (${occ.expected}, ${occ.received})`);
  assert(occ.sharedCosts === 400 && occ.rooms[2].sharedCosts === 200, 'shared cost split by share');
  const bList = (await call('GET', '/api/rentals', B)).json;
  assert(bList.rooms.length === 0 && bList.tenancies.length === 0, 'B sees none of A’s rooms or tenancies');

  // Room rename follows into Income; whole-property switch blocked while rooms exist.
  await call('PATCH', `/api/rentals/rooms/${r2.id}`, A, { name: 'Sunroom' });
  assert(incomeRow(kimRent.json.id)!.description === 'Rent · Sunroom · Home', 'rename updates the income row');
  assert((await call('PATCH', `/api/rentals/rooms/${r2.id}`, B, { name: 'x' })).status === 404, 'B cannot rename A’s room');
  assert((await call('PATCH', `/api/rentals/properties/${home.id}`, A, { letType: 'whole' })).status === 400, 'cannot go whole with rooms');
  assert((await call('PATCH', `/api/rentals/properties/${home.id}`, A, { ownHome: false })).json.ownHome === false, 'own home switched off');

  // Deleting a room keeps its rent on the property and in Income; the deposit is untouched.
  assert((await call('DELETE', `/api/rentals/rooms/${r2.id}`, B)).status === 404, 'B cannot delete A’s room');
  assert((await call('DELETE', `/api/rentals/rooms/${r2.id}`, A)).status === 200, 'room deleted');
  assert(queryAll(db, `SELECT id FROM rental_tenancies WHERE room_id = ?`, [r2.id]).length === 0, 'its tenancies go');
  const kept = incomeRow(kimRent.json.id)!;
  assert(kept.description === 'Rent · Home' && kept.transaction_id === kimLink && txnExists(kimLink!), 'rent kept, still linked');
  assert(queryOne<{ room_id: string | null }>(db, `SELECT room_id FROM rental_entries WHERE id = ?`, [kimRent.json.id])!.room_id === null, 'rent no longer names the room');

  // Tenancy delete; B can't.
  assert((await call('DELETE', `/api/rentals/tenancies/${sam.json.id}`, B)).status === 404, 'B cannot delete A’s tenancy');
  assert((await call('DELETE', `/api/rentals/tenancies/${sam.json.id}`, A)).status === 200, 'tenancy deleted');

  // Deleting the property removes rooms and tenancies, keeps the deposits.
  assert((await call('DELETE', `/api/rentals/properties/${home.id}`, A)).status === 200, 'home deleted');
  assert(queryAll(db, `SELECT id FROM rental_rooms WHERE property_id = ?`, [home.id]).length === 0, 'rooms gone');
  assert(queryAll(db, `SELECT id FROM rental_tenancies WHERE user_id = ?`, [userA]).length === 0, 'tenancies gone');
  assert(txnExists('dep_sam') && txnExists('dep_kim'), 'deposits kept');

  // Account delete takes rooms and tenancies with it, and only A's.
  const bHome = (await call('POST', '/api/rentals/properties', B, { name: 'B home', letType: 'rooms' })).json;
  const bRoom = (await call('POST', '/api/rentals/rooms', B, { propertyId: bHome.id, name: 'B room' })).json;
  await call('POST', '/api/rentals/tenancies', B, { roomId: bRoom.id, tenantLabel: 'Lee', rentAmount: 200, rentFrequency: 'weekly', startDate: '2026-10-01' });
  const aHome = (await call('POST', '/api/rentals/properties', A, { name: 'A2', letType: 'rooms' })).json;
  const aRoom = (await call('POST', '/api/rentals/rooms', A, { propertyId: aHome.id, name: 'A room' })).json;
  await call('POST', '/api/rentals/tenancies', A, { roomId: aRoom.id, tenantLabel: 'Max', rentAmount: 200, rentFrequency: 'weekly', startDate: '2026-10-01' });
  deleteScopedDataForUser(db, userA);
  for (const tbl of ['rental_rooms', 'rental_tenancies']) {
    assert(queryAll(db, `SELECT id FROM ${tbl} WHERE user_id = ?`, [userA]).length === 0, `${tbl} deleted with the account`);
    assert(queryAll(db, `SELECT id FROM ${tbl} WHERE user_id = ?`, [userB]).length === 1, `B’s ${tbl} kept`);
  }
  console.log('rentals rooms tests passed');
} finally {
  server.close();
  fs.rmSync(dataDir, { recursive: true, force: true });
}
