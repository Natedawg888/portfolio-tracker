/**
 * Macro observations and assessments in the existing SQLite file.
 */
import { getDb, newId, persist, queryAll, queryOne } from '../db/index.ts';
import type { TimelinePoint } from './scoring.ts';
import type { Database } from 'sql.js';
import {
  type EconomicObservation,
  type IndicatorType,
  type Phase,
  type ProviderKind,
  type PublishedAtPrecision,
} from './types.ts';

export type FetchLog = {
  fetchedAt: string;
  ok: boolean;
  note: string | null;
};

function textOrNull(value: unknown): string | null {
  if (value == null) return null;
  const text = String(value);
  return text === '' ? null : text;
}

export function mapObservation(row: Record<string, unknown>): EconomicObservation {
  return {
    country: String(row.country),
    indicatorType: String(row.indicator_type) as IndicatorType,
    value: Number(row.value),
    unit: String(row.unit),
    period: String(row.period),
    periodStart: String(row.period_start ?? ''),
    periodEnd: String(row.period_end ?? ''),
    previousValue: row.previous_value == null ? null : Number(row.previous_value),
    previousPeriod: textOrNull(row.previous_period),
    source: String(row.source),
    sourceUrl: textOrNull(row.source_url),
    publishedAt: String(row.published_at),
    publishedAtPrecision: (textOrNull(row.published_at_precision) ?? 'period_end') as PublishedAtPrecision,
    retrievedAt: String(row.retrieved_at),
    providerId: String(row.provider_id),
    providerKind: String(row.provider_kind) as ProviderKind,
    frequency: String(row.frequency) as EconomicObservation['frequency'],
    seriesId: textOrNull(row.series_id),
    notes: textOrNull(row.notes),
  };
}

export async function readObservations(country: string, providerId: string): Promise<EconomicObservation[]> {
  const db = await getDb();
  return queryAll<Record<string, unknown>>(
    db,
    `SELECT * FROM economic_indicators
     WHERE country = ? AND provider_id = ?
     ORDER BY indicator_type, period_end`,
    [country, providerId],
  ).map(mapObservation);
}

export async function readFetchLog(country: string, providerId: string): Promise<FetchLog | null> {
  const db = await getDb();
  const row = queryOne<Record<string, unknown>>(
    db,
    `SELECT fetched_at, ok, note FROM economic_fetch_log WHERE country = ? AND provider_id = ?`,
    [country, providerId],
  );
  if (!row) return null;
  return {
    fetchedAt: String(row.fetched_at),
    ok: Number(row.ok) === 1,
    note: textOrNull(row.note),
  };
}

export async function writeObservations(args: {
  country: string;
  providerId: string;
  observations: EconomicObservation[];
  fetchedAt: string;
  note: string | null;
  ok: boolean;
}): Promise<void> {
  const db = await getDb();
  db.run('BEGIN');
  try {
    db.run(`DELETE FROM economic_indicators WHERE country = ? AND provider_id = ?`, [
      args.country,
      args.providerId,
    ]);
    const insert = db.prepare(
      `INSERT INTO economic_indicators (
        id, country, indicator_type, value, unit, period, period_start, period_end,
        previous_value, previous_period, source, source_url, published_at, published_at_precision,
        retrieved_at, provider_id, provider_kind, frequency, series_id, notes
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    );
    for (const row of args.observations) {
      insert.run([
        newId('eobs'),
        row.country,
        row.indicatorType,
        row.value,
        row.unit,
        row.period,
        row.periodStart,
        row.periodEnd,
        row.previousValue,
        row.previousPeriod,
        row.source,
        row.sourceUrl,
        row.publishedAt,
        row.publishedAtPrecision,
        row.retrievedAt,
        row.providerId,
        row.providerKind,
        row.frequency,
        row.seriesId,
        row.notes,
      ]);
    }
    insert.free();
    upsertFetchLog(db, args);
    db.run('COMMIT');
  } catch (err) {
    try {
      db.run('ROLLBACK');
    } catch {
      /* keep the original error */
    }
    throw err;
  }
  persist();
}

export async function writeAssessments(args: {
  country: string;
  providerId: string;
  providerKind: ProviderKind;
  timeline: TimelinePoint[];
  currentPeriod: string | null;
  calculatedAt: string;
  coverageNote: string | null;
}): Promise<void> {
  const db = await getDb();
  db.run('BEGIN');
  try {
    db.run(
      `DELETE FROM economic_indicator_scores
       WHERE assessment_id IN (
         SELECT id FROM economic_cycle_assessments WHERE country = ? AND provider_id = ?
       )`,
      [args.country, args.providerId],
    );
    db.run(`DELETE FROM economic_cycle_assessments WHERE country = ? AND provider_id = ?`, [
      args.country,
      args.providerId,
    ]);
    const insertAssessment = db.prepare(
      `INSERT INTO economic_cycle_assessments (
        id, country, phase, score, confidence, calculated_at, as_of_period, previous_phase,
        momentum, provider_id, provider_kind, is_current, coverage_note
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    );
    const insertScore = db.prepare(
      `INSERT INTO economic_indicator_scores (
        id, assessment_id, indicator_type, score, direction, contribution
      ) VALUES (?, ?, ?, ?, ?, ?)`,
    );
    for (const point of args.timeline) {
      if (!point.phase) continue;
      const id = newId('eass');
      const isCurrent = point.period === args.currentPeriod ? 1 : 0;
      insertAssessment.run([
        id,
        args.country,
        point.phase as Phase,
        point.score,
        point.confidence,
        args.calculatedAt,
        point.period,
        point.previousPhase,
        point.momentum,
        args.providerId,
        args.providerKind,
        isCurrent,
        isCurrent ? args.coverageNote : null,
      ]);
      if (!isCurrent) continue;
      for (const score of point.indicators) {
        insertScore.run([
          newId('escr'),
          id,
          score.indicator,
          score.score,
          score.direction,
          score.contribution,
        ]);
      }
    }
    insertAssessment.free();
    insertScore.free();
    db.run('COMMIT');
  } catch (err) {
    try {
      db.run('ROLLBACK');
    } catch {
      /* keep the original error */
    }
    throw err;
  }
  persist();
}

function upsertFetchLog(
  db: Database,
  args: { country: string; providerId: string; fetchedAt: string; note: string | null; ok: boolean },
): void {
  db.run(
    `INSERT INTO economic_fetch_log (provider_id, country, fetched_at, ok, note)
     VALUES (?, ?, ?, ?, ?)
     ON CONFLICT(provider_id, country) DO UPDATE SET
       fetched_at = excluded.fetched_at,
       ok = excluded.ok,
       note = excluded.note`,
    [args.providerId, args.country, args.fetchedAt, args.ok ? 1 : 0, args.note],
  );
}

export async function markFetchFailed(country: string, providerId: string, note: string): Promise<void> {
  const db = await getDb();
  upsertFetchLog(db, {
    country,
    providerId,
    fetchedAt: new Date().toISOString(),
    ok: false,
    note: note.slice(0, 500),
  });
  persist();
}
