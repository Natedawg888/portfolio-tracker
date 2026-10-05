/**
 * Per-user donations. One user's gifts are never written onto another user's
 * rows. A donation is not a receipt and does not change transactions.receipt_path.
 * Tax-year totals are counted on read.
 */
import type { Database } from 'sql.js';
import type { Donation, DonationSummary } from '../../src/types/index.ts';
import { newId, queryAll, queryOne, run } from '../db/index.ts';
import { roundMoney } from '../debts/model.ts';
import { photoUrlFromPath } from '../lib/uploads.ts';
import {
  donationSummary,
  nzTaxYearForDate,
  type DonationInput,
} from './model.ts';

export const RECEIPT_LINK_ERROR =
  'receiptTransactionId must reference your transaction that already has a receipt';

type StoredRow = {
  id: string;
  date: string;
  recipient: string;
  amount_nzd?: number | null;
  notes?: string | null;
  evidence_url?: string | null;
  receipt_transaction_id?: string | null;
  linked_receipt_path?: string | null;
  created_at: string;
  updated_at: string;
};

const SELECT_DONATION = `
  SELECT
    d.id,
    d.date,
    d.recipient,
    d.amount_nzd,
    d.notes,
    d.evidence_url,
    d.receipt_transaction_id,
    d.created_at,
    d.updated_at,
    t.receipt_path AS linked_receipt_path
  FROM donations d
  LEFT JOIN transactions t
    ON t.id = d.receipt_transaction_id AND t.user_id = d.user_id
`;

export type SaveDonationResult =
  | { ok: true; donation: Donation }
  | { ok: false; error: string };

function present(row: StoredRow): Donation {
  const date = String(row.date);
  const year = nzTaxYearForDate(date);
  const receiptPath = row.linked_receipt_path?.trim() ? String(row.linked_receipt_path) : null;
  return {
    id: row.id,
    date,
    recipient: row.recipient,
    amountNzd: roundMoney(Number(row.amount_nzd ?? 0)),
    notes: row.notes ?? null,
    evidenceUrl: row.evidence_url ?? null,
    receiptTransactionId: row.receipt_transaction_id ?? null,
    receiptPath,
    receiptUrl: photoUrlFromPath(receiptPath),
    currency: 'NZD',
    timezone: 'Pacific/Auckland',
    taxYear: year?.taxYear ?? 0,
    taxYearStart: year?.taxYearStart ?? '',
    taxYearEnd: year?.taxYearEnd ?? '',
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function loadRow(db: Database, userId: string, id: string): StoredRow | null {
  return queryOne<StoredRow>(
    db,
    `${SELECT_DONATION} WHERE d.id = ? AND d.user_id = ?`,
    [id, userId],
  );
}

function receiptLinkError(db: Database, userId: string, transactionId: string | null): string | null {
  if (!transactionId) return null;
  const row = queryOne<{ id: string; receipt_path?: string | null }>(
    db,
    `SELECT id, receipt_path FROM transactions WHERE id = ? AND user_id = ?`,
    [transactionId, userId],
  );
  const path = row?.receipt_path?.trim() ?? '';
  if (!row || !path) return RECEIPT_LINK_ERROR;
  return null;
}

export function listDonations(db: Database, userId: string, taxYear: number | null): Donation[] {
  const rows = queryAll<StoredRow>(
    db,
    `${SELECT_DONATION}
     WHERE d.user_id = ?
     ORDER BY d.date DESC, d.recipient COLLATE NOCASE ASC, d.id ASC`,
    [userId],
  );
  const donations = rows.map(present);
  if (taxYear == null) return donations;
  return donations.filter((donation) => donation.taxYear === taxYear);
}

export function getDonation(db: Database, userId: string, id: string): Donation | null {
  const row = loadRow(db, userId, id);
  return row ? present(row) : null;
}

export function summarizeDonations(
  db: Database,
  userId: string,
  asOf: string,
  taxYear: number | null,
): DonationSummary {
  const donations = listDonations(db, userId, null);
  return donationSummary(
    donations.map((donation) => ({ date: donation.date, amountNzd: donation.amountNzd })),
    asOf,
    taxYear,
  );
}

export function createDonation(
  db: Database,
  userId: string,
  input: DonationInput,
): SaveDonationResult {
  const linkError = receiptLinkError(db, userId, input.receiptTransactionId);
  if (linkError) return { ok: false, error: linkError };
  const id = newId('don');
  const now = new Date().toISOString();
  run(
    db,
    `INSERT INTO donations (
       id, user_id, date, recipient, amount_nzd, notes, evidence_url,
       receipt_transaction_id, created_at, updated_at
     ) VALUES (?,?,?,?,?,?,?,?,?,?)`,
    [
      id,
      userId,
      input.date,
      input.recipient,
      input.amountNzd,
      input.notes,
      input.evidenceUrl,
      input.receiptTransactionId,
      now,
      now,
    ],
  );
  return { ok: true, donation: getDonation(db, userId, id)! };
}

export function updateDonation(
  db: Database,
  userId: string,
  id: string,
  patch: Partial<DonationInput>,
): SaveDonationResult | null {
  const existing = loadRow(db, userId, id);
  if (!existing) return null;
  const current = present(existing);
  const next: DonationInput = {
    date: patch.date ?? current.date,
    recipient: patch.recipient ?? current.recipient,
    amountNzd: patch.amountNzd !== undefined ? patch.amountNzd : current.amountNzd,
    notes: patch.notes !== undefined ? patch.notes : current.notes,
    evidenceUrl: patch.evidenceUrl !== undefined ? patch.evidenceUrl : current.evidenceUrl,
    receiptTransactionId:
      patch.receiptTransactionId !== undefined
        ? patch.receiptTransactionId
        : current.receiptTransactionId,
  };
  if (patch.receiptTransactionId !== undefined) {
    const linkError = receiptLinkError(db, userId, next.receiptTransactionId);
    if (linkError) return { ok: false, error: linkError };
  }
  const now = new Date().toISOString();
  run(
    db,
    `UPDATE donations
     SET date = ?, recipient = ?, amount_nzd = ?, notes = ?, evidence_url = ?,
         receipt_transaction_id = ?, updated_at = ?
     WHERE id = ? AND user_id = ?`,
    [
      next.date,
      next.recipient,
      next.amountNzd,
      next.notes,
      next.evidenceUrl,
      next.receiptTransactionId,
      now,
      id,
      userId,
    ],
  );
  return { ok: true, donation: getDonation(db, userId, id)! };
}

export function deleteDonation(db: Database, userId: string, id: string): boolean {
  const existing = loadRow(db, userId, id);
  if (!existing) return false;
  run(db, `DELETE FROM donations WHERE id = ? AND user_id = ?`, [id, userId]);
  return true;
}
