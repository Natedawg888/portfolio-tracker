/**
 * FIF income estimate for the signed-in user (KAN-92). Formulas: src/lib/fifCalc.ts.
 *
 * Built only from what's stored, never invented:
 * - Share holdings (asset_class 'stock'), classified by exchange / symbol suffix.
 * - Cost: holdings.cost_basis_nzd. A holding without acquired_at is treated as held before the year.
 * - Opening / closing market value: the daily or manual valuation snapshot on, or up to a week
 *   before, 1 April / 31 March. No snapshot = unknown, and the summary says so.
 * - Dividends: dividend_events for the holding, gross, converted at the stored FX rate.
 * Trades aren't stored, so sales and same-year buy-and-sell (quick sales) can't be seen; the
 * notes say so. Holdings that were sold and deleted are gone from the cost test.
 */
import type { Database } from 'sql.js';
import type { FifHoldingRow, FifSummary } from '../../src/types/index.ts';
import { queryAll, queryOne, run } from '../db/index.ts';
import { aucklandDate } from '../../src/lib/netWorthHistory.ts';
import {
  applyFifOverride,
  classifyFif,
  FIF_CLASS_LABEL,
  FIF_SOURCE_LABEL,
  FIF_SOURCE_URL,
  fifTaxYearBounds,
  fifTaxYearForDate,
  fifYear,
  type FifCostSpan,
  type FifOverride,
  type FifInterestYear,
} from '../../src/lib/fifCalc.ts';

/** How far before 1 April / 31 March a snapshot may be and still stand in for that day. */
const SNAPSHOT_WINDOW_DAYS = 7;

type HoldingRow = {
  id: string;
  name: string;
  symbol: string | null;
  exchange: string | null;
  shares: number | null;
  cost_basis_nzd: number | null;
  acquired_at: string | null;
  source: string | null;
};

type SnapshotRow = { taken_at: string; breakdown_json: string | null };

type DividendRow = {
  holding_id: string;
  gross_dividend: number;
  currency: string | null;
  fx_rate_to_nzd: number | null;
};

const r2 = (n: number) => Math.round((n + Number.EPSILON) * 100) / 100;

