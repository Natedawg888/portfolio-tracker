/**
 * Stripe and Paddle calls for invoice sync (KAN-73). Both are swappable in tests.
 */
import { createHmac, timingSafeEqual } from 'node:crypto';
import type Stripe from 'stripe';
import { billingConfig } from '../billing/config.ts';
import { stripeClient } from '../billing/client.ts';
import type { Invoice } from '../../src/types/index.ts';
import type { Connection, RemoteStatus } from './store.ts';

export type RemoteInvoice = { providerInvoiceId: string; paymentUrl: string | null };

export interface ProviderApi {
  createInvoice(conn: Connection, inv: Invoice): Promise<RemoteInvoice>;
  fetchStatus(conn: Connection, providerInvoiceId: string): Promise<{ status: RemoteStatus; paidOn: string | null }>;
}

export class ProviderError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message);
  }
}

const cents = (nzd: number) => Math.round(nzd * 100);
const daysUntil = (due: string, today: string) => Math.max(0, Math.round((Date.parse(`${due}T00:00:00Z`) - Date.parse(`${today}T00:00:00Z`)) / 86_400_000));
const lineText = (inv: Invoice) => `Invoice ${inv.number}${inv.gstNzd > 0 ? ` (incl. GST ${inv.gstNzd.toFixed(2)})` : ''}`;

// --- Stripe (Connect) ------------------------------------------------------------------

export function stripePlatform(): { client: Stripe; live: boolean; connectClientId: string | null; webhookSecret: string | null } {
  const cfg = billingConfig();
  if (!cfg.ok) throw new ProviderError(503, 'Stripe isn’t set up on this server.');
  return {
    client: stripeClient(cfg.config),
    live: cfg.config.live,
    connectClientId: process.env.STRIPE_CONNECT_CLIENT_ID?.trim() || null,
    webhookSecret: process.env.STRIPE_CONNECT_WEBHOOK_SECRET?.trim() || null,
  };
}

const stripeStatus = (s: string | null | undefined): RemoteStatus => (s === 'paid' ? 'paid' : s === 'void' || s === 'uncollectible' ? 'void' : 'open');

export const stripeApi: ProviderApi = {
  async createInvoice(conn, inv) {
    const { client } = stripePlatform();
    const opts = { stripeAccount: conn.accountRef };
    const today = new Date().toISOString().slice(0, 10);
    const customer = await client.customers.create({ name: inv.clientName.slice(0, 200), email: inv.clientEmail || undefined, metadata: { koruledger_invoice: inv.id } }, opts);
    const remote = await client.invoices.create(
      { customer: customer.id, collection_method: 'send_invoice', days_until_due: daysUntil(inv.dueDate, today), currency: 'nzd', description: inv.reference || undefined, metadata: { koruledger_invoice: inv.id, number: inv.number }, auto_advance: false },
      opts,
    );
    await client.invoiceItems.create({ customer: customer.id, invoice: remote.id, currency: 'nzd', amount: cents(inv.balanceNzd), description: lineText(inv) }, opts);
    const finalised = await client.invoices.finalizeInvoice(remote.id!, {}, opts);
    return { providerInvoiceId: finalised.id!, paymentUrl: finalised.hosted_invoice_url ?? null };
  },
  async fetchStatus(conn, id) {
    const { client } = stripePlatform();
    const r = await client.invoices.retrieve(id, {}, { stripeAccount: conn.accountRef });
    const paidAt = r.status_transitions?.paid_at;
    return { status: stripeStatus(r.status), paidOn: paidAt ? new Date(paidAt * 1000).toISOString().slice(0, 10) : null };
  },
};

/** Stripe event → which invoice and what it means now. Null for events we don't use. */
export function stripeEventStatus(event: { type: string; data: { object: { id?: string; status?: string | null; status_transitions?: { paid_at?: number | null } } } }): { invoiceId: string; status: RemoteStatus; paidOn: string | null } | null {
  const obj = event.data.object;
  if (!obj.id) return null;
  const paidAt = obj.status_transitions?.paid_at;
  const paidOn = paidAt ? new Date(paidAt * 1000).toISOString().slice(0, 10) : null;
  if (event.type === 'invoice.paid') return { invoiceId: obj.id, status: 'paid', paidOn };
  if (event.type === 'invoice.voided' || event.type === 'invoice.marked_uncollectible') return { invoiceId: obj.id, status: 'void', paidOn: null };
  if (event.type === 'invoice.payment_failed') return { invoiceId: obj.id, status: 'failed', paidOn: null };
  return null;
}

// --- Paddle Billing ----------------------------------------------------------------------

type Fetch = (url: string, init: { method: string; headers: Record<string, string>; body?: string }) => Promise<{ ok: boolean; status: number; json(): Promise<unknown> }>;
let fetchImpl: Fetch = (url, init) => fetch(url, init) as unknown as ReturnType<Fetch>;
export function setPaddleFetchForTest(f: Fetch | null): void {
  fetchImpl = f ?? ((url, init) => fetch(url, init) as unknown as ReturnType<Fetch>);
}

export function paddleMode(apiKey: string): 'test' | 'live' | null {
  if (/^pdl_sdbx_/.test(apiKey)) return 'test';
  if (/^pdl_live_/.test(apiKey)) return process.env.PADDLE_LIVE_ENABLED === '1' ? 'live' : null;
  return null;
}
const paddleBase = (conn: { mode: 'test' | 'live' }) => (conn.mode === 'live' ? 'https://api.paddle.com' : 'https://sandbox-api.paddle.com');

