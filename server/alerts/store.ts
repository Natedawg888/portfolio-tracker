/**
 * Alerts (KAN-64): in-app and by email.
 *
 * Rules (each can be turned off; thresholds in alert_settings):
 * - overspend: a spending category's spend this month passes its budget plan (or the warn %).
 * - bill_due: a bill or subscription (Bills) is due within N days.
 * - goal: a savings goal reaches 25 / 50 / 75 / 100% of its target.
 * - unusual: a purchase in the last 7 days is at least N× the usual amount at that merchant
 *   (median of 3+ earlier purchases) and over $50.
 * Every alert has a dedupe key, so it's raised once (e.g. one overspend per category per month).
 *
 * Delivery: alerts are raised when the user opens the app (GET /api/alerts) and by a daily job
 * for everyone. In-app always; email when the user turned it on and email is set up on the server
 * (Resend), as one digest of what's new, never the same alert twice.
 */
import type { Database } from 'sql.js';
import { newId, queryAll, queryOne, run } from '../db/index.ts';
import { listRecurring } from '../recurring/store.ts';
import { listSavingsGoals } from '../savings/store.ts';

export const ALERT_KINDS = ['overspend', 'bill_due', 'goal', 'unusual'] as const;
export type AlertKind = (typeof ALERT_KINDS)[number];

export type AlertSettings = {
  overspend: boolean;
  /** Warn when spend reaches this % of the plan (100 = only when over). */
  overspendPct: number;
  billDue: boolean;
  billDaysAhead: number;
  goal: boolean;
  unusual: boolean;
  /** A purchase this many times the usual at that merchant. */
  unusualMultiple: number;
  email: boolean;
};

export const DEFAULT_ALERT_SETTINGS: AlertSettings = {
  overspend: true,
  overspendPct: 100,
  billDue: true,
  billDaysAhead: 3,
  goal: true,
  unusual: true,
  unusualMultiple: 3,
  email: false,
};

export type Alert = {
  id: string;
  kind: AlertKind;
  title: string;
  body: string;
  link: string | null;
  createdAt: string;
  readAt: string | null;
};

type Draft = { kind: AlertKind; key: string; title: string; body: string; link: string | null };

const money = (n: number) => `$${n.toLocaleString('en-NZ', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

export function getAlertSettings(db: Database, userId: string): AlertSettings {
  const row = queryOne<{ settings_json: string }>(db, `SELECT settings_json FROM alert_settings WHERE user_id = ?`, [userId]);
  if (!row) return { ...DEFAULT_ALERT_SETTINGS };
  try {
    return { ...DEFAULT_ALERT_SETTINGS, ...(JSON.parse(row.settings_json) as Partial<AlertSettings>) };
  } catch {
    return { ...DEFAULT_ALERT_SETTINGS };
  }
}

export function parseAlertSettings(raw: unknown, current: AlertSettings): { ok: true; value: AlertSettings } | { ok: false; error: string } {
  const o = raw && typeof raw === 'object' ? (raw as Record<string, unknown>) : null;
  if (!o) return { ok: false, error: 'Send the alert settings' };
  const next = { ...current };
  for (const k of ['overspend', 'billDue', 'goal', 'unusual', 'email'] as const) {
    if (k in o) {
      if (typeof o[k] !== 'boolean') return { ok: false, error: `${k} must be true or false` };
      next[k] = o[k] as boolean;
    }
  }
  const num = (k: 'overspendPct' | 'billDaysAhead' | 'unusualMultiple', min: number, max: number) => {
    if (!(k in o)) return null;
    const n = Number(o[k]);
    if (!Number.isFinite(n) || n < min || n > max) return `${k} must be from ${min} to ${max}`;
    next[k] = n;
    return null;
  };
  const err = num('overspendPct', 50, 200) ?? num('billDaysAhead', 0, 30) ?? num('unusualMultiple', 2, 20);
  if (err) return { ok: false, error: err };
  return { ok: true, value: next };
}

export function saveAlertSettings(db: Database, userId: string, s: AlertSettings): void {
  run(
    db,
    `INSERT INTO alert_settings (user_id, settings_json, updated_at) VALUES (?,?,?)
     ON CONFLICT(user_id) DO UPDATE SET settings_json = excluded.settings_json, updated_at = excluded.updated_at`,
    [userId, JSON.stringify(s), new Date().toISOString()],
  );
}

function addDays(ymd: string, days: number): string {
  const d = new Date(`${ymd}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

