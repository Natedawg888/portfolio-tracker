/**
 * Payment provider connections for invoices (KAN-73), test mode first.
 *
 * - Stripe: Stripe Connect (OAuth, Standard accounts). We keep only the connected account id; every
 *   call uses the platform key (STRIPE_SECRET_KEY, test unless STRIPE_LIVE_ENABLED) on behalf of that
 *   account. Webhooks come to one Connect endpoint (STRIPE_CONNECT_WEBHOOK_SECRET) and are mapped
 *   to the user by event.account.
 * - Paddle Billing: the user's own API key and notification secret, sealed at rest (secretBox).
 *   Sandbox keys only unless PADDLE_LIVE_ENABLED=1. Webhooks come to a per-connection URL.
 * Pushing an invoice creates it in the provider for the amount due (one line, GST included as on
 * the KoruLedger invoice) and stores the provider id and payment link. When the provider says it's
 * paid, the balance is recorded as a payment on the KoruLedger invoice (with income, like a manual
 * payment); voided → void when nothing's been paid. Every webhook event is applied once.
 */
import type { Database } from 'sql.js';
import { newId, queryAll, queryOne, run } from '../db/index.ts';
import { openSecret, sealSecret } from '../auth/secretBox.ts';
import { addPayment, getInvoice, voidInvoice } from '../invoices/store.ts';
import type { Invoice } from '../../src/types/index.ts';

export type Provider = 'stripe' | 'paddle';
export type RemoteStatus = 'open' | 'paid' | 'void' | 'failed';

export type Connection = { id: string; userId: string; provider: Provider; accountRef: string; apiKey: string | null; webhookSecret: string | null; mode: 'test' | 'live' };

type ConnRow = { id: string; user_id: string; provider: Provider; account_ref: string; secret_enc: string | null; webhook_secret_enc: string | null; mode: 'test' | 'live' };
const toConn = (r: ConnRow): Connection => ({ id: r.id, userId: r.user_id, provider: r.provider, accountRef: r.account_ref, apiKey: openSecret(r.secret_enc), webhookSecret: openSecret(r.webhook_secret_enc), mode: r.mode });

export function getConnection(db: Database, userId: string, provider: Provider): Connection | null {
  const r = queryOne<ConnRow>(db, `SELECT * FROM payment_connections WHERE user_id = ? AND provider = ?`, [userId, provider]);
  return r ? toConn(r) : null;
}
export function connectionById(db: Database, id: string): Connection | null {
  const r = queryOne<ConnRow>(db, `SELECT * FROM payment_connections WHERE id = ?`, [id]);
  return r ? toConn(r) : null;
}
export function connectionByStripeAccount(db: Database, accountId: string): Connection | null {
  const r = queryOne<ConnRow>(db, `SELECT * FROM payment_connections WHERE provider = 'stripe' AND account_ref = ?`, [accountId]);
  return r ? toConn(r) : null;
}

export function saveConnection(db: Database, userId: string, provider: Provider, accountRef: string, mode: 'test' | 'live', secrets: { apiKey?: string | null; webhookSecret?: string | null } = {}): Connection {
  const existing = queryOne<{ id: string }>(db, `SELECT id FROM payment_connections WHERE user_id = ? AND provider = ?`, [userId, provider]);
  const id = existing?.id ?? newId('payconn');
  const now = new Date().toISOString();
  run(
    db,
    `INSERT INTO payment_connections (id, user_id, provider, account_ref, secret_enc, webhook_secret_enc, mode, created_at, updated_at) VALUES (?,?,?,?,?,?,?,?,?)
     ON CONFLICT(user_id, provider) DO UPDATE SET account_ref = excluded.account_ref, secret_enc = excluded.secret_enc, webhook_secret_enc = excluded.webhook_secret_enc, mode = excluded.mode, updated_at = excluded.updated_at`,
    [id, userId, provider, accountRef, secrets.apiKey ? sealSecret(secrets.apiKey) : null, secrets.webhookSecret ? sealSecret(secrets.webhookSecret) : null, mode, now, now],
  );
  return getConnection(db, userId, provider)!;
}

export function deleteConnection(db: Database, userId: string, provider: Provider): boolean {
  const c = getConnection(db, userId, provider);
  if (!c) return false;
  run(db, `DELETE FROM payment_connections WHERE id = ?`, [c.id]);
  return true;
}