async function paddle<T>(conn: { apiKey: string | null; mode: 'test' | 'live' }, method: string, path: string, body?: unknown): Promise<T> {
  if (!conn.apiKey) throw new ProviderError(409, 'Paddle isn’t connected.');
  const res = await fetchImpl(`${paddleBase(conn)}${path}`, {
    method,
    headers: { Authorization: `Bearer ${conn.apiKey}`, 'Content-Type': 'application/json' },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
  const json = (await res.json().catch(() => ({}))) as { data?: T; error?: { detail?: string } };
  if (!res.ok) throw new ProviderError(res.status === 401 || res.status === 403 ? 400 : 502, `Paddle: ${json.error?.detail ?? `error ${res.status}`}`);
  return json.data as T;
}

/** Check a Paddle key works (lists one customer). */
export async function checkPaddleKey(apiKey: string, mode: 'test' | 'live'): Promise<void> {
  await paddle({ apiKey, mode }, 'GET', '/customers?per_page=1');
}

const paddleStatus = (s: string | undefined): RemoteStatus => (s === 'completed' || s === 'paid' ? 'paid' : s === 'canceled' ? 'void' : 'open');

export const paddleApi: ProviderApi = {
  async createInvoice(conn, inv) {
    if (!inv.clientEmail) throw new ProviderError(400, 'Add the client’s email first: Paddle needs it.');
    let customerId: string;
    try {
      customerId = (await paddle<{ id: string }>(conn, 'POST', '/customers', { email: inv.clientEmail, name: inv.clientName.slice(0, 200) })).id;
    } catch {
      const found = await paddle<{ id: string }[]>(conn, 'GET', `/customers?email=${encodeURIComponent(inv.clientEmail)}`);
      if (!found?.[0]) throw new ProviderError(502, 'Paddle: couldn’t find or create the customer.');
      customerId = found[0].id;
    }
    const address = await paddle<{ id: string }>(conn, 'POST', `/customers/${customerId}/addresses`, { country_code: 'NZ' });
    const today = new Date().toISOString().slice(0, 10);
    const txn = await paddle<{ id: string }>(conn, 'POST', '/transactions', {
      customer_id: customerId,
      address_id: address.id,
      currency_code: 'NZD',
      collection_mode: 'manual',
      billing_details: { payment_terms: { interval: 'day', frequency: Math.max(1, daysUntil(inv.dueDate, today)) } },
      custom_data: { koruledger_invoice: inv.id, number: inv.number },
      items: [{ quantity: 1, price: { description: lineText(inv), name: lineText(inv), unit_price: { amount: String(cents(inv.balanceNzd)), currency_code: 'NZD' }, product: { name: `Invoice ${inv.number}`, tax_category: 'standard' } } }],
    });
    await paddle(conn, 'PATCH', `/transactions/${txn.id}`, { status: 'billed' });
    const pdf = await paddle<{ url?: string }>(conn, 'GET', `/transactions/${txn.id}/invoice`).catch(() => ({ url: undefined }));
    return { providerInvoiceId: txn.id, paymentUrl: pdf.url ?? null };
  },
  async fetchStatus(conn, id) {
    const t = await paddle<{ status?: string; billed_at?: string | null; updated_at?: string }>(conn, 'GET', `/transactions/${id}`);
    const status = paddleStatus(t.status);
    return { status, paidOn: status === 'paid' ? (t.updated_at ?? '').slice(0, 10) || null : null };
  },
};

/** Paddle-Signature: "ts=<unix>;h1=<hex HMAC-SHA256(secret, ts:body)>". Rejects stale (> 5 min) or wrong. */
export function verifyPaddleSignature(header: string | undefined, rawBody: Buffer, secret: string, nowSec = Math.floor(Date.now() / 1000)): boolean {
  if (!header) return false;
  const parts = Object.fromEntries(header.split(';').map((p) => p.split('=') as [string, string]));
  const ts = Number(parts.ts);
  if (!Number.isFinite(ts) || Math.abs(nowSec - ts) > 300 || !parts.h1) return false;
  const expected = createHmac('sha256', secret).update(`${parts.ts}:`).update(rawBody).digest('hex');
  const a = Buffer.from(expected, 'hex');
  const b = Buffer.from(parts.h1, 'hex');
  return a.length === b.length && timingSafeEqual(a, b);
}

/** Paddle event → invoice status. */
export function paddleEventStatus(event: { event_type?: string; data?: { id?: string; status?: string; updated_at?: string } }): { invoiceId: string; status: RemoteStatus; paidOn: string | null } | null {
  const id = event.data?.id;
  if (!id) return null;
  if (event.event_type === 'transaction.completed' || event.event_type === 'transaction.paid') return { invoiceId: id, status: 'paid', paidOn: (event.data?.updated_at ?? '').slice(0, 10) || null };
  if (event.event_type === 'transaction.payment_failed') return { invoiceId: id, status: 'failed', paidOn: null };
  if (event.event_type === 'transaction.canceled') return { invoiceId: id, status: 'void', paidOn: null };
  return null;
}

export const PROVIDERS: Record<'stripe' | 'paddle', ProviderApi> = { stripe: stripeApi, paddle: paddleApi };
