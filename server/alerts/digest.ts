/**
 * Alert delivery (KAN-64): a job that raises alerts for every user once a day and, for users who
 * turned email on, sends one digest of what's new (each alert is emailed once). In-app alerts are
 * also raised whenever the user opens the app. Email needs Resend set up (RESEND_API_KEY).
 */
import type { Database } from 'sql.js';
import { getDb, queryAll } from '../db/index.ts';
import { emailEnabled, messageHtml, sendEmail } from '../invoices/email.ts';
import { logger } from '../lib/logger.ts';
import { aucklandToday } from '../debts/model.ts';
import { getAlertSettings, markEmailed, raiseAlerts, unemailed, type Alert } from './store.ts';

const HOUR = 60 * 60 * 1000;

export function digestText(alerts: Alert[], appUrl: string): { subject: string; text: string } {
  const subject = alerts.length === 1 ? `KoruLedger: ${alerts[0].title}` : `KoruLedger: ${alerts.length} new alerts`;
  const lines = alerts.map((a) => `• ${a.title}. ${a.body}`);
  return { subject, text: `${lines.join('\n')}\n\nSee them in KoruLedger: ${appUrl}/alerts\nTurn these emails off under Alerts → Settings.` };
}

export type Sender = typeof sendEmail;

/** One pass for one user: raise, then email what hasn't been emailed (when they chose email). */
export async function runForUser(db: Database, userId: string, email: string, today: string, send: Sender = sendEmail, appUrl = (process.env.PUBLIC_URL?.trim() || 'https://koruledger.com').replace(/\/+$/, '')): Promise<{ raised: number; emailed: number }> {
  const raised = raiseAlerts(db, userId, today).length;
  const s = getAlertSettings(db, userId);
  const pending = unemailed(db, userId);
  if (!s.email || !pending.length || !emailEnabled()) {
    // Without email, alerts are in-app only: don't hold a backlog to send later.
    if (!s.email) markEmailed(db, pending.map((a) => a.id));
    return { raised, emailed: 0 };
  }
  const { subject, text } = digestText(pending, appUrl);
  const r = await send({
    fromName: 'KoruLedger',
    replyTo: null,
    to: [email],
    subject,
    text,
    html: messageHtml(text, `${appUrl}/alerts`, 'Open your alerts'),
    attachment: null,
    idempotencyKey: `alerts:${userId}:${pending.map((a) => a.id).join(',')}`,
  });
  if (!r.ok) {
    logger.warn('alert_digest_failed', { userId, error: r.error });
    return { raised, emailed: 0 };
  }
  markEmailed(db, pending.map((a) => a.id));
  return { raised, emailed: pending.length };
}

/** Every user, once. */
export async function runAlertsForEveryone(today = aucklandToday()): Promise<{ users: number; emailed: number }> {
  const db = await getDb();
  const users = queryAll<{ id: string; email: string }>(db, `SELECT id, email FROM users`);
  let emailed = 0;
  for (const u of users) {
    try {
      emailed += (await runForUser(db, u.id, u.email, today)).emailed;
    } catch (err) {
      logger.warn('alerts_user_failed', { userId: u.id, err: String(err).slice(0, 200) });
    }
  }
  return { users: users.length, emailed };
}

/** Run at start-up (after a minute) and then every 24 hours. Returns a stop function. */
export function startAlertScheduler(): () => void {
  if (process.env.NODE_ENV === 'test' || process.env.ALERTS_DISABLED === '1') return () => {};
  const tick = () => void runAlertsForEveryone().then((r) => logger.info('alerts_daily', r)).catch((err) => logger.error('alerts_daily_failed', { err: String(err).slice(0, 200) }));
  const first = setTimeout(tick, 60_000);
  const every = setInterval(tick, 24 * HOUR);
  return () => {
    clearTimeout(first);
    clearInterval(every);
  };
}