export type InvoiceLink = { invoiceId: string; provider: Provider; providerInvoiceId: string; paymentUrl: string | null; status: RemoteStatus; updatedAt: string };
type LinkRow = { invoice_id: string; provider: Provider; provider_invoice_id: string; payment_url: string | null; status: RemoteStatus; updated_at: string };
const toLink = (r: LinkRow): InvoiceLink => ({ invoiceId: r.invoice_id, provider: r.provider, providerInvoiceId: r.provider_invoice_id, paymentUrl: r.payment_url, status: r.status, updatedAt: r.updated_at });

export function linkFor(db: Database, userId: string, invoiceId: string): InvoiceLink | null {
  const r = queryOne<LinkRow>(db, `SELECT * FROM invoice_provider_links WHERE user_id = ? AND invoice_id = ?`, [userId, invoiceId]);
  return r ? toLink(r) : null;
}
export function linkByRemote(db: Database, provider: Provider, providerInvoiceId: string): (InvoiceLink & { userId: string }) | null {
  const r = queryOne<LinkRow & { user_id: string }>(db, `SELECT * FROM invoice_provider_links WHERE provider = ? AND provider_invoice_id = ?`, [provider, providerInvoiceId]);
  return r ? { ...toLink(r), userId: r.user_id } : null;
}
export function saveLink(db: Database, userId: string, link: Omit<InvoiceLink, 'updatedAt'>): void {
  run(
    db,
    `INSERT INTO invoice_provider_links (invoice_id, user_id, provider, provider_invoice_id, payment_url, status, updated_at) VALUES (?,?,?,?,?,?,?)
     ON CONFLICT(invoice_id) DO UPDATE SET provider = excluded.provider, provider_invoice_id = excluded.provider_invoice_id, payment_url = excluded.payment_url, status = excluded.status, updated_at = excluded.updated_at`,
    [link.invoiceId, userId, link.provider, link.providerInvoiceId, link.paymentUrl, link.status, new Date().toISOString()],
  );
}
export function openLinks(db: Database): (InvoiceLink & { userId: string })[] {
  return queryAll<LinkRow & { user_id: string }>(db, `SELECT * FROM invoice_provider_links WHERE status IN ('open', 'failed')`).map((r) => ({ ...toLink(r), userId: r.user_id }));
}

/** True the first time an event id is seen (so each webhook is applied once). */
export function firstTime(db: Database, provider: Provider, eventId: string): boolean {
  if (queryOne(db, `SELECT 1 AS x FROM provider_events WHERE provider = ? AND event_id = ?`, [provider, eventId])) return false;
  run(db, `INSERT INTO provider_events (provider, event_id, received_at) VALUES (?,?,?)`, [provider, eventId, new Date().toISOString()]);
  return true;
}

/**
 * Apply a provider status to the KoruLedger invoice. Paid → record the balance as a payment (and
 * income) once; void → void it when nothing's paid; failed → remembered on the link.
 */
export function applyRemoteStatus(db: Database, userId: string, invoiceId: string, status: RemoteStatus, paidOn: string, today: string): { changed: boolean; invoice: Invoice | null } {
  const link = linkFor(db, userId, invoiceId);
  if (!link) return { changed: false, invoice: null };
  const inv = getInvoice(db, userId, invoiceId, today);
  if (!inv) return { changed: false, invoice: null };
  if (link.status === status && status !== 'open') return { changed: false, invoice: inv };
  saveLink(db, userId, { ...link, status });
  if (status === 'paid' && inv.storedStatus === 'sent' && inv.balanceNzd > 0.004) {
    const r = addPayment(db, userId, invoiceId, { date: paidOn, amountNzd: inv.balanceNzd, method: link.provider === 'stripe' ? 'Stripe' : 'Paddle', notes: `Paid in ${link.provider === 'stripe' ? 'Stripe' : 'Paddle'} (${link.providerInvoiceId})`, addToIncome: true }, today);
    return { changed: r.ok, invoice: r.ok ? r.value : inv };
  }
  if (status === 'void' && inv.storedStatus === 'sent' && inv.paidNzd <= 0) {
    const r = voidInvoice(db, userId, invoiceId, today);
    return { changed: r.ok, invoice: r.ok ? r.value : inv };
  }
  return { changed: true, invoice: inv };
}
