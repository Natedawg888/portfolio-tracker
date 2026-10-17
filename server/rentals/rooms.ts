/**
 * Rooms let in a rental property and the tenancies in them, for one user (KAN-83). Every
 * query filters on user_id. A room belongs to a property let by room; a tenancy names the
 * tenant by a display label only (no contact details). Tenancies in one room never overlap.
 * Rent received is a rental entry with the room's id (store.ts), so it reaches Budget and
 * Income, and is matched to a bank deposit, the same way as any rental income.
 */
import type { Database } from 'sql.js';
import type { RentalRoom, RentalTenancy } from '../../src/types/index.ts';
import { isRentFrequency, tenanciesOverlap, type RentFrequency } from '../../src/lib/rentalRooms.ts';
import { isYmd } from '../../src/lib/invoiceCalc.ts';
import { newId, queryAll, queryOne, run } from '../db/index.ts';
import { roundMoney } from '../debts/model.ts';
import { body, propertyRow, syncMirror, text, type Parsed } from './store.ts';

export const NO_ROOM = 'Room not found';
export const NO_TENANCY = 'Tenancy not found';
const MAX_ROOMS = 20;
const MAX_MONEY = 1_000_000;

export type RoomDraft = { propertyId: string; name: string; note: string; share: number };

export type TenancyDraft = {
  roomId: string;
  tenantLabel: string;
  rentAmount: number;
  rentFrequency: RentFrequency;
  billsIncluded: boolean;
  startDate: string;
  endDate: string | null;
  bondAmount: number;
  bondLodged: boolean;
};

/** A non-negative amount, or an error. Blank counts as 0 when allowed. */
function money(v: unknown, label: string, blankIsZero: boolean): Parsed<number> {
  if ((v === null || v === '' || v === undefined) && blankIsZero) return { ok: true, value: 0 };
  const n = Number(v);
  if (v === null || v === '' || typeof v === 'boolean' || !Number.isFinite(n)) return { ok: false, error: `${label} must be a number` };
  if (n < 0) return { ok: false, error: `${label} can't be negative` };
  if (n > MAX_MONEY) return { ok: false, error: `${label} is too large` };
  return { ok: true, value: roundMoney(n) };
}

export function parseRoom(raw: unknown, partial: boolean): Parsed<Partial<RoomDraft>> {
  const o = body(raw);
  if (!o) return { ok: false, error: 'Body is required' };
  const out: Partial<RoomDraft> = {};
  if (!partial) {
    const id = text(o.propertyId);
    if (!id) return { ok: false, error: 'Property is required' };
    out.propertyId = id;
  }
  if (o.name !== undefined || !partial) {
    const name = text(o.name);
    if (!name) return { ok: false, error: 'Room name is required' };
    if (name.length > 60) return { ok: false, error: 'Room name must be 60 characters or fewer' };
    out.name = name;
  }
  if (o.note !== undefined || !partial) {
    const note = text(o.note);
    if (note.length > 120) return { ok: false, error: 'Note must be 120 characters or fewer' };
    out.note = note;
  }
  if (o.share !== undefined) {
    const n = Number(o.share);
    if (o.share === null || o.share === '' || !Number.isFinite(n) || n <= 0 || n > 100) {
      return { ok: false, error: 'Share must be more than 0 and at most 100' };
    }
    out.share = Math.round(n * 100) / 100;
  } else if (!partial) out.share = 1;
  return { ok: true, value: out };
}

/** Field checks only; overlap and room ownership are checked on save. */
export function parseTenancy(raw: unknown, partial: boolean): Parsed<Partial<TenancyDraft>> {
  const o = body(raw);
  if (!o) return { ok: false, error: 'Body is required' };
  const out: Partial<TenancyDraft> = {};
  if (!partial) {
    const id = text(o.roomId);
    if (!id) return { ok: false, error: 'Room is required' };
    out.roomId = id;
  }
  if (o.tenantLabel !== undefined || !partial) {
    const label = text(o.tenantLabel);
    if (!label) return { ok: false, error: 'Tenant name is required' };
    if (label.length > 60) return { ok: false, error: 'Tenant name must be 60 characters or fewer' };
    out.tenantLabel = label;
  }
  if (o.rentAmount !== undefined || !partial) {
    const m = money(o.rentAmount, 'Rent', false);
    if (!m.ok) return m;
    out.rentAmount = m.value;
  }
  if (o.rentFrequency !== undefined || !partial) {
    if (!isRentFrequency(o.rentFrequency)) return { ok: false, error: 'Rent frequency must be weekly, fortnightly or monthly' };
    out.rentFrequency = o.rentFrequency;
  }
  if (o.billsIncluded !== undefined) out.billsIncluded = o.billsIncluded === true;
  else if (!partial) out.billsIncluded = false;
  if (o.startDate !== undefined || !partial) {
    if (!isYmd(o.startDate)) return { ok: false, error: 'Start date must be YYYY-MM-DD' };
    out.startDate = o.startDate;
  }
  if (o.endDate !== undefined || !partial) {
    if (o.endDate === null || o.endDate === undefined || o.endDate === '') out.endDate = null;
    else if (!isYmd(o.endDate)) return { ok: false, error: 'End date must be YYYY-MM-DD' };
    else out.endDate = o.endDate;
  }
  if (o.bondAmount !== undefined || !partial) {
    const m = money(o.bondAmount, 'Bond', true);
    if (!m.ok) return m;
    out.bondAmount = m.value;
  }
  if (o.bondLodged !== undefined) out.bondLodged = o.bondLodged === true;
  else if (!partial) out.bondLodged = false;
  return { ok: true, value: out };
}

