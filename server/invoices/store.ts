/**
 * Invoices for one user (KAN-71): business details, clients, invoices, payments,
 * share links and the send log. Every query filters on user_id; a row id from
 * another user behaves exactly like a missing row.
 *
 * Each invoice and client belongs to a business (KAN-84). The details printed on a draft
 * come from its business; Settings → Business edits the default business.
 *
 * Totals are recomputed from the lines on every save. Status: draft / sent / void is
 * stored; partly paid / paid / overdue are counted from payments and the due date.
 * Only drafts can be edited. Drafts and void invoices can be deleted. A sent invoice can be voided (when it has no
 * payments) but never deleted, so the record stays.
 */
import crypto from 'node:crypto';
import type { Database } from 'sql.js';
import type {
  BusinessProfile,
  Invoice,
  InvoiceClient,
  InvoiceLine,
  InvoiceListResponse,
  InvoicePayment,
  InvoiceSendLog,
  InvoiceSummary,
  PublicInvoice,
} from '../../src/types/index.ts';
import {
  DEFAULT_INVOICE_PREFIX,
  dueDateForPreset,
  invoiceNumberKey,
  invoiceStatus,
  invoiceTotals,
  nextInvoiceNumber,
  roundCents,
  type DuePreset,
  type GstMode,
  type InvoiceStoredStatus,
} from '../../src/lib/invoiceCalc.ts';
import { newId, queryAll, queryOne, run } from '../db/index.ts';
import { businessRow, defaultBusinessRow, ensureDefaultBusiness, profileFromBusiness, resolveBusiness, type BusinessRow } from '../business/profile.ts';
import { INCOME_SLUG, resolveCategoryIdOrSlug, seedCategoriesForUser } from '../lib/categories.ts';
import { incomeCategoryForPayee } from '../payees/store.ts';
import { linkMirroredIncomeToBankCredits } from '../lib/incomeBankLink.ts';
import type { ClientDraft, InvoiceDraft, PaymentDraft } from './model.ts';

type Result<T> = { ok: true; value: T } | { ok: false; status: number; error: string };

const fail = (status: number, error: string) => ({ ok: false as const, status, error });

// ---------------------------------------------------------------- business details

type ProfileRow = {
  business_name: string;
  address: string;
  email: string;
  phone: string;
  bank_account: string;
  gst_registered: number;
  gst_number: string;
  nzbn: string;
  invoice_prefix: string;
};

/**
 * What an invoice prints for a business: the given one, else the default business, else the
 * saved Settings → Business details, else a starting point from the account's name and email.
 * Reading never creates a business.
 */
export function getBusinessProfile(db: Database, userId: string, businessId?: string | null): BusinessProfile {
  const biz = (businessId ? businessRow(db, userId, businessId) : null) ?? defaultBusinessRow(db, userId);
  if (biz) return profileFromBusiness(biz);
  const row = queryOne<ProfileRow>(db, `SELECT * FROM business_profiles WHERE user_id = ?`, [userId]);
  if (row) {
    return {
      businessName: row.business_name,
      address: row.address,
      email: row.email,
      phone: row.phone,
      bankAccount: row.bank_account,
      gstRegistered: Number(row.gst_registered) === 1,
      gstNumber: row.gst_number,
      nzbn: row.nzbn,
      invoicePrefix: row.invoice_prefix || DEFAULT_INVOICE_PREFIX,
    };
  }
  const user = queryOne<{ email?: string; display_name?: string | null; first_name?: string | null; last_name?: string | null }>(
    db,
    `SELECT * FROM users WHERE id = ?`,
    [userId],
  );
  const name =
    (user?.display_name ?? '').trim() ||
    [user?.first_name, user?.last_name].filter((p) => p && String(p).trim()).join(' ');
  return {
    businessName: name,
    address: '',
    email: user?.email ?? '',
    phone: '',
    bankAccount: '',
    gstRegistered: false,
    gstNumber: '',
    nzbn: '',
    invoicePrefix: DEFAULT_INVOICE_PREFIX,
  };
}

/** Settings → Business: saves onto the default business (made now if there is none). */
export function saveBusinessProfile(db: Database, userId: string, p: BusinessProfile): BusinessProfile {
  const biz = ensureDefaultBusiness(db, userId);
  const now = new Date().toISOString();
  run(
    db,
    `UPDATE businesses SET name=?, address=?, email=?, phone=?, bank_account=?, gst_registered=?, gst_number=?, nzbn=?,
       invoice_prefix=?, updated_at=? WHERE id=? AND user_id=?`,
    [
      p.businessName.trim(), p.address, p.email, p.phone, p.bankAccount, p.gstRegistered ? 1 : 0, p.gstNumber,
      p.nzbn, p.invoicePrefix, now, biz.id, userId,
    ],
  );
  saveLegacyProfile(db, userId, p, now);
  return getBusinessProfile(db, userId, biz.id);
}

