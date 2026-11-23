/**
 * Alerts (KAN-64): overspend, bills due, savings-goal milestones and unusual spending; raised once;
 * settings; the daily email digest (once per alert, only when chosen); isolation; HTTP.
 * Run: npm run test:alerts
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import type { AddressInfo } from 'node:net';
import type { Server } from 'node:http';
import express from 'express';

function eq(actual: unknown, expected: unknown, msg: string): void {
  if (JSON.stringify(actual) !== JSON.stringify(expected)) throw new Error(`FAIL: ${msg} (got ${JSON.stringify(actual)}, expected ${JSON.stringify(expected)})`);
}

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'pt-alerts-'));
process.env.DATABASE_PATH = path.join(dir, 'portfolio.db');
process.env.NODE_ENV = 'test';
process.env.RESEND_API_KEY = 're_test';
process.env.INVOICE_EMAIL_FROM = 'alerts@example.com';

const { getDb, queryAll, run } = await import('../db/index.ts');
const { seedCategoriesForUser, resolveCategoryId } = await import('../lib/categories.ts');
const { createRecurring } = await import('../recurring/store.ts');
const { createSavingsGoal } = await import('../savings/store.ts');
const { raiseAlerts, listAlerts, markRead, getAlertSettings, saveAlertSettings, parseAlertSettings, candidateAlerts } = await import('./store.ts');
const { runForUser, digestText } = await import('./digest.ts');
const { createSession, SESSION_COOKIE } = await import('../auth/sessions.ts');
const { attachUser } = await import('../middleware/requireAuth.ts');
const { default: alertsRouter } = await import('../routes/alerts.ts');
const { deleteScopedDataForUser } = await import('../lib/userScope.ts');

const db = await getDb();
const now = new Date().toISOString();
const TODAY = '2026-11-20';
for (const [id, email] of [['al', 'al@example.com'], ['bo', 'bo@example.com']]) {
  run(db, `INSERT INTO users (id, email, password_hash, created_at, updated_at) VALUES (?,?,?,?,?)`, [id, email, 'h', now, now]);
  seedCategoriesForUser(db, id);
}
const food = resolveCategoryId(db, 'al', 'cat-food')!;
run(db, `INSERT INTO budgets (id, user_id, category_id, period_start, period_end, amount_nzd) VALUES ('b1','al',?,'2026-11-01','2026-11-30',400)`, [food]);
let n = 0;
const txn = (user: string, date: string, amount: number, merchant: string, cat: string | null = null) =>
  run(db, `INSERT INTO transactions (id, user_id, date, description, amount, kind, category_id, created_at, merchant, source) VALUES (?,?,?,?,?,?,?,?,?,'manual')`, [`t${++n}`, user, date, merchant, amount, amount < 0 ? 'debit' : 'credit', cat, now, merchant]);
txn('al', '2026-11-03', -250, 'Countdown', food);
txn('al', '2026-11-10', -180, 'Countdown', food);
for (const d of ['2026-08-01', '2026-09-01', '2026-10-01']) txn('al', d, -20, 'Night n Day');
txn('al', '2026-11-18', -90, 'Night n Day');
createRecurring(db, 'al', { name: 'Netflix', kind: 'subscription', amountNzd: 22.99, cadence: 'monthly', nextDue: '2026-11-22', categoryId: null, status: 'active', notes: '', merchantKey: null, source: 'manual' }, TODAY);
createRecurring(db, 'al', { name: 'Rates', kind: 'bill', amountNzd: 900, cadence: 'quarterly', nextDue: '2026-12-20', categoryId: null, status: 'active', notes: '', merchantKey: null, source: 'manual' }, TODAY);
createSavingsGoal(db, 'al', { name: 'Holiday', targetNzd: 2000, currentAmountNzd: 1100, deadline: null, notes: null, accountId: null } as never, TODAY);

let raised = raiseAlerts(db, 'al', TODAY);
const kinds = raised.map((a) => a.kind).sort();
eq(kinds, ['bill_due', 'goal', 'overspend', 'unusual'], 'one of each');
eq(raised.find((a) => a.kind === 'overspend')?.title, 'Food & groceries is over budget', 'overspend title');
eq(raised.find((a) => a.kind === 'bill_due')?.title, 'Netflix is due on 2026-11-22', 'only the bill within 3 days');
eq(raised.find((a) => a.kind === 'goal')?.title, 'Holiday is 50% of the way', 'highest milestone reached');
eq(raised.find((a) => a.kind === 'unusual')?.body.includes('$90.00'), true, 'unusual: $90 vs usual $20');
eq(raiseAlerts(db, 'al', TODAY).length, 0, 'raised once');
eq(raiseAlerts(db, 'bo', TODAY).length, 0, "nothing for Bo, and none of Al's");

// Settings switch rules off and change thresholds.
const s0 = getAlertSettings(db, 'al');
eq([s0.email, s0.billDaysAhead], [false, 3], 'defaults');
const p = parseAlertSettings({ billDaysAhead: 31 }, s0);
eq(p.ok, false, 'out of range refused');
saveAlertSettings(db, 'al', { ...s0, billDaysAhead: 30, unusual: false });
eq(candidateAlerts(db, 'al', TODAY, getAlertSettings(db, 'al')).filter((c) => c.kind === 'bill_due').length, 2, 'wider window finds Rates too');
eq(candidateAlerts(db, 'al', TODAY, getAlertSettings(db, 'al')).some((c) => c.kind === 'unusual'), false, 'unusual off');

// Read state.
const list = listAlerts(db, 'al');
eq(list.unread, 4, 'four unread');
eq(markRead(db, 'al', list.alerts[0].id), 3, 'one read');
eq(markRead(db, 'bo', list.alerts[1].id), 0, "Bo can't mark Al's");
eq(listAlerts(db, 'al').unread, 3, 'still 3');

// Email digest: off → nothing sent; on → one email with what's new, never again.
const sent: { to: string[]; subject: string }[] = [];
const fake = async (m: { to: string[]; subject: string }) => {
  sent.push({ to: m.to, subject: m.subject });
  return { ok: true as const, id: 'x' };
};
let r = await runForUser(db, 'al', 'al@example.com', TODAY, fake as never, 'https://app.test');
eq([r.raised, r.emailed, sent.length], [1, 0, 0], 'email off: the Rates alert is in-app only, nothing sent');
saveAlertSettings(db, 'al', { ...getAlertSettings(db, 'al'), email: true, unusual: true });
txn('al', '2026-11-19', -95, 'Night n Day');
r = await runForUser(db, 'al', 'al@example.com', TODAY, fake as never, 'https://app.test');
eq([r.raised, r.emailed, sent.length, sent[0]?.subject], [1, 1, 1, 'KoruLedger: Bigger than usual at Night n Day'], 'email on: only the new alert emailed');
r = await runForUser(db, 'al', 'al@example.com', TODAY, fake as never, 'https://app.test');
eq([r.emailed, sent.length], [0, 1], 'never emailed twice');
eq(digestText([{ id: 'a', kind: 'goal', title: 'A', body: 'B', link: null, createdAt: now, readAt: null }, { id: 'b', kind: 'goal', title: 'C', body: 'D', link: null, createdAt: now, readAt: null }], 'https://x').subject, 'KoruLedger: 2 new alerts', 'digest subject');

// HTTP.
const app = express();
app.use(express.json());
app.use('/api', attachUser);
app.use('/api/alerts', alertsRouter);
const server: Server = await new Promise((res) => {
  const sv = app.listen(0, '127.0.0.1', () => res(sv));
});
const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
try {
  const ca = `${SESSION_COOKIE}=${(await createSession('al')).rawToken}`;
  const cb = `${SESSION_COOKIE}=${(await createSession('bo')).rawToken}`;
  const g = await fetch(`${base}/api/alerts`, { headers: { Cookie: ca } });
  eq(g.status, 200, 'GET 200');
  const gj = (await g.json()) as { alerts: { title: string }[] };
// GET uses today's date, so Netflix's next due date (22 Dec) is new by then.
eq(gj.alerts.length, 7, 'Al sees 7');
  eq(((await (await fetch(`${base}/api/alerts`, { headers: { Cookie: cb } })).json()) as { alerts: unknown[] }).alerts.length, 0, 'Bo sees none');
  const put = await fetch(`${base}/api/alerts/settings`, { method: 'PUT', headers: { Cookie: ca, 'Content-Type': 'application/json' }, body: JSON.stringify({ overspendPct: 80 }) });
  eq(put.status, 200, 'PUT settings');
  eq((await fetch(`${base}/api/alerts/settings`, { method: 'PUT', headers: { Cookie: ca, 'Content-Type': 'application/json' }, body: JSON.stringify({ email: 'yes' }) })).status, 400, 'bad setting 400');
  const rd = await fetch(`${base}/api/alerts/read`, { method: 'POST', headers: { Cookie: ca, 'Content-Type': 'application/json' }, body: JSON.stringify({}) });
  eq(((await rd.json()) as { unread: number }).unread, 0, 'mark all read');
  eq((await fetch(`${base}/api/alerts`)).status, 401, 'signed out');
  deleteScopedDataForUser(db, 'al');
  eq(queryAll(db, `SELECT id FROM alerts WHERE user_id = 'al'`).length, 0, 'account deletion clears alerts');
  console.log('alerts tests passed');
} finally {
  server.close();
  fs.rmSync(dir, { recursive: true, force: true });
}
process.exit(0);