export type RoomRow = { id: string; property_id: string; name: string; note: string; share: number; created_at: string; updated_at: string };

type TenancyRow = {
  id: string;
  room_id: string;
  tenant_label: string;
  rent_amount: number;
  rent_frequency: RentFrequency;
  bills_included: number;
  start_date: string;
  end_date: string | null;
  bond_amount: number;
  bond_lodged: number;
  created_at: string;
  updated_at: string;
};

function presentRoom(r: RoomRow): RentalRoom {
  return {
    id: r.id,
    propertyId: r.property_id,
    name: r.name,
    note: r.note ?? '',
    share: Number(r.share) || 1,
    createdAt: r.created_at,
    updatedAt: r.updated_at,
  };
}

function presentTenancy(r: TenancyRow): RentalTenancy {
  return {
    id: r.id,
    roomId: r.room_id,
    tenantLabel: r.tenant_label,
    rentAmount: roundMoney(Number(r.rent_amount)),
    rentFrequency: r.rent_frequency,
    billsIncluded: Boolean(r.bills_included),
    startDate: r.start_date,
    endDate: r.end_date ?? null,
    bondAmount: roundMoney(Number(r.bond_amount)),
    bondLodged: Boolean(r.bond_lodged),
    createdAt: r.created_at,
    updatedAt: r.updated_at,
  };
}

export function listRooms(db: Database, userId: string): RentalRoom[] {
  return queryAll<RoomRow>(db, `SELECT * FROM rental_rooms WHERE user_id = ? ORDER BY created_at, id`, [userId]).map(presentRoom);
}

export function listTenancies(db: Database, userId: string): RentalTenancy[] {
  return queryAll<TenancyRow>(db, `SELECT * FROM rental_tenancies WHERE user_id = ? ORDER BY start_date DESC, created_at DESC`, [userId]).map(
    presentTenancy,
  );
}

export function roomRow(db: Database, userId: string, id: string): RoomRow | null {
  return queryOne<RoomRow>(db, `SELECT * FROM rental_rooms WHERE id = ? AND user_id = ?`, [id, userId]) ?? null;
}

function tenancyRow(db: Database, userId: string, id: string): TenancyRow | null {
  return queryOne<TenancyRow>(db, `SELECT * FROM rental_tenancies WHERE id = ? AND user_id = ?`, [id, userId]) ?? null;
}

// ---------------------------------------------------------------- rooms

export function createRoom(db: Database, userId: string, d: RoomDraft): Parsed<RentalRoom> {
  const property = propertyRow(db, userId, d.propertyId);
  if (!property) return { ok: false, error: 'Property not found' };
  if (property.let_type !== 'rooms') return { ok: false, error: 'Set the property to let by room first' };
  const count = queryOne<{ c: number }>(db, `SELECT COUNT(*) AS c FROM rental_rooms WHERE user_id = ? AND property_id = ?`, [userId, d.propertyId]);
  if (Number(count?.c ?? 0) >= MAX_ROOMS) return { ok: false, error: `A property can have up to ${MAX_ROOMS} rooms` };
  const id = newId('rroom');
  const now = new Date().toISOString();
  run(
    db,
    `INSERT INTO rental_rooms (id, user_id, property_id, name, note, share, created_at, updated_at) VALUES (?,?,?,?,?,?,?,?)`,
    [id, userId, d.propertyId, d.name, d.note, d.share, now, now],
  );
  return { ok: true, value: presentRoom(roomRow(db, userId, id)!) };
}

/** null = not found. */
export function updateRoom(db: Database, userId: string, id: string, patch: Partial<RoomDraft>): RentalRoom | null {
  const r = roomRow(db, userId, id);
  if (!r) return null;
  const name = patch.name ?? r.name;
  run(db, `UPDATE rental_rooms SET name=?, note=?, share=?, updated_at=? WHERE id=? AND user_id=?`, [
    name, patch.note ?? r.note, patch.share ?? r.share, new Date().toISOString(), id, userId,
  ]);
  // Mirrored income rows carry the room name in their description.
  if (name !== r.name) {
    for (const e of queryAll<{ id: string }>(db, `SELECT id FROM rental_entries WHERE room_id = ? AND user_id = ?`, [id, userId])) {
      syncMirror(db, userId, e.id);
    }
  }
  return presentRoom(roomRow(db, userId, id)!);
}

/**
 * Deletes the room and its tenancies. Rent recorded for it stays on the property (and in
 * Budget / Income); it just no longer names the room.
 */