/** Keep business_profiles in step, so a rollback still has the latest Settings → Business details. */
function saveLegacyProfile(db: Database, userId: string, p: BusinessProfile, now: string): void {
  const params = [
    p.businessName, p.address, p.email, p.phone, p.bankAccount, p.gstRegistered ? 1 : 0,
    p.gstNumber, p.nzbn, p.invoicePrefix, now,
  ];
  const exists = queryOne(db, `SELECT user_id FROM business_profiles WHERE user_id = ?`, [userId]);
  if (exists) {
    run(
      db,
      `UPDATE business_profiles SET business_name=?, address=?, email=?, phone=?, bank_account=?,
         gst_registered=?, gst_number=?, nzbn=?, invoice_prefix=?, updated_at=? WHERE user_id=?`,
      [...params, userId],
    );
  } else {
    run(
      db,
      `INSERT INTO business_profiles (business_name, address, email, phone, bank_account, gst_registered,
         gst_number, nzbn, invoice_prefix, updated_at, user_id) VALUES (?,?,?,?,?,?,?,?,?,?,?)`,
      [...params, userId],
    );
  }
}

function parseBusinessJson(raw: string | null | undefined): BusinessProfile | null {
  if (!raw) return null;
  try {
    const o = JSON.parse(raw) as Partial<BusinessProfile>;
    if (typeof o.businessName !== 'string') return null;
    return {
      businessName: o.businessName,
      address: String(o.address ?? ''),
      email: String(o.email ?? ''),
      phone: String(o.phone ?? ''),
      bankAccount: String(o.bankAccount ?? ''),
      gstRegistered: o.gstRegistered === true,
      gstNumber: String(o.gstNumber ?? ''),
      nzbn: String(o.nzbn ?? ''),
      invoicePrefix: String(o.invoicePrefix ?? DEFAULT_INVOICE_PREFIX),
    };
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------- clients

type ClientRow = {
  id: string;
  business_id: string | null;
  name: string;
  contact_person: string | null;
  email: string;
  phone: string | null;
  address: string;
  reference: string;
  notes: string | null;
  status: string | null;
  created_at: string;
  updated_at: string;
};

function presentClient(r: ClientRow): InvoiceClient {
  return {
    id: r.id,
    businessId: r.business_id,
    name: r.name,
    contactPerson: r.contact_person ?? '',
    email: r.email,
    phone: r.phone ?? '',
    address: r.address,
    reference: r.reference,
    notes: r.notes ?? '',
    status: r.status === 'inactive' ? 'inactive' : 'active',
    createdAt: r.created_at,
    updatedAt: r.updated_at,
  };
}

/** Every client, or one business's. */
export function listClients(db: Database, userId: string, businessId?: string | null): InvoiceClient[] {
  return queryAll<ClientRow>(
    db,
    `SELECT * FROM invoice_clients WHERE user_id = ?${businessId ? ' AND business_id = ?' : ''} ORDER BY name COLLATE NOCASE, id`,
    businessId ? [userId, businessId] : [userId],
  ).map(presentClient);
}

export function getClient(db: Database, userId: string, id: string): InvoiceClient | null {
  const r = queryOne<ClientRow>(db, `SELECT * FROM invoice_clients WHERE id = ? AND user_id = ?`, [id, userId]);
  return r ? presentClient(r) : null;
}

/** null = the business isn't this user's. No business → the default one. */
export function createClient(db: Database, userId: string, c: ClientDraft): InvoiceClient | null {
  const biz = resolveBusiness(db, userId, c.businessId);
  if (!biz) return null;
  const id = newId('icl');
  const now = new Date().toISOString();
  run(
    db,
    `INSERT INTO invoice_clients (id, user_id, business_id, name, contact_person, email, phone, address, reference, notes, status, created_at, updated_at)
     VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)`,
    [id, userId, biz.id, c.name, c.contactPerson, c.email, c.phone, c.address, c.reference, c.notes, c.status, now, now],
  );
  return getClient(db, userId, id)!;
}

/** A client keeps its business unless the form names another of this user's businesses. */
export function updateClient(db: Database, userId: string, id: string, c: ClientDraft): InvoiceClient | null {
  const current = getClient(db, userId, id);
  if (!current) return null;
  const businessId = c.businessId && businessRow(db, userId, c.businessId) ? c.businessId : current.businessId;
  run(
    db,
    `UPDATE invoice_clients SET business_id=?, name=?, contact_person=?, email=?, phone=?, address=?, reference=?, notes=?, status=?, updated_at=?
     WHERE id=? AND user_id=?`,
    [businessId, c.name, c.contactPerson, c.email, c.phone, c.address, c.reference, c.notes, c.status, new Date().toISOString(), id, userId],
  );
  return getClient(db, userId, id);
}

/** Invoices keep their own copy of the client's details, so they are only unlinked. */
export function deleteClient(db: Database, userId: string, id: string): boolean {
  if (!getClient(db, userId, id)) return false;
  run(db, `UPDATE invoices SET client_id = NULL WHERE client_id = ? AND user_id = ?`, [id, userId]);
  run(db, `DELETE FROM invoice_clients WHERE id = ? AND user_id = ?`, [id, userId]);
  return true;
}

// ---------------------------------------------------------------- invoices

type InvoiceRow = {
  id: string;
  business_id: string | null;
  number: string;
  number_key: string;
  status: string;
  client_id: string | null;
  client_name: string;
  client_email: string;
  client_address: string;
  client_reference: string;
  issue_date: string;
  due_preset: string;
  due_date: string;
  reference: string;
  gst_mode: string;
  withholding_rate_pct: number | null;
  notes: string;
  payment_instructions: string;
  business_json: string;
  subtotal_nzd: number;
  gst_nzd: number;
  total_nzd: number;
  withholding_nzd: number;
  amount_due_nzd: number;
  share_token: string | null;
  sent_at: string | null;
  voided_at: string | null;
  created_at: string;
  updated_at: string;
};

function storedStatus(r: InvoiceRow): InvoiceStoredStatus {
  return r.status === 'sent' || r.status === 'void' ? r.status : 'draft';
}

function paidTotal(db: Database, userId: string, invoiceId: string): number {
  const row = queryOne<{ total?: number }>(
    db,
    `SELECT COALESCE(SUM(amount_nzd), 0) AS total FROM invoice_payments WHERE invoice_id = ? AND user_id = ?`,
    [invoiceId, userId],
  );
  return roundCents(Number(row?.total ?? 0));
}

function businessNameOf(db: Database, userId: string, businessId: string | null): string {
  if (!businessId) return '';
  return queryOne<{ name: string }>(db, `SELECT name FROM businesses WHERE id = ? AND user_id = ?`, [businessId, userId])?.name ?? '';
}

export function summary(db: Database, userId: string, r: InvoiceRow, today: string): InvoiceSummary {
  const paid = paidTotal(db, userId, r.id);
  const amountDue = roundCents(Number(r.amount_due_nzd));
  const stored = storedStatus(r);
  return {
    id: r.id,
    businessId: r.business_id,
    businessName: businessNameOf(db, userId, r.business_id),
    number: r.number,
    status: invoiceStatus({ stored, amountDue, paid, dueDate: r.due_date, today }),
    storedStatus: stored,
    clientId: r.client_id,
    clientName: r.client_name,
    issueDate: r.issue_date,
    dueDate: r.due_date,
    totalNzd: roundCents(Number(r.total_nzd)),
    amountDueNzd: amountDue,
    paidNzd: paid,
    balanceNzd: stored === 'void' ? 0 : roundCents(Math.max(0, amountDue - paid)),
    sentAt: r.sent_at,
  };
}

function lines(db: Database, userId: string, invoiceId: string): InvoiceLine[] {
  return queryAll<{ id: string; description: string; quantity: number; unit: string; rate: number; line_total: number }>(
    db,
    `SELECT * FROM invoice_lines WHERE invoice_id = ? AND user_id = ? ORDER BY position, id`,
    [invoiceId, userId],
  ).map((l) => ({
    id: l.id,
    description: l.description,
    quantity: Number(l.quantity),
    unit: l.unit,
    rate: Number(l.rate),
    lineTotalNzd: roundCents(Number(l.line_total)),
  }));
}

function payments(db: Database, userId: string, invoiceId: string): InvoicePayment[] {
  return queryAll<{ id: string; date: string; amount_nzd: number; method: string; notes: string; income_record_id: string | null; created_at: string }>(
    db,
    `SELECT * FROM invoice_payments WHERE invoice_id = ? AND user_id = ? ORDER BY date, created_at`,
    [invoiceId, userId],
  ).map((p) => ({
    id: p.id,
    date: p.date,
    amountNzd: roundCents(Number(p.amount_nzd)),
    method: p.method,
    notes: p.notes,
    incomeRecordId: p.income_record_id,
    createdAt: p.created_at,
  }));
}

function sends(db: Database, userId: string, invoiceId: string): InvoiceSendLog[] {
  return queryAll<{ id: string; kind: string; channel: string; recipients: string; subject: string; status: string; error: string | null; sent_at: string }>(
    db,
    `SELECT * FROM invoice_sends WHERE invoice_id = ? AND user_id = ? ORDER BY sent_at DESC`,
    [invoiceId, userId],
  ).map((s) => {
    let recipients: string[] = [];
    try {
      recipients = JSON.parse(s.recipients) as string[];
    } catch {
      recipients = [];
    }
    return {
      id: s.id,
      kind: s.kind === 'reminder' ? 'reminder' : 'invoice',
      channel: s.channel === 'email_app' || s.channel === 'share' ? s.channel : 'resend',
      recipients,
      subject: s.subject,
      status: s.status === 'sent' ? 'sent' : 'failed',
      error: s.error,
      sentAt: s.sent_at,
    };
  });
}

function row(db: Database, userId: string, id: string): InvoiceRow | null {
  return queryOne<InvoiceRow>(db, `SELECT * FROM invoices WHERE id = ? AND user_id = ?`, [id, userId]);
}

/** Drafts show their business's current details; sent invoices keep the copy made when sent. */
function businessFor(db: Database, userId: string, r: InvoiceRow): BusinessProfile {
  if (storedStatus(r) === 'draft') return getBusinessProfile(db, userId, r.business_id);
  return parseBusinessJson(r.business_json) ?? getBusinessProfile(db, userId, r.business_id);
}

function titleFor(business: BusinessProfile, gstMode: GstMode): 'Tax invoice' | 'Invoice' {
  return business.gstRegistered && gstMode !== 'none' ? 'Tax invoice' : 'Invoice';
}

export function shareUrlFor(shareBase: string, token: string): string {
  return `${shareBase.replace(/\/+$/, '')}/i/${token}`;
}

export function getInvoice(
  db: Database,
  userId: string,
  id: string,
  today: string,
  shareBase = '',
): Invoice | null {
  const r = row(db, userId, id);
  if (!r) return null;
  const business = businessFor(db, userId, r);
  const gstMode = (['none', 'exclusive', 'inclusive'].includes(r.gst_mode) ? r.gst_mode : 'none') as GstMode;
  return {
    ...summary(db, userId, r, today),
    clientEmail: r.client_email,
    clientAddress: r.client_address,
    clientReference: r.client_reference,
    duePreset: r.due_preset as DuePreset,
    reference: r.reference,
    gstMode,
    withholdingRatePct: r.withholding_rate_pct == null ? null : Number(r.withholding_rate_pct),
    notes: r.notes,
    paymentInstructions: r.payment_instructions,
    business,
    lines: lines(db, userId, r.id),
    subtotalNzd: roundCents(Number(r.subtotal_nzd)),
    gstNzd: roundCents(Number(r.gst_nzd)),
    withholdingNzd: roundCents(Number(r.withholding_nzd)),
    title: titleFor(business, gstMode),
    shareUrl: r.share_token ? shareUrlFor(shareBase, r.share_token) : null,
    payments: payments(db, userId, r.id),
    sends: sends(db, userId, r.id),
    voidedAt: r.voided_at,
    createdAt: r.created_at,
    updatedAt: r.updated_at,
  };
}

function usedNumbers(db: Database, userId: string): string[] {
  return queryAll<{ number: string }>(db, `SELECT number FROM invoices WHERE user_id = ?`, [userId]).map((r) => r.number);
}

/** Numbers are unique across all of a user's invoices; the prefix is the business's. */
export function suggestNextNumber(db: Database, userId: string, businessId?: string | null): string {
  return nextInvoiceNumber(usedNumbers(db, userId), getBusinessProfile(db, userId, businessId).invoicePrefix);
}

function numberTaken(db: Database, userId: string, key: string, exceptId: string | null): boolean {
  const r = queryOne<{ id: string }>(
    db,
    `SELECT id FROM invoices WHERE user_id = ? AND number_key = ?${exceptId ? ' AND id != ?' : ''}`,
    exceptId ? [userId, key, exceptId] : [userId, key],
  );
  return r != null;
}

/** Fill derived fields, check the client and number, and recompute totals. */
function prepare(
  db: Database,
  userId: string,
  draft: InvoiceDraft,
  exceptId: string | null,
): Result<{ biz: BusinessRow; number: string; gstMode: GstMode; dueDate: string; clientId: string | null; totals: ReturnType<typeof invoiceTotals> }> {
  const biz = resolveBusiness(db, userId, draft.businessId);
  if (!biz) return fail(400, 'Business not found');
  const business = profileFromBusiness(biz);
  const number = draft.number ?? suggestNextNumber(db, userId, biz.id);
  if (numberTaken(db, userId, invoiceNumberKey(number), exceptId)) {
    return fail(409, `Invoice number ${number} is already used`);
  }
  let clientId: string | null = null;
  if (draft.clientId) {
    const client = getClient(db, userId, draft.clientId);
    if (!client) return fail(400, 'Client not found');
    if (client.businessId && client.businessId !== biz.id) return fail(400, 'That client belongs to another business');
    clientId = draft.clientId;
  }
  // GST is charged only by GST-registered businesses. A registered business can leave
  // it off (the builder's GST checkbox); exclusive and inclusive are kept as entered.
  let gstMode: GstMode = draft.gstMode;
  if (!business.gstRegistered) gstMode = 'none';
  const dueDate = dueDateForPreset(draft.issueDate, draft.duePreset, draft.dueDate);
  const totals = invoiceTotals(draft.lines, gstMode, draft.withholdingRatePct);
  return { ok: true, value: { biz, number, gstMode, dueDate, clientId, totals } };
}

function writeLines(db: Database, userId: string, invoiceId: string, draft: InvoiceDraft, lineTotals: number[]): void {
  run(db, `DELETE FROM invoice_lines WHERE invoice_id = ? AND user_id = ?`, [invoiceId, userId]);
  draft.lines.forEach((l, i) => {
    run(
      db,
      `INSERT INTO invoice_lines (id, user_id, invoice_id, position, description, quantity, unit, rate, line_total)
       VALUES (?,?,?,?,?,?,?,?,?)`,
      [newId('inl'), userId, invoiceId, i, l.description, l.quantity, l.unit, l.rate, lineTotals[i]],
    );
  });
}

export function createInvoice(db: Database, userId: string, draft: InvoiceDraft, today: string, shareBase = ''): Result<Invoice> {
  const prep = prepare(db, userId, draft, null);
  if (!prep.ok) return prep;
  const { biz, number, gstMode, dueDate, clientId, totals } = prep.value;
  const id = newId('inv');
  const now = new Date().toISOString();
  run(
    db,
    `INSERT INTO invoices (id, user_id, business_id, number, number_key, status, client_id, client_name, client_email,
       client_address, client_reference, issue_date, due_preset, due_date, reference, gst_mode,
       withholding_rate_pct, notes, payment_instructions, business_json, subtotal_nzd, gst_nzd, total_nzd,
       withholding_nzd, amount_due_nzd, created_at, updated_at)
     VALUES (?,?,?,?,?,'draft',?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
    [
      id, userId, biz.id, number, invoiceNumberKey(number), clientId, draft.clientName, draft.clientEmail,
      draft.clientAddress, draft.clientReference, draft.issueDate, draft.duePreset, dueDate, draft.reference,
      gstMode, draft.withholdingRatePct, draft.notes, draft.paymentInstructions,
      JSON.stringify(profileFromBusiness(biz)), totals.subtotal, totals.gst, totals.total,
      totals.withholding, totals.amountDue, now, now,
    ],
  );
  writeLines(db, userId, id, draft, totals.lineTotals);
  return { ok: true, value: getInvoice(db, userId, id, today, shareBase)! };
}

export function updateInvoice(
  db: Database,
  userId: string,
  id: string,
  draft: InvoiceDraft,
  today: string,
  shareBase = '',
): Result<Invoice> {
  const r = row(db, userId, id);
  if (!r) return fail(404, 'Invoice not found');
  if (storedStatus(r) !== 'draft') return fail(409, 'Only draft invoices can be edited. Void it and duplicate instead.');
  const prep = prepare(db, userId, { ...draft, businessId: draft.businessId ?? r.business_id, number: draft.number ?? r.number }, id);
  if (!prep.ok) return prep;
  const { biz, number, gstMode, dueDate, clientId, totals } = prep.value;
  run(
    db,
    `UPDATE invoices SET business_id=?, number=?, number_key=?, client_id=?, client_name=?, client_email=?, client_address=?,
       client_reference=?, issue_date=?, due_preset=?, due_date=?, reference=?, gst_mode=?, withholding_rate_pct=?,
       notes=?, payment_instructions=?, business_json=?, subtotal_nzd=?, gst_nzd=?, total_nzd=?, withholding_nzd=?,
       amount_due_nzd=?, updated_at=?
     WHERE id=? AND user_id=?`,
    [
      biz.id, number, invoiceNumberKey(number), clientId, draft.clientName, draft.clientEmail, draft.clientAddress,
      draft.clientReference, draft.issueDate, draft.duePreset, dueDate, draft.reference, gstMode,
      draft.withholdingRatePct, draft.notes, draft.paymentInstructions, JSON.stringify(profileFromBusiness(biz)),
      totals.subtotal, totals.gst, totals.total, totals.withholding, totals.amountDue, new Date().toISOString(),
      id, userId,
    ],
  );
  writeLines(db, userId, id, draft, totals.lineTotals);
  return { ok: true, value: getInvoice(db, userId, id, today, shareBase)! };
}

export function deleteInvoice(db: Database, userId: string, id: string): Result<true> {
  const r = row(db, userId, id);
  if (!r) return fail(404, 'Invoice not found');
  // Sent / paid invoices stay on record; void ones (never paid) and drafts can go.
  if (storedStatus(r) === 'sent') return fail(409, 'Sent invoices can’t be deleted. Void it first, then delete it.');
  run(db, `DELETE FROM invoice_lines WHERE invoice_id = ? AND user_id = ?`, [id, userId]);
  run(db, `DELETE FROM invoice_sends WHERE invoice_id = ? AND user_id = ?`, [id, userId]);
  run(db, `DELETE FROM invoices WHERE id = ? AND user_id = ?`, [id, userId]);
  return { ok: true, value: true };
}

/** What an invoice needs before it can go to a client. */
export function sendProblem(inv: Invoice): string | null {
  if (inv.lines.length === 0) return 'Add at least one line before sending.';
  if (!inv.clientName.trim()) return 'Add the client’s name before sending.';
  if (!inv.business.businessName.trim()) return 'Add your name or business name on the Business page before sending.';
  if (inv.business.gstRegistered && !inv.business.gstNumber.trim()) return 'Add your GST number on the Business page.';
  // IRD taxable supply information: over $1,000, a GST-registered buyer must be identified
  // by name plus an address, phone, email, NZBN or similar. Email or address covers it here.
  if (inv.title === 'Tax invoice' && inv.totalNzd > 1000 && !inv.clientEmail.trim() && !inv.clientAddress.trim()) {
    return 'Tax invoices over $1,000 need the client’s address or email as well as their name.';
  }
  return null;
}

/** Draft → sent. Freezes the business details printed on it. Already-sent invoices are left as they are. */
export function markSent(db: Database, userId: string, id: string, today: string, shareBase = ''): Result<Invoice> {
  const inv = getInvoice(db, userId, id, today, shareBase);
  if (!inv) return fail(404, 'Invoice not found');
  if (inv.storedStatus === 'void') return fail(409, 'This invoice is void');
  if (inv.storedStatus === 'sent') return { ok: true, value: inv };
  const problem = sendProblem(inv);
  if (problem) return fail(400, problem);
  const now = new Date().toISOString();
  run(
    db,
    `UPDATE invoices SET status='sent', sent_at=?, business_json=?, updated_at=? WHERE id=? AND user_id=? AND status='draft'`,
    [now, JSON.stringify(getBusinessProfile(db, userId, inv.businessId)), now, id, userId],
  );
  return { ok: true, value: getInvoice(db, userId, id, today, shareBase)! };
}

export function voidInvoice(db: Database, userId: string, id: string, today: string, shareBase = ''): Result<Invoice> {
  const r = row(db, userId, id);
  if (!r) return fail(404, 'Invoice not found');
  const stored = storedStatus(r);
  if (stored === 'draft') return fail(409, 'Drafts can be deleted instead of voided.');
  if (stored === 'void') return fail(409, 'This invoice is already void');
  if (paidTotal(db, userId, id) > 0) return fail(409, 'Remove the recorded payments before voiding this invoice.');
  const now = new Date().toISOString();
  run(db, `UPDATE invoices SET status='void', voided_at=?, updated_at=? WHERE id=? AND user_id=?`, [now, now, id, userId]);
  return { ok: true, value: getInvoice(db, userId, id, today, shareBase)! };
}

/** New draft with the same client and lines, today's date and the next number. */
export function duplicateInvoice(db: Database, userId: string, id: string, today: string, shareBase = ''): Result<Invoice> {
  const src = getInvoice(db, userId, id, today);
  if (!src) return fail(404, 'Invoice not found');
  return createInvoice(
    db,
    userId,
    {
      businessId: src.businessId,
      number: null,
      clientId: src.clientId && getClient(db, userId, src.clientId) ? src.clientId : null,
      clientName: src.clientName,
      clientEmail: src.clientEmail,
      clientAddress: src.clientAddress,
      clientReference: src.clientReference,
      issueDate: today,
      duePreset: src.duePreset === 'custom' ? 'days_14' : src.duePreset,
      dueDate: null,
      reference: '',
      gstMode: src.gstMode,
      withholdingRatePct: src.withholdingRatePct,
      notes: src.notes,
      paymentInstructions: src.paymentInstructions,
      lines: src.lines.map((l) => ({ description: l.description, quantity: l.quantity, unit: l.unit, rate: l.rate })),
    },
    today,
    shareBase,
  );
}

export type InvoiceFilters = {
  status?: string | null;
  clientId?: string | null;
  businessId?: string | null;
  from?: string | null;
  to?: string | null;
};

/** NZ tax year start (1 April) for a date. */
export function taxYearStart(today: string): string {
  const y = Number(today.slice(0, 4));
  return today.slice(5) >= '04-01' ? `${y}-04-01` : `${y - 1}-04-01`;
}

export function listInvoices(
  db: Database,
  userId: string,
  filters: InvoiceFilters,
  today: string,
): Omit<InvoiceListResponse, 'emailEnabled'> {
  // With a business picked, the totals and the next number are that business's.
  const biz = filters.businessId ? filters.businessId : null;
  const all = queryAll<InvoiceRow>(
    db,
    `SELECT * FROM invoices WHERE user_id = ?${biz ? ' AND business_id = ?' : ''} ORDER BY issue_date DESC, created_at DESC`,
    biz ? [userId, biz] : [userId],
  ).map((r) => summary(db, userId, r, today));

  let outstanding = 0;
  let overdue = 0;
  for (const inv of all) {
    if (inv.storedStatus !== 'sent') continue;
    outstanding += inv.balanceNzd;
    if (inv.status === 'overdue') overdue += inv.balanceNzd;
  }
  const monthStart = `${today.slice(0, 7)}-01`;
  const tyStart = taxYearStart(today);
  const paidSince = (from: string) =>
    Number(
      queryOne<{ total?: number }>(
        db,
        `SELECT COALESCE(SUM(p.amount_nzd), 0) AS total FROM invoice_payments p
         INNER JOIN invoices i ON i.id = p.invoice_id AND i.user_id = p.user_id
         WHERE p.user_id = ? AND p.date >= ? AND p.date <= ? AND i.status != 'void'${biz ? ' AND i.business_id = ?' : ''}`,
        biz ? [userId, from, today, biz] : [userId, from, today],
      )?.total ?? 0,
    );

  const invoices = all.filter(
    (inv) =>
      (!filters.status || inv.status === filters.status) &&
      (!filters.clientId || inv.clientId === filters.clientId) &&
      (!filters.from || inv.issueDate >= filters.from) &&
      (!filters.to || inv.issueDate <= filters.to),
  );
  return {
    invoices,
    totals: {
      outstandingNzd: roundCents(outstanding),
      overdueNzd: roundCents(overdue),
      paidThisMonthNzd: roundCents(paidSince(monthStart)),
      paidTaxYearNzd: roundCents(paidSince(tyStart)),
      taxYearStart: tyStart,
    },
    nextNumber: suggestNextNumber(db, userId, biz),
  };
}

// ---------------------------------------------------------------- payments → income

export function addPayment(
  db: Database,
  userId: string,
  invoiceId: string,
  p: PaymentDraft,
  today: string,
  shareBase = '',
): Result<Invoice> {
  const inv = getInvoice(db, userId, invoiceId, today, shareBase);
  if (!inv) return fail(404, 'Invoice not found');
  if (inv.storedStatus !== 'sent') {
    return fail(409, inv.storedStatus === 'draft' ? 'Mark the invoice as sent before recording a payment.' : 'This invoice is void');
  }
  if (p.amountNzd > inv.balanceNzd + 0.004) {
    return fail(400, `Payment is more than the ${inv.balanceNzd.toFixed(2)} still owed`);
  }
  const id = newId('ipay');
  const now = new Date().toISOString();
  let incomeId: string | null = null;
  if (p.addToIncome) {
    seedCategoriesForUser(db, userId);
    const categoryId =
      incomeCategoryForPayee(db, userId, inv.clientName) ?? resolveCategoryIdOrSlug(db, userId, INCOME_SLUG);
    incomeId = newId('inc');
    run(
      db,
      `INSERT INTO income_records (id, user_id, date, amount_nzd, kind, description, category_id, notes, created_at, invoice_payment_id, business_id)
       VALUES (?,?,?,?, 'cash', ?, ?, ?, ?, ?, ?)`,
      [
        incomeId, userId, p.date, p.amountNzd, `Invoice ${inv.number} · ${inv.clientName}`.slice(0, 200),
        categoryId, `Payment recorded on invoice ${inv.number}${p.method ? ` (${p.method})` : ''}.`, now, id, inv.businessId,
      ],
    );
  }
  run(
    db,
    `INSERT INTO invoice_payments (id, user_id, invoice_id, date, amount_nzd, method, notes, income_record_id, created_at)
     VALUES (?,?,?,?,?,?,?,?,?)`,
    [id, userId, invoiceId, p.date, p.amountNzd, p.method, p.notes, incomeId, now],
  );
  if (incomeId) linkMirroredIncomeToBankCredits(db, userId);
  return { ok: true, value: getInvoice(db, userId, invoiceId, today, shareBase)! };
}

export function deletePayment(
  db: Database,
  userId: string,
  invoiceId: string,
  paymentId: string,
  today: string,
  shareBase = '',
): Result<Invoice> {
  const p = queryOne<{ id: string; income_record_id: string | null }>(
    db,
    `SELECT id, income_record_id FROM invoice_payments WHERE id = ? AND invoice_id = ? AND user_id = ?`,
    [paymentId, invoiceId, userId],
  );
  if (!p) return fail(404, 'Payment not found');
  run(db, `DELETE FROM income_records WHERE user_id = ? AND invoice_payment_id = ?`, [userId, paymentId]);
  run(db, `DELETE FROM invoice_payments WHERE id = ? AND user_id = ?`, [paymentId, userId]);
  return { ok: true, value: getInvoice(db, userId, invoiceId, today, shareBase)! };
}

// ---------------------------------------------------------------- share links

export function newShareToken(): string {
  return crypto.randomBytes(24).toString('base64url');
}

export function enableShareLink(db: Database, userId: string, id: string, today: string, shareBase: string): Result<Invoice> {
  const r = row(db, userId, id);
  if (!r) return fail(404, 'Invoice not found');
  if (storedStatus(r) === 'void') return fail(409, 'This invoice is void');
  if (!r.share_token) {
    run(db, `UPDATE invoices SET share_token = ?, updated_at = ? WHERE id = ? AND user_id = ?`, [
      newShareToken(), new Date().toISOString(), id, userId,
    ]);
  }
  return { ok: true, value: getInvoice(db, userId, id, today, shareBase)! };
}

/** The old link stops working at once. A new link gets a new token. */
export function revokeShareLink(db: Database, userId: string, id: string, today: string, shareBase: string): Result<Invoice> {
  if (!row(db, userId, id)) return fail(404, 'Invoice not found');
  run(db, `UPDATE invoices SET share_token = NULL, updated_at = ? WHERE id = ? AND user_id = ?`, [
    new Date().toISOString(), id, userId,
  ]);
  return { ok: true, value: getInvoice(db, userId, id, today, shareBase)! };
}

/** Owner and invoice id for a live share token, or null. */
export function resolveShareToken(db: Database, token: string): { userId: string; invoiceId: string } | null {
  if (!/^[A-Za-z0-9_-]{32}$/.test(token)) return null;
  const r = queryOne<{ id: string; user_id: string }>(db, `SELECT id, user_id FROM invoices WHERE share_token = ?`, [token]);
  return r ? { userId: r.user_id, invoiceId: r.id } : null;
}

/** Only what is printed on the invoice. No ids, payments history, send log or other data. */
export function toPublicInvoice(inv: Invoice): PublicInvoice {
  return {
    number: inv.number,
    title: inv.title,
    status: inv.status,
    business: inv.business,
    clientName: inv.clientName,
    clientEmail: inv.clientEmail,
    clientAddress: inv.clientAddress,
    clientReference: inv.clientReference,
    issueDate: inv.issueDate,
    dueDate: inv.dueDate,
    reference: inv.reference,
    gstMode: inv.gstMode,
    lines: inv.lines.map((l, i) => ({ ...l, id: String(i + 1) })),
    subtotalNzd: inv.subtotalNzd,
    gstNzd: inv.gstNzd,
    totalNzd: inv.totalNzd,
    withholdingRatePct: inv.withholdingRatePct,
    withholdingNzd: inv.withholdingNzd,
    amountDueNzd: inv.amountDueNzd,
    paidNzd: inv.paidNzd,
    balanceNzd: inv.balanceNzd,
    notes: inv.notes,
    paymentInstructions: inv.paymentInstructions,
  };
}

// ---------------------------------------------------------------- send log + rate limit

export function logSend(
  db: Database,
  userId: string,
  invoiceId: string,
  entry: {
    kind: 'invoice' | 'reminder';
    channel?: 'resend' | 'email_app' | 'share';
    recipients: string[];
    subject: string;
    status: 'sent' | 'failed';
    providerId?: string | null;
    error?: string | null;
  },
): void {
  run(
    db,
    `INSERT INTO invoice_sends (id, user_id, invoice_id, kind, channel, recipients, subject, status, provider_id, error, sent_at)
     VALUES (?,?,?,?,?,?,?,?,?,?,?)`,
    [
      newId('isnd'), userId, invoiceId, entry.kind, entry.channel ?? 'resend', JSON.stringify(entry.recipients), entry.subject, entry.status,
      entry.providerId ?? null, entry.error ?? null, new Date().toISOString(),
    ],
  );
}

/**
 * Emails the app sent (or tried to) for this user since a time. Failed attempts count;
 * sends the user made from their own email app or share sheet don't.
 */
export function sendsSince(db: Database, userId: string, sinceIso: string): number {
  return Number(
    queryOne<{ c?: number }>(
      db,
      `SELECT COUNT(*) AS c FROM invoice_sends WHERE user_id = ? AND sent_at >= ? AND channel = 'resend'`,
      [userId, sinceIso],
    )?.c ?? 0,
  );
}

// ---------------------------------------------------------------- CSV

function csvCell(v: string | number | null): string {
  if (v == null) return '';
  const s = typeof v === 'number' ? v.toFixed(2) : v;
  // Neutralise spreadsheet formulas in text cells.
  const safe = typeof v === 'string' && /^[=+\-@\t\r]/.test(s) ? `'${s}` : s;
  return /[",\n\r]/.test(safe) ? `"${safe.replace(/"/g, '""')}"` : safe;
}

export function invoicesCsv(db: Database, userId: string, today: string): string {
  const header = [
    'Number', 'Status', 'Issue date', 'Due date', 'Client', 'Client email', 'Reference', 'GST',
    'Subtotal (excl. GST)', 'GST amount', 'Total', 'Withholding', 'Amount due', 'Paid', 'Balance', 'Sent at',
  ];
  const rows = queryAll<InvoiceRow>(db, `SELECT * FROM invoices WHERE user_id = ? ORDER BY issue_date, number_key`, [userId]);
  const out = [header.map(csvCell).join(',')];
  for (const r of rows) {
    const s = summary(db, userId, r, today);
    out.push(
      [
        r.number, s.status, r.issue_date, r.due_date, r.client_name, r.client_email, r.reference, r.gst_mode,
        Number(r.subtotal_nzd), Number(r.gst_nzd), Number(r.total_nzd), Number(r.withholding_nzd),
        s.amountDueNzd, s.paidNzd, s.balanceNzd, r.sent_at ?? '',
      ].map(csvCell).join(','),
    );
  }
  return `${out.join('\r\n')}\r\n`;
}
