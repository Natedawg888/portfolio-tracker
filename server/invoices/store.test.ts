/**
 * Invoices API (KAN-71): numbering, user isolation, status transitions, payments and
 * income, bank-deposit dedupe, share links, sending (confirm, rate limit, log), PDF, CSV.
 * Run: npm run test:invoices
 *
 * Uses a throwaway sqlite file and a fake Resend client. Sends no email.
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import type { AddressInfo } from 'node:net';
import type { Server } from 'node:http';
import express from 'express';

const dbPath = path.join(os.tmpdir(), `pt-invoices-${process.pid}-${Date.now()}.db`);
process.env.DATABASE_PATH = dbPath;
delete process.env.PUBLIC_URL;
delete process.env.RESEND_API_KEY;
delete process.env.INVOICE_EMAIL_FROM;
process.env.INVOICE_SEND_HOURLY_LIMIT = '3';
for (const suffix of ['', '.tmp', '-wal', '-shm']) {
  const p = `${dbPath}${suffix}`;
  if (fs.existsSync(p)) fs.unlinkSync(p);
}

function assert(cond: unknown, msg: string): void {
  if (!cond) throw new Error(`FAIL: ${msg}`);
}

function eq(actual: unknown, expected: number, msg: string): void {
  if (typeof actual !== 'number' || Math.abs(actual - expected) > 0.005) {
    throw new Error(`FAIL: ${msg} (got ${String(actual)}, expected ${expected})`);
  }
}

const { getDb, queryOne, queryAll, run } = await import('../db/index.ts');
const { deleteScopedDataForUser, SCOPED_TABLES } = await import('../lib/userScope.ts');
const { createSession, SESSION_COOKIE } = await import('../auth/sessions.ts');
const { attachUser, requireAuth, isPublicApiPath } = await import('../middleware/requireAuth.ts');
const { homeMonthSnapshot } = await import('../budget/homeSnapshot.ts');
const { aucklandToday } = await import('../debts/model.ts');
const { linkInvoicePaymentsToBankCredits } = await import('./store.ts');
const { setEmailFetchForTest } = await import('./email.ts');
const { default: invoicesRouter } = await import('../routes/invoices.ts');
const { default: publicInvoicesRouter } = await import('../routes/publicInvoices.ts');

const userA = 'inv_user_a';
const userB = 'inv_user_b';
const now = '2026-10-05T00:00:00.000Z';
const today = aucklandToday();

const db = await getDb();
for (const t of ['invoices', 'invoice_lines', 'invoice_clients', 'invoice_payments', 'invoice_sends', 'business_profiles']) {
  assert(queryOne(db, `SELECT name FROM sqlite_master WHERE type='table' AND name=?`, [t]), `schema creates ${t}`);
  assert((SCOPED_TABLES as readonly string[]).includes(t), `${t} is user-scoped`);
}
for (const [id, email] of [[userA, 'a@example.com'], [userB, 'b@example.com']]) {
  run(db, `INSERT INTO users (id, email, password_hash, created_at, updated_at) VALUES (?,?,?,?,?)`, [id, email, 'hash', now, now]);
}

const app = express();
app.set('trust proxy', false);
app.use(express.json());
app.use('/api', attachUser);
app.use('/api', (req, res, next) => (isPublicApiPath(req.path) ? next() : requireAuth(req, res, next)));
app.use('/api/invoices', invoicesRouter);
app.use('/api/public', publicInvoicesRouter);
const server: Server = await new Promise((resolve) => {
  const s = app.listen(0, '127.0.0.1', () => resolve(s));
});
const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;

type Json = Record<string, any>;
async function call(method: string, p: string, cookie?: string, body?: unknown): Promise<{ status: number; json: Json; text: string; headers: Headers }> {
  const headers: Record<string, string> = { Accept: 'application/json' };
  if (body !== undefined) headers['Content-Type'] = 'application/json';
  if (cookie) headers.Cookie = cookie;
  const res = await fetch(`${base}${p}`, { method, headers, body: body !== undefined ? JSON.stringify(body) : undefined });
  const buf = Buffer.from(await res.arrayBuffer());
  const text = buf.toString('utf8');
  let json: Json = {};
  try {
    json = JSON.parse(text) as Json;
  } catch {
    json = {};
  }
  return { status: res.status, json, text, headers: res.headers };
}

try {
  const A = `${SESSION_COOKIE}=${(await createSession(userA)).rawToken}`;
  const B = `${SESSION_COOKIE}=${(await createSession(userB)).rawToken}`;

  assert((await call('GET', '/api/invoices')).status === 401, 'signed out is 401');

  // Business details: starts from the account email; GST number required when registered.
  const bizDefault = await call('GET', '/api/invoices/business', A);
  assert(bizDefault.json.email === 'a@example.com', 'business email defaults to account email');
  const badGst = await call('PUT', '/api/invoices/business', A, { businessName: 'Hana Contracting', gstRegistered: true, gstNumber: 'abc' });
  assert(badGst.status === 400, 'GST number validated');
  const biz = await call('PUT', '/api/invoices/business', A, {
    businessName: 'Hana Contracting', address: '1 Kōwhai St\nWhakatāne', email: 'hana@example.co.nz',
    bankAccount: '12-3456-7890123-00', gstRegistered: true, gstNumber: '123-456-789',
  });
  assert(biz.status === 200 && biz.json.gstRegistered === true, 'business saved');

  // A registered business can leave GST off, and an inclusive draft stays inclusive.
  const gstOff = await call('POST', '/api/invoices', A, {
    clientName: 'Exempt Client', issueDate: '2026-10-01', duePreset: 'days_7', gstMode: 'none',
    lines: [{ description: 'Exempt supply', quantity: 1, unit: 'hour', rate: 40 }],
  });
  assert(gstOff.status === 201, `GST-off draft created (${gstOff.status} ${gstOff.text})`);
  assert(gstOff.json.gstMode === 'none', 'registered business can leave GST off');
  assert(gstOff.json.title === 'Invoice', 'GST off is not titled Tax invoice');
  eq(gstOff.json.gstNzd, 0, 'GST off stores no GST');
  eq(gstOff.json.subtotalNzd, 40, 'GST off subtotal');
  eq(gstOff.json.amountDueNzd, 40, 'GST off amount due');
  const gstIncl = await call('POST', '/api/invoices', A, {
    clientName: 'Incl Client', issueDate: '2026-10-01', gstMode: 'inclusive',
    lines: [{ description: 'Inclusive', quantity: 1, unit: 'hour', rate: 115 }],
  });
  assert(gstIncl.status === 201 && gstIncl.json.gstMode === 'inclusive', 'inclusive draft is preserved');
  eq(gstIncl.json.gstNzd, 15, 'inclusive GST is backed out');
  assert((await call('DELETE', `/api/invoices/${gstOff.json.id}`, A)).status === 200, 'GST-off draft removed');
  assert((await call('DELETE', `/api/invoices/${gstIncl.json.id}`, A)).status === 200, 'inclusive draft removed');

  // Clients.
  const client = await call('POST', '/api/invoices/clients', A, { name: 'Mātai Orchards', email: 'accounts@matai.nz', address: '1 Orchard Rd' });
  assert(client.status === 201, 'client created');
  const clientId = client.json.id as string;
  assert((await call('GET', '/api/invoices/clients', B)).json.length === 0, 'user B sees no clients');
  assert((await call('PUT', `/api/invoices/clients/${clientId}`, B, { name: 'Stolen' })).status === 404, 'user B cannot edit client');
  assert((await call('POST', '/api/invoices', B, { clientId, lines: [] })).status === 400, 'user B cannot use A’s client');

  // Numbering: sequential, unique, editable.
  const draft = {
    clientId, clientName: 'Mātai Orchards', clientEmail: 'accounts@matai.nz', clientAddress: '1 Orchard Rd',
    issueDate: '2026-09-01', duePreset: 'days_14', gstMode: 'exclusive', withholdingRatePct: 15,
    lines: [{ description: 'Bins picked', quantity: 20, unit: 'bin', rate: 45 }, { description: '', quantity: 0, rate: 0 }],
  };
  const inv1 = await call('POST', '/api/invoices', A, draft);
  assert(inv1.status === 201, `create invoice (got ${inv1.status} ${inv1.text})`);
  assert(inv1.json.number === 'INV-0001', 'first number');
  assert(inv1.json.lines.length === 1, 'blank line dropped');
  eq(inv1.json.subtotalNzd, 900, 'subtotal');
  eq(inv1.json.gstNzd, 135, 'GST');
  eq(inv1.json.totalNzd, 1035, 'total');
  eq(inv1.json.withholdingNzd, 135, 'withholding on GST-exclusive');
  eq(inv1.json.amountDueNzd, 900, 'amount due');
  assert(inv1.json.title === 'Tax invoice', 'GST registered → tax invoice');
  assert(inv1.json.dueDate === '2026-09-15', '14-day due date');
  assert(inv1.json.status === 'draft', 'starts as draft');
  const id1 = inv1.json.id as string;

  const inv2 = await call('POST', '/api/invoices', A, { ...draft, issueDate: today, lines: [{ description: 'Pruning', quantity: 10, unit: 'hour', rate: 50 }] });
  assert(inv2.json.number === 'INV-0002', 'sequential number');
  const dupNumber = await call('POST', '/api/invoices', A, { ...draft, number: 'inv-0002' });
  assert(dupNumber.status === 409, 'duplicate number refused (case-insensitive)');
  const custom = await call('POST', '/api/invoices', A, { ...draft, number: 'INV-0010' });
  assert(custom.json.number === 'INV-0010', 'editable number');
  const after = await call('POST', '/api/invoices', A, { ...draft, lines: [] });
  assert(after.json.number === 'INV-0011', 'sequence continues after the highest');
  const invB = await call('POST', '/api/invoices', B, { clientName: 'X', lines: [{ description: 'y', quantity: 1, rate: 1 }] });
  assert(invB.json.number === 'INV-0001', 'numbering is per user');

  // Cross-user access refused everywhere.
  for (const [m, p, body] of [
    ['GET', `/api/invoices/${id1}`, undefined],
    ['PUT', `/api/invoices/${id1}`, draft],
    ['DELETE', `/api/invoices/${id1}`, undefined],
    ['GET', `/api/invoices/${id1}/pdf`, undefined],
    ['POST', `/api/invoices/${id1}/mark-sent`, undefined],
    ['POST', `/api/invoices/${id1}/void`, undefined],
    ['POST', `/api/invoices/${id1}/duplicate`, undefined],
    ['POST', `/api/invoices/${id1}/share`, undefined],
    ['POST', `/api/invoices/${id1}/payments`, { amountNzd: 1 }],
    ['GET', `/api/invoices/${id1}/email-draft`, undefined],
  ] as const) {
    const r = await call(m, p, B, body);
    assert(r.status === 404, `user B ${m} ${p} → 404 (got ${r.status})`);
  }
  const listB = await call('GET', '/api/invoices', B);
  assert(listB.json.invoices.length === 1, 'user B lists only their own invoice');

  // Drafts edit and delete; payments need a sent invoice.
  const edited = await call('PUT', `/api/invoices/${id1}`, A, { ...draft, notes: 'Thanks!' });
  assert(edited.status === 200 && edited.json.notes === 'Thanks!', 'draft editable');
  assert((await call('POST', `/api/invoices/${id1}/payments`, A, { amountNzd: 100 })).status === 409, 'no payment on a draft');
  assert((await call('POST', `/api/invoices/${id1}/void`, A)).status === 409, 'drafts are deleted, not voided');

  // Mark sent → read-only, cannot delete.
  const sent = await call('POST', `/api/invoices/${id1}/mark-sent`, A);
  assert(sent.json.storedStatus === 'sent', 'marked sent');
  assert(sent.json.status === 'overdue', 'due 15 Sep 2026 has passed → overdue');
  assert((await call('PUT', `/api/invoices/${id1}`, A, draft)).status === 409, 'sent invoice is read-only');
  assert((await call('DELETE', `/api/invoices/${id1}`, A)).status === 409, 'sent invoice cannot be deleted');
  await run(db, `UPDATE business_profiles SET business_name = 'Renamed Ltd' WHERE user_id = ?`, [userA]);
  const frozen = await call('GET', `/api/invoices/${id1}`, A);
  assert(frozen.json.business.businessName === 'Hana Contracting', 'sent invoice keeps business details from when it was sent');
  await run(db, `UPDATE business_profiles SET business_name = 'Hana Contracting' WHERE user_id = ?`, [userA]);

  // Partial payment → income; bank deposit dedupe; full payment → paid.
  const tooMuch = await call('POST', `/api/invoices/${id1}/payments`, A, { amountNzd: 901 });
  assert(tooMuch.status === 400, 'cannot pay more than the balance');
  const part = await call('POST', `/api/invoices/${id1}/payments`, A, { date: today, amountNzd: 400, method: 'Bank transfer' });
  assert(part.status === 201, 'partial payment recorded');
  eq(part.json.paidNzd, 400, 'paid so far');
  eq(part.json.balanceNzd, 500, 'balance');
  assert(part.json.status === 'overdue', 'part paid and late is still overdue');
  const income = queryAll<{ id: string; amount_nzd: number; transaction_id: string | null }>(
    db, `SELECT id, amount_nzd, transaction_id FROM income_records WHERE user_id = ? AND invoice_payment_id IS NOT NULL`, [userA],
  );
  assert(income.length === 1 && income[0].amount_nzd === 400, 'payment added to income');
  const month = today.slice(0, 7);
  eq(homeMonthSnapshot(db, userA, month)?.incomeNzd, 400, 'home snapshot counts the payment');

  // The same money arrives by bank sync as an income-category credit: linked, not double counted.
  const incomeCat = queryOne<{ id: string }>(db, `SELECT id FROM budget_categories WHERE user_id = ? AND type = 'income' ORDER BY sort_order LIMIT 1`, [userA]);
  run(
    db,
    `INSERT INTO transactions (id, user_id, date, description, amount, kind, category_id, currency, created_at, source)
     VALUES ('txn_dep_1', ?, ?, 'MATAI ORCHARDS', 400, 'credit', ?, 'NZD', ?, 'akahu')`,
    [userA, today, incomeCat?.id ?? null, now],
  );
  assert(linkInvoicePaymentsToBankCredits(db, userA) === 1, 'deposit linked to the invoice payment');
  eq(homeMonthSnapshot(db, userA, month)?.incomeNzd, 400, 'deposit not counted twice');

  const full = await call('POST', `/api/invoices/${id1}/payments`, A, { date: today, amountNzd: 500, addToIncome: false });
  assert(full.json.status === 'paid', 'fully paid');
  eq(full.json.balanceNzd, 0, 'nothing owed');
  assert(queryAll(db, `SELECT id FROM income_records WHERE user_id = ? AND invoice_payment_id IS NOT NULL`, [userA]).length === 1, 'addToIncome false adds no income row');
  assert((await call('POST', `/api/invoices/${id1}/void`, A)).status === 409, 'cannot void with payments');

  const firstPaymentId = part.json.payments[0].id as string;
  assert((await call('DELETE', `/api/invoices/${id1}/payments/${firstPaymentId}`, B)).status === 404, 'user B cannot remove A’s payment');
  const removed = await call('DELETE', `/api/invoices/${id1}/payments/${firstPaymentId}`, A);
  assert(removed.json.status === 'overdue', 'removing a payment reopens the balance');
  assert(queryAll(db, `SELECT id FROM income_records WHERE user_id = ? AND invoice_payment_id IS NOT NULL`, [userA]).length === 0, 'its income row is removed');

  // Totals.
  const list = await call('GET', '/api/invoices', A);
  eq(list.json.totals.outstandingNzd, 400, 'outstanding = balance on sent invoices');
  eq(list.json.totals.overdueNzd, 400, 'overdue');
  eq(list.json.totals.paidThisMonthNzd, 500, 'paid this month');
  assert(list.json.nextNumber === 'INV-0012', 'next number suggestion');
  assert(list.json.emailEnabled === false, 'email off without env');
  const filtered = await call('GET', '/api/invoices?status=draft', A);
  assert(filtered.json.invoices.every((i: Json) => i.status === 'draft') && filtered.json.invoices.length === 3, 'status filter');
  assert((await call('GET', '/api/invoices?status=bogus', A)).status === 400, 'unknown status filter rejected');

  // Void a sent invoice with no payments; delete a draft.
  const id2 = inv2.json.id as string;
  await call('POST', `/api/invoices/${id2}/mark-sent`, A);
  const voided = await call('POST', `/api/invoices/${id2}/void`, A);
  assert(voided.json.status === 'void', 'voided');
  assert((await call('DELETE', `/api/invoices/${id1}`, A)).status === 409, 'sent invoices still can’t be deleted');
  assert((await call('DELETE', `/api/invoices/${id2}`, B)).status === 404, 'user B cannot delete A’s void invoice');
  assert((await call('DELETE', `/api/invoices/${id2}`, A)).status === 200, 'void invoice deleted');
  assert((await call('GET', `/api/invoices/${id2}`, A)).status === 404, 'and gone');
  eq(voided.json.balanceNzd, 0, 'void owes nothing');
  assert((await call('DELETE', `/api/invoices/${custom.json.id}`, A)).status === 200, 'draft deleted');

  // Duplicate.
  const dup = await call('POST', `/api/invoices/${id1}/duplicate`, A);
  assert(dup.status === 201 && dup.json.status === 'draft' && dup.json.issueDate === today, 'duplicate is a new draft dated today');
  assert(dup.json.lines.length === 1 && dup.json.number !== inv1.json.number, 'duplicate copies lines with a new number');

  // Share link: public, read-only, revocable.
  const shared = await call('POST', `/api/invoices/${id1}/share`, A);
  const url = shared.json.shareUrl as string;
  const token = url.split('/i/')[1];
  assert(/^[A-Za-z0-9_-]{32}$/.test(token), 'unguessable 192-bit token');
  const pub = await call('GET', `/api/public/invoices/${token}`);
  assert(pub.status === 200 && pub.json.number === 'INV-0001', 'share link works signed out');
  for (const hidden of ['id', 'payments', 'sends', 'clientId', 'shareUrl', 'storedStatus']) {
    assert(!(hidden in pub.json), `public view hides ${hidden}`);
  }
  const pubPdf = await call('GET', `/api/public/invoices/${token}/pdf`);
  assert(pubPdf.status === 200 && pubPdf.text.startsWith('%PDF'), 'public PDF');
  const again = await call('POST', `/api/invoices/${id1}/share`, A);
  assert(again.json.shareUrl === url, 'same link until revoked');
  await call('DELETE', `/api/invoices/${id1}/share`, A);
  assert((await call('GET', `/api/public/invoices/${token}`)).status === 404, 'revoked link is gone');
  assert((await call('GET', '/api/public/invoices/not-a-token')).status === 404, 'junk token 404');
  const fresh = await call('POST', `/api/invoices/${id1}/share`, A);
  assert(fresh.json.shareUrl !== url, 'new link has a new token');

  // PDF download.
  const pdf = await call('GET', `/api/invoices/${id1}/pdf`, A);
  assert(pdf.status === 200 && pdf.text.startsWith('%PDF'), 'PDF download');
  assert((pdf.headers.get('content-disposition') ?? '').includes('Tax-invoice-INV-0001.pdf'), 'PDF filename');

  // Sending: off without env; needs confirm; rate limited; logged.
  const id3 = after.json.id as string; // INV-0011, no lines yet
  const noEmail = await call('POST', `/api/invoices/${id1}/send`, A, { to: ['x@example.com'], subject: 's', confirm: true });
  assert(noEmail.status === 503, 'send is off without RESEND_API_KEY');

  process.env.RESEND_API_KEY = 're_test';
  process.env.INVOICE_EMAIL_FROM = 'invoices@mail.example.nz';
  const sentMail: Json[] = [];
  setEmailFetchForTest(async (_url, init) => {
    sentMail.push({ headers: init.headers, body: JSON.parse(init.body) });
    return { ok: true, status: 200, json: async () => ({ id: `re_${sentMail.length}` }) };
  });

  const emailDraft = await call('GET', `/api/invoices/${dup.json.id}/email-draft`, A);
  assert(emailDraft.json.to[0] === 'accounts@matai.nz' && emailDraft.json.subject.includes(dup.json.number), 'email draft prefilled');
  const noConfirm = await call('POST', `/api/invoices/${dup.json.id}/send`, A, { to: ['accounts@matai.nz'], subject: 'Invoice' });
  assert(noConfirm.status === 400 && sentMail.length === 0, 'nothing sends without confirm');
  const badTo = await call('POST', `/api/invoices/${dup.json.id}/send`, A, { to: ['nope'], subject: 'Invoice', confirm: true });
  assert(badTo.status === 400 && sentMail.length === 0, 'invalid recipient refused');
  const emptyInv = await call('POST', `/api/invoices/${id3}/send`, A, { to: ['a@b.co'], subject: 'x', confirm: true });
  assert(emptyInv.status === 400 && /line/.test(emptyInv.json.error), 'invoice with no lines cannot send');

  const ok = await call('POST', `/api/invoices/${dup.json.id}/send`, A, {
    to: ['accounts@matai.nz', 'boss@matai.nz'], subject: 'Tax invoice', message: 'Kia ora', includeLink: true, confirm: true,
  });
  assert(ok.status === 200 && ok.json.storedStatus === 'sent', `send marks the invoice sent (got ${ok.status} ${ok.text})`);
  const mail = sentMail[0];
  assert(mail.headers.Authorization === 'Bearer re_test', 'Resend auth header');
  assert(mail.body.from === 'Hana Contracting <invoices@mail.example.nz>', 'from app domain with business name');
  assert(mail.body.reply_to === 'hana@example.co.nz', 'reply-to is the user');
  assert(mail.body.to.length === 2, 'two recipients');
  assert(mail.body.attachments[0].filename.endsWith('.pdf'), 'PDF attached');
  assert(Buffer.from(mail.body.attachments[0].content, 'base64').subarray(0, 4).toString() === '%PDF', 'attachment is a PDF');
  assert(String(mail.body.text).includes('/i/'), 'share link included when asked');
  assert(ok.json.sends.length === 1 && ok.json.sends[0].recipients.length === 2, 'send logged with recipients');

  const reminder = await call('POST', `/api/invoices/${id1}/send`, A, { kind: 'reminder', to: ['accounts@matai.nz'], subject: 'Reminder', confirm: true });
  assert(reminder.status === 200 && reminder.json.sends[0].kind === 'reminder', 'reminder sent and logged');
  const voidSend = await call('POST', `/api/invoices/${id2}/send`, A, { to: ['a@b.co'], subject: 'x', confirm: true });
  assert(voidSend.status === 404, 'a deleted void invoice cannot be sent');

  // Hourly limit is 3 in this test: two sends so far + this one = 3; the 4th is refused.
  await call('POST', `/api/invoices/${id1}/send`, A, { kind: 'reminder', to: ['accounts@matai.nz'], subject: 'Reminder 2', confirm: true });
  const limited = await call('POST', `/api/invoices/${id1}/send`, A, { kind: 'reminder', to: ['accounts@matai.nz'], subject: 'Reminder 3', confirm: true });
  assert(limited.status === 429 && sentMail.length === 3, 'send rate limit');

  // Sent from the user's own email app / share sheet: logged, marks sent, not rate limited.
  const manual = await call('POST', '/api/invoices', A, { ...draft, issueDate: today, lines: [{ description: 'Mowing', quantity: 1, unit: 'job', rate: 80 }] });
  const badChannel = await call('POST', `/api/invoices/${manual.json.id}/record-send`, A, { channel: 'fax' });
  assert(badChannel.status === 400, 'unknown channel refused');
  assert((await call('POST', `/api/invoices/${manual.json.id}/record-send`, B, { channel: 'email_app' })).status === 404, 'user B cannot record A’s send');
  const viaApp = await call('POST', `/api/invoices/${manual.json.id}/record-send`, A, {
    channel: 'email_app', to: ['accounts@matai.nz'], subject: 'Tax invoice',
  });
  assert(viaApp.status === 200 && viaApp.json.storedStatus === 'sent', 'email-app send marks sent even while app sending is rate limited');
  assert(viaApp.json.sends[0].channel === 'email_app' && viaApp.json.sends[0].recipients[0] === 'accounts@matai.nz', 'email-app send logged');
  const viaShare = await call('POST', `/api/invoices/${manual.json.id}/record-send`, A, { kind: 'reminder', channel: 'share' });
  assert(viaShare.status === 200 && viaShare.json.sends[0].channel === 'share', 'share-sheet reminder logged');
  assert(sentMail.length === 3, 'recording a manual send emails nothing');
  const noLines = await call('POST', `/api/invoices/${id3}/record-send`, A, { channel: 'share' });
  assert(noLines.status === 400, 'manual send still needs a complete invoice');

  // Failures are logged and count toward the limit.
  setEmailFetchForTest(async () => ({ ok: false, status: 422, json: async () => ({ message: 'Invalid domain' }) }));
  const bSend = await call('POST', `/api/invoices/${invB.json.id}/send`, B, { to: ['x@example.com'], subject: 'x', confirm: true });
  assert(bSend.status === 400, 'user B blocked until business name is set');
  await call('PUT', '/api/invoices/business', B, { businessName: 'B Ltd' });
  const failed = await call('POST', `/api/invoices/${invB.json.id}/send`, B, { to: ['x@example.com'], subject: 'x', confirm: true });
  assert(failed.status === 502 && failed.json.error.includes('Invalid domain'), 'provider error surfaced');
  const bInv = await call('GET', `/api/invoices/${invB.json.id}`, B);
  assert(bInv.json.storedStatus === 'draft' && bInv.json.sends[0].status === 'failed', 'failed send logged, invoice stays draft');
  setEmailFetchForTest(null);

  // CSV export, with formula cells neutralised.
  await call('POST', '/api/invoices', A, { clientName: '=HYPERLINK("x")', lines: [{ description: 'a', quantity: 1, rate: 1 }] });
  const csv = await call('GET', '/api/invoices/export.csv', A);
  assert(csv.status === 200 && csv.text.includes('Number,Status,Issue date'), 'CSV header');
  assert(csv.text.includes('INV-0001,overdue'), 'CSV row with status');
  assert(csv.text.includes(`"'=HYPERLINK(""x"")"`), 'formula neutralised');
  assert(!csv.text.includes('B Ltd'), 'CSV has only this user’s invoices');

  // Account delete removes everything invoice-related for that user only.
  const wiped = deleteScopedDataForUser(db, userA);
  assert(wiped.tables.invoices > 0 && wiped.tables.invoice_payments >= 0, 'invoices removed with the account');
  assert(queryAll(db, `SELECT id FROM invoices WHERE user_id = ?`, [userA]).length === 0, 'none left for A');
  assert(queryAll(db, `SELECT id FROM invoices WHERE user_id = ?`, [userB]).length === 1, 'B untouched');

  console.log('invoice store tests passed');
} finally {
  await new Promise<void>((resolve, reject) => server.close((err) => (err ? reject(err) : resolve())));
  for (const suffix of ['', '.tmp', '-wal', '-shm']) {
    const p = `${dbPath}${suffix}`;
    if (fs.existsSync(p)) fs.unlinkSync(p);
  }
}