function addDays(ymd: string, days: number): string {
  const d = new Date(`${ymd}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

/** Latest snapshot whose Auckland date is in [day − window, day], with its per-holding values. */
function snapshotOn(
  db: Database,
  userId: string,
  day: string,
): { date: string; values: Map<string, number> } | null {
  const from = addDays(day, -SNAPSHOT_WINDOW_DAYS - 1);
  const to = addDays(day, 1);
  const rows = queryAll<SnapshotRow>(
    db,
    `SELECT taken_at, breakdown_json FROM valuation_snapshots
     WHERE user_id = ? AND taken_at >= ? AND taken_at < ?
     ORDER BY taken_at DESC`,
    [userId, `${from}T00:00:00.000Z`, `${to}T23:59:59.999Z`],
  );
  const earliest = addDays(day, -SNAPSHOT_WINDOW_DAYS);
  for (const row of rows) {
    const date = aucklandDate(row.taken_at);
    if (!date || date > day || date < earliest) continue;
    let holdings: unknown;
    try {
      holdings = (JSON.parse(row.breakdown_json ?? '{}') as { holdings?: unknown }).holdings;
    } catch {
      continue;
    }
    if (!Array.isArray(holdings)) continue;
    const values = new Map<string, number>();
    for (const h of holdings as Array<{ id?: unknown; valueNzd?: unknown }>) {
      const v = Number(h.valueNzd);
      if (typeof h.id === 'string' && Number.isFinite(v)) values.set(h.id, v);
    }
    return { date, values };
  }
  return null;
}

export function fifSummary(db: Database, userId: string, taxYearStart: number, today: string): FifSummary {
  const { start, end } = fifTaxYearBounds(taxYearStart);
  const yearEnded = today > end;
  const holdings = queryAll<HoldingRow>(
    db,
    `SELECT id, name, symbol, exchange, shares, cost_basis_nzd, acquired_at, source
     FROM holdings WHERE user_id = ? AND asset_class = 'stock'
     ORDER BY name COLLATE NOCASE`,
    [userId],
  ).filter((h) => !h.acquired_at || h.acquired_at.slice(0, 10) <= end);

  const overrides = new Map(
    queryAll<{ holding_id: string; fif_class: FifOverride }>(db, `SELECT holding_id, fif_class FROM fif_class_overrides WHERE user_id = ?`, [userId]).map(
      (r) => [r.holding_id, r.fif_class],
    ),
  );

  const opening = snapshotOn(db, userId, start);
  const closing = yearEnded ? snapshotOn(db, userId, end) : null;

  const dividends = new Map<string, number>();
  let dividendsMissingFx = 0;
  if (holdings.length) {
    const rows = queryAll<DividendRow>(
      db,
      `SELECT holding_id, gross_dividend, currency, fx_rate_to_nzd FROM dividend_events
       WHERE user_id = ? AND holding_id IS NOT NULL AND payment_date >= ? AND payment_date <= ?`,
      [userId, start, end],
    );
    for (const d of rows) {
      const nzd =
        (d.currency ?? 'NZD').toUpperCase() === 'NZD'
          ? d.gross_dividend
          : d.fx_rate_to_nzd != null && d.fx_rate_to_nzd > 0
            ? d.gross_dividend * d.fx_rate_to_nzd
            : null;
      if (nzd == null || !Number.isFinite(nzd)) {
        dividendsMissingFx += 1;
        continue;
      }
      dividends.set(d.holding_id, (dividends.get(d.holding_id) ?? 0) + nzd);
    }
  }

  const spans: FifCostSpan[] = [];
  const interests: FifInterestYear[] = [];
  const missingCost: string[] = [];
  const missingOpening: string[] = [];
  const missingClosing: string[] = [];
  let syncedCost = false;
  let undated = false;
  const rows: FifHoldingRow[] = holdings.map((h) => {
    const autoClass = classifyFif(h.symbol, h.exchange) as Exclude<ReturnType<typeof classifyFif>, 'user_exempt'>;
    const override = overrides.get(h.id) ?? null;
    const fifClass = applyFifOverride(autoClass, override);
    const acquired = h.acquired_at ? h.acquired_at.slice(0, 10) : null;
    const boughtInYear = acquired != null && acquired >= start;
    const cost = h.cost_basis_nzd != null && h.cost_basis_nzd > 0 ? h.cost_basis_nzd : null;
    const openingValue = boughtInYear ? 0 : (opening?.values.get(h.id) ?? null);
    const closingValue = closing?.values.get(h.id) ?? null;
    const dividendsNzd = r2(dividends.get(h.id) ?? 0);
    const row: FifHoldingRow = {
      id: h.id,
      label: h.symbol ? `${h.name} (${h.symbol})` : h.name,
      symbol: h.symbol,
      exchange: h.exchange,
      fifClass,
      classLabel: FIF_CLASS_LABEL[fifClass],
      autoClass,
      override,
      costNzd: cost,
      acquiredAt: acquired,
      openingValueNzd: openingValue,
      closingValueNzd: closingValue,
      dividendsNzd,
      fdrIncomeNzd: null,
      cvIncomeNzd: null,
    };
    if (fifClass !== 'fif') return row;

    if (cost == null) missingCost.push(row.label);
    else spans.push({ costNzd: cost, heldFrom: acquired, heldTo: null });
    if (h.source === 'Sharesies' || h.source === 'Hatch') syncedCost = true;
    if (!acquired) undated = true;
    if (openingValue == null) missingOpening.push(row.label);
    if (yearEnded && closingValue == null) missingClosing.push(row.label);
    interests.push({
      id: h.id,
      label: row.label,
      openingValueNzd: openingValue ?? 0,
      openingUnits: boughtInYear ? 0 : (h.shares ?? 0),
      closingValueNzd: closingValue,
      // A purchase in the year is a cost for CV. Units only matter for quick sales, and there
      // are no sales on record, so no quick-sale adjustment arises.
      trades: boughtInYear && cost != null ? [{ date: acquired, kind: 'buy', units: h.shares ?? 0, amountNzd: cost }] : [],
      distributionsNzd: dividendsNzd,
    });
    return row;
  });

  const result = fifYear({ taxYearStart, spans, interests });
  const byId = new Map(result.interests.map((i) => [i.id, i]));
  for (const row of rows) {
    const i = byId.get(row.id);
    if (!i) continue;
    row.fdrIncomeNzd = missingOpening.includes(row.label) ? null : i.fdrIncomeNzd;
    row.cvIncomeNzd = i.cvIncomeNzd;
  }

  const notes: string[] = [
    'Estimate only, not tax advice. Check it against IRD’s FIF calculator or a tax adviser before filing.',
    `FIF rules apply for the whole year if your foreign shares cost more than $${result.threshold.thresholdNzd.toLocaleString('en-NZ')} in total on any day in it. Market value doesn’t count. NZ-listed shares, NZ funds (PIEs) and most ASX-listed Australian companies are left out.`,
    'Share sales aren’t recorded here, so a holding you sold during the year is missing from the cost test, and no quick-sale adjustment is worked out. Add those yourself if you bought and sold the same shares this year.',
    'A Bill introduced on 10 September 2026 would raise the threshold to $100,000 from 2026/27. It isn’t law yet, so $50,000 is used.',
  ];
  if (syncedCost) {
    notes.push('Cost for Sharesies and Hatch holdings is the synced cost basis at today’s exchange rate. IRD uses the NZD cost when you bought, so the threshold test may be off near $50,000.');
  }
  if (undated) notes.push('Holdings without a purchase date are treated as held since before this tax year.');
  if (missingCost.length) notes.push(`No cost recorded for ${missingCost.join(', ')}, so it isn’t in the cost test.`);
  if (missingOpening.length) {
    notes.push(
      opening
        ? `The ${opening.date} snapshot has no value for ${missingOpening.join(', ')}, so FDR leaves it out.`
        : `There’s no valuation snapshot from the week before ${start}, so the opening values FDR needs are unknown. Turn on daily snapshots to have them next year.`,
    );
  }
  if (!yearEnded) notes.push(`The year ends ${end}. The comparative value (CV) method needs the closing value, so only FDR is shown until then.`);
  else if (missingClosing.length) {
    notes.push(
      closing
        ? `The ${closing.date} snapshot has no value for ${missingClosing.join(', ')}, so CV can’t be compared.`
        : `There’s no valuation snapshot from the week before ${end}, so CV can’t be compared and FDR is used.`,
    );
  }
  if (dividendsMissingFx) notes.push(`${dividendsMissingFx} dividend${dividendsMissingFx === 1 ? '' : 's'} had no exchange rate to NZD and ${dividendsMissingFx === 1 ? 'is' : 'are'} left out.`);

  return {
    estimateLabel: 'estimate',
    taxYearStart,
    currentTaxYearStart: fifTaxYearForDate(today),
    start,
    end,
    yearEnded,
    thresholdNzd: result.threshold.thresholdNzd,
    peakCostNzd: result.threshold.peakCostNzd,
    peakCostDate: result.threshold.peakCostDate,
    applies: result.threshold.applies,
    method: result.method,
    fifIncomeNzd: result.fifIncomeNzd,
    fdrTotalNzd: result.fdrTotalNzd,
    cvTotalNzd: result.cvTotalNzd,
    cvRawTotalNzd: result.cvRawTotalNzd,
    dividendsTaxableNzd: result.dividendsTaxableNzd,
    openingSnapshotDate: opening?.date ?? null,
    closingSnapshotDate: closing?.date ?? null,
    holdings: rows,
    notes,
    sourceLabel: FIF_SOURCE_LABEL,
    sourceUrl: FIF_SOURCE_URL,
  };
}

export type SetFifClassResult = { ok: true; holdingId: string; override: FifOverride | null } | { ok: false; status: number; error: string };

/** Set or clear the user's FIF classification for one of their share holdings. */
export function setFifClassOverride(db: Database, userId: string, holdingId: string, body: unknown): SetFifClassResult {
  const raw = (body ?? {}) as { override?: unknown };
  const override = raw.override;
  if (override !== null && override !== 'fif' && override !== 'exempt') {
    return { ok: false, status: 400, error: 'override must be "fif", "exempt" or null' };
  }
  const h = queryOne<{ id: string }>(db, `SELECT id FROM holdings WHERE id = ? AND user_id = ? AND asset_class = 'stock'`, [holdingId, userId]);
  if (!h) return { ok: false, status: 404, error: 'Share holding not found' };
  if (override === null) {
    run(db, `DELETE FROM fif_class_overrides WHERE user_id = ? AND holding_id = ?`, [userId, holdingId]);
  } else {
    run(
      db,
      `INSERT INTO fif_class_overrides (user_id, holding_id, fif_class, updated_at) VALUES (?,?,?,?)
       ON CONFLICT(user_id, holding_id) DO UPDATE SET fif_class = excluded.fif_class, updated_at = excluded.updated_at`,
      [userId, holdingId, override, new Date().toISOString()],
    );
  }
  return { ok: true, holdingId, override };
}