export function deleteRoom(db: Database, userId: string, id: string): boolean {
  if (!roomRow(db, userId, id)) return false;
  run(db, `DELETE FROM rental_tenancies WHERE room_id = ? AND user_id = ?`, [id, userId]);
  const entries = queryAll<{ id: string }>(db, `SELECT id FROM rental_entries WHERE room_id = ? AND user_id = ?`, [id, userId]);
  run(db, `UPDATE rental_entries SET room_id = NULL WHERE room_id = ? AND user_id = ?`, [id, userId]);
  run(db, `DELETE FROM rental_rooms WHERE id = ? AND user_id = ?`, [id, userId]);
  for (const e of entries) syncMirror(db, userId, e.id);
  return true;
}

/** Called when the property itself is deleted (its entries are already gone). */
export function deleteRoomsOfProperty(db: Database, userId: string, propertyId: string): void {
  run(
    db,
    `DELETE FROM rental_tenancies WHERE user_id = ? AND room_id IN (SELECT id FROM rental_rooms WHERE user_id = ? AND property_id = ?)`,
    [userId, userId, propertyId],
  );
  run(db, `DELETE FROM rental_rooms WHERE user_id = ? AND property_id = ?`, [userId, propertyId]);
}

// ---------------------------------------------------------------- tenancies

function checkTenancy(db: Database, userId: string, d: TenancyDraft, selfId: string | null): string | null {
  if (!roomRow(db, userId, d.roomId)) return NO_ROOM;
  if (d.endDate && d.endDate < d.startDate) return 'End date must be on or after the start date';
  if (d.bondLodged && d.bondAmount <= 0) return 'Add the bond amount before marking it lodged';
  const others = queryAll<{ id: string; start_date: string; end_date: string | null; tenant_label: string }>(
    db,
    `SELECT id, start_date, end_date, tenant_label FROM rental_tenancies WHERE user_id = ? AND room_id = ? AND id != ?`,
    [userId, d.roomId, selfId ?? ''],
  );
  const clash = others.find((o) => tenanciesOverlap(d, { startDate: o.start_date, endDate: o.end_date }));
  if (clash) return `Overlaps ${clash.tenant_label}'s tenancy in this room (from ${clash.start_date}${clash.end_date ? ` to ${clash.end_date}` : ''})`;
  return null;
}

export function createTenancy(db: Database, userId: string, d: TenancyDraft): Parsed<RentalTenancy> {
  const err = checkTenancy(db, userId, d, null);
  if (err) return { ok: false, error: err };
  const id = newId('rten');
  const now = new Date().toISOString();
  run(
    db,
    `INSERT INTO rental_tenancies (id, user_id, room_id, tenant_label, rent_amount, rent_frequency, bills_included, start_date, end_date,
       bond_amount, bond_lodged, created_at, updated_at)
     VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)`,
    [
      id, userId, d.roomId, d.tenantLabel, d.rentAmount, d.rentFrequency, d.billsIncluded ? 1 : 0, d.startDate, d.endDate,
      d.bondAmount, d.bondLodged ? 1 : 0, now, now,
    ],
  );
  return { ok: true, value: presentTenancy(tenancyRow(db, userId, id)!) };
}

/** null = not found. */
export function updateTenancy(db: Database, userId: string, id: string, patch: Partial<TenancyDraft>): Parsed<RentalTenancy> | null {
  const r = tenancyRow(db, userId, id);
  if (!r) return null;
  const next: TenancyDraft = {
    roomId: r.room_id,
    tenantLabel: patch.tenantLabel ?? r.tenant_label,
    rentAmount: patch.rentAmount ?? Number(r.rent_amount),
    rentFrequency: patch.rentFrequency ?? r.rent_frequency,
    billsIncluded: patch.billsIncluded ?? Boolean(r.bills_included),
    startDate: patch.startDate ?? r.start_date,
    endDate: patch.endDate !== undefined ? patch.endDate : r.end_date,
    bondAmount: patch.bondAmount ?? Number(r.bond_amount),
    bondLodged: patch.bondLodged ?? Boolean(r.bond_lodged),
  };
  const err = checkTenancy(db, userId, next, id);
  if (err) return { ok: false, error: err };
  run(
    db,
    `UPDATE rental_tenancies SET tenant_label=?, rent_amount=?, rent_frequency=?, bills_included=?, start_date=?, end_date=?,
       bond_amount=?, bond_lodged=?, updated_at=?
     WHERE id=? AND user_id=?`,
    [
      next.tenantLabel, next.rentAmount, next.rentFrequency, next.billsIncluded ? 1 : 0, next.startDate, next.endDate,
      next.bondAmount, next.bondLodged ? 1 : 0, new Date().toISOString(), id, userId,
    ],
  );
  return { ok: true, value: presentTenancy(tenancyRow(db, userId, id)!) };
}

export function deleteTenancy(db: Database, userId: string, id: string): boolean {
  if (!tenancyRow(db, userId, id)) return false;
  run(db, `DELETE FROM rental_tenancies WHERE id = ? AND user_id = ?`, [id, userId]);
  return true;
}
