/**
 * Saved pay sources for one user (KAN-70). Rows never cross users.
 * Weekly gross / net are recomputed from the stored inputs on every save.
 * The typical weekly net is the expected income used by the budget, the home
 * snapshot and projections (see paySourcesExpected).
 */
import type { Database } from 'sql.js';
import type { PaySource, PaySourcesExpected } from '../../src/types/index.ts';
import {
  outputPaySourceFigures,
  weeklyToMonthly,
  type OutputPaySourceInputs,
} from '../../src/lib/outputPayCalc.ts';
import { payTaxYearRates } from '../../src/lib/payeRates.ts';
import { newId, queryAll, queryOne, run } from '../db/index.ts';
import { roundMoney } from '../debts/model.ts';
import type { PaySourceDraft } from './model.ts';

type StoredRow = {
  id: string;
  name: string;
  pay_type: string;
  tax_year: number;
  inputs_json: string;
  weekly_gross_nzd: number;
  weekly_net_nzd: number;
  created_at: string;
  updated_at: string;
};

function present(row: StoredRow): PaySource {
  let inputs: OutputPaySourceInputs | null = null;
  try {
    inputs = JSON.parse(row.inputs_json) as OutputPaySourceInputs;
  } catch {
    inputs = null;
  }
  const weeklyNetNzd = roundMoney(Number(row.weekly_net_nzd) || 0);
  return {
    id: row.id,
    name: row.name,
    payType: row.pay_type as PaySource['payType'],
    taxYear: Number(row.tax_year),
    inputs,
    weeklyGrossNzd: roundMoney(Number(row.weekly_gross_nzd) || 0),
    weeklyNetNzd,
    monthlyNetNzd: weeklyToMonthly(weeklyNetNzd),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function figures(draft: PaySourceDraft): { weeklyGross: number; weeklyNet: number } {
  return outputPaySourceFigures(draft.inputs, payTaxYearRates(draft.taxYear));
}

export function listPaySources(db: Database, userId: string): PaySource[] {
  return queryAll<StoredRow>(
    db,
    `SELECT * FROM pay_sources WHERE user_id = ? ORDER BY created_at, id`,
    [userId],
  ).map(present);
}

export function getPaySource(db: Database, userId: string, id: string): PaySource | null {
  const row = queryOne<StoredRow>(db, `SELECT * FROM pay_sources WHERE id = ? AND user_id = ?`, [id, userId]);
  return row ? present(row) : null;
}

export function createPaySource(db: Database, userId: string, draft: PaySourceDraft): PaySource {
  const id = newId('pays');
  const now = new Date().toISOString();
  const f = figures(draft);
  run(
    db,
    `INSERT INTO pay_sources (id, user_id, name, pay_type, tax_year, inputs_json, weekly_gross_nzd, weekly_net_nzd, created_at, updated_at)
     VALUES (?,?,?,?,?,?,?,?,?,?)`,
    [id, userId, draft.name, draft.inputs.payType, draft.taxYear, JSON.stringify(draft.inputs), f.weeklyGross, f.weeklyNet, now, now],
  );
  return getPaySource(db, userId, id)!;
}

export function updatePaySource(db: Database, userId: string, id: string, draft: PaySourceDraft): PaySource | null {
  if (!getPaySource(db, userId, id)) return null;
  const f = figures(draft);
  run(
    db,
    `UPDATE pay_sources
     SET name = ?, pay_type = ?, tax_year = ?, inputs_json = ?, weekly_gross_nzd = ?, weekly_net_nzd = ?, updated_at = ?
     WHERE id = ? AND user_id = ?`,
    [draft.name, draft.inputs.payType, draft.taxYear, JSON.stringify(draft.inputs), f.weeklyGross, f.weeklyNet, new Date().toISOString(), id, userId],
  );
  return getPaySource(db, userId, id);
}

export function deletePaySource(db: Database, userId: string, id: string): boolean {
  if (!getPaySource(db, userId, id)) return false;
  run(db, `DELETE FROM pay_sources WHERE id = ? AND user_id = ?`, [id, userId]);
  return true;
}

/** Expected income from all of this user's saved pay sources. Null when none are saved. */
export function paySourcesExpected(db: Database, userId: string): PaySourcesExpected | null {
  const sources = listPaySources(db, userId);
  if (sources.length === 0) return null;
  const weeklyNetNzd = roundMoney(sources.reduce((sum, s) => sum + s.weeklyNetNzd, 0));
  return {
    count: sources.length,
    weeklyNetNzd,
    monthlyNetNzd: weeklyToMonthly(weeklyNetNzd),
    sources: sources.map((s) => ({ id: s.id, name: s.name, payType: s.payType, weeklyNetNzd: s.weeklyNetNzd })),
  };
}