function median(xs: number[]): number {
  const s = [...xs].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
}

/** Work out which alerts apply today. Pure apart from reading the user's rows. */
export function candidateAlerts(db: Database, userId: string, today: string, s: AlertSettings): Draft[] {
  const out: Draft[] = [];
  const month = today.slice(0, 7);

  if (s.overspend) {
    // amount_nzd > 0 is checked here, not in SQL: an encrypted plan (KAN-112) is text, which SQLite
    // compares as greater than any number, so a $0 plan would pass and raise a false alert.
    const plans = queryAll<{ category_id: string; amount_nzd: number | null; name: string }>(
      db,
      `SELECT b.category_id, b.amount_nzd, c.name FROM budgets b JOIN budget_categories c ON c.id = b.category_id
       WHERE b.user_id = ? AND b.period_start <= ? AND b.period_end >= ? AND c.type = 'spending'`,
      [userId, today, today],
    ).filter((p): p is { category_id: string; amount_nzd: number; name: string } => typeof p.amount_nzd === 'number' && p.amount_nzd > 0);
    for (const p of plans) {
      const spent = Number(
        queryOne<{ s: number | null }>(db, `SELECT SUM(-amount) AS s FROM transactions WHERE user_id = ? AND category_id = ? AND amount < 0 AND substr(date, 1, 7) = ?`, [userId, p.category_id, month])?.s ?? 0,
      );
      const pct = (spent / p.amount_nzd) * 100;
      if (pct >= s.overspendPct) {
        const over = spent > p.amount_nzd;
        out.push({
          kind: 'overspend',
          key: `overspend:${p.category_id}:${month}:${over ? 'over' : 'warn'}`,
          title: over ? `${p.name} is over budget` : `${p.name} is at ${Math.floor(pct)}% of its budget`,
          body: `${money(spent)} spent of ${money(p.amount_nzd)} this month.`,
          link: '/spending',
        });
      }
    }
  }

  if (s.billDue) {
    const until = addDays(today, s.billDaysAhead);
    for (const b of listRecurring(db, userId, today).items ?? []) {
      if (b.status !== 'active' || !b.nextDue || b.nextDue < today || b.nextDue > until) continue;
      out.push({
        kind: 'bill_due',
        key: `bill:${b.id}:${b.nextDue}`,
        title: `${b.name} is due ${b.nextDue === today ? 'today' : `on ${b.nextDue}`}`,
        body: `${money(b.amountNzd)}.`,
        link: '/bills',
      });
    }
  }

  if (s.goal) {
    for (const g of listSavingsGoals(db, userId, today)) {
      if (!(g.targetNzd > 0)) continue;
      const pct = (g.currentAmountNzd / g.targetNzd) * 100;
      const reached = [100, 75, 50, 25].find((m) => pct >= m);
      if (!reached) continue;
      out.push({
        kind: 'goal',
        key: `goal:${g.id}:${reached}`,
        title: reached === 100 ? `You reached your ${g.name} goal` : `${g.name} is ${reached}% of the way`,
        body: `${money(g.currentAmountNzd)} of ${money(g.targetNzd)} saved.`,
        link: '/',
      });
    }
  }

  if (s.unusual) {
    const recent = queryAll<{ id: string; date: string; amount: number; merchant: string | null; description: string }>(
      db,
      `SELECT id, date, amount, merchant, description FROM transactions WHERE user_id = ? AND amount < 0 AND date >= ? AND date <= ?`,
      [userId, addDays(today, -7), today],
    );
    for (const t of recent) {
      const who = (t.merchant?.trim() || t.description?.trim() || '').toLowerCase();
      const spend = -Number(t.amount);
      if (!who || spend < 50) continue;
      const earlier = queryAll<{ amount: number }>(
        db,
        `SELECT amount FROM transactions WHERE user_id = ? AND amount < 0 AND date < ? AND lower(COALESCE(NULLIF(trim(merchant), ''), trim(description))) = ?`,
        [userId, t.date, who],
      ).map((r) => -Number(r.amount));
      if (earlier.length < 3) continue;
      const usual = median(earlier);
      if (usual > 0 && spend >= usual * s.unusualMultiple) {
        out.push({
          kind: 'unusual',
          key: `unusual:${t.id}`,
          title: `Bigger than usual at ${t.merchant?.trim() || t.description.trim()}`,
          body: `${money(spend)} on ${t.date}; you usually spend about ${money(usual)} there.`,
          link: '/spending',
        });
      }
    }
  }
  return out;
}

/** Raise new alerts (deduped). Returns the ones created now. */
export function raiseAlerts(db: Database, userId: string, today: string): Alert[] {
  const s = getAlertSettings(db, userId);
  const created: Alert[] = [];
  const now = new Date().toISOString();
  for (const d of candidateAlerts(db, userId, today, s)) {
    if (queryOne(db, `SELECT 1 AS x FROM alerts WHERE user_id = ? AND dedupe_key = ?`, [userId, d.key])) continue;
    const id = newId('alert');
    run(db, `INSERT INTO alerts (id, user_id, kind, dedupe_key, title, body, link, created_at) VALUES (?,?,?,?,?,?,?,?)`, [id, userId, d.kind, d.key, d.title, d.body, d.link, now]);
    created.push({ id, kind: d.kind, title: d.title, body: d.body, link: d.link, createdAt: now, readAt: null });
  }
  return created;
}

type Row = { id: string; kind: AlertKind; title: string; body: string; link: string | null; created_at: string; read_at: string | null };
const present = (r: Row): Alert => ({ id: r.id, kind: r.kind, title: r.title, body: r.body, link: r.link, createdAt: r.created_at, readAt: r.read_at });

export function listAlerts(db: Database, userId: string, limit = 50): { alerts: Alert[]; unread: number } {
  const alerts = queryAll<Row>(db, `SELECT id, kind, title, body, link, created_at, read_at FROM alerts WHERE user_id = ? ORDER BY created_at DESC LIMIT ?`, [userId, limit]).map(present);
  const unread = Number(queryOne<{ n: number }>(db, `SELECT COUNT(*) AS n FROM alerts WHERE user_id = ? AND read_at IS NULL`, [userId])?.n ?? 0);
  return { alerts, unread };
}

/** Mark one alert, or all, as read. */
export function markRead(db: Database, userId: string, id: string | null): number {
  const now = new Date().toISOString();
  if (id) {
    run(db, `UPDATE alerts SET read_at = ? WHERE id = ? AND user_id = ? AND read_at IS NULL`, [now, id, userId]);
  } else {
    run(db, `UPDATE alerts SET read_at = ? WHERE user_id = ? AND read_at IS NULL`, [now, userId]);
  }
  return Number(queryOne<{ n: number }>(db, `SELECT COUNT(*) AS n FROM alerts WHERE user_id = ? AND read_at IS NULL`, [userId])?.n ?? 0);
}

/** Alerts not yet emailed, for the daily digest. */
export function unemailed(db: Database, userId: string): Alert[] {
  return queryAll<Row>(db, `SELECT id, kind, title, body, link, created_at, read_at FROM alerts WHERE user_id = ? AND emailed_at IS NULL ORDER BY created_at`, [userId]).map(present);
}

export function markEmailed(db: Database, ids: string[]): void {
  const now = new Date().toISOString();
  for (const id of ids) run(db, `UPDATE alerts SET emailed_at = ? WHERE id = ?`, [now, id]);
}
