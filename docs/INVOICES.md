# Invoices (KAN-71)

Create, send and track invoices at **/invoices** (nav: **Invoices**). Business details live in **Settings → Business**.

## Sending

Every send is previewed first (recipients, subject, message). Nothing sends automatically.

| Way | What happens | Attachment |
| --- | --- | --- |
| **Open in my email app** | `mailto:` opens the user's own mail app with recipients, subject and message filled in, plus the invoice's read-only share link. | No (mailto can't attach files). The client opens the link or the user attaches the downloaded PDF. |
| **Share PDF…** | Device share sheet (Web Share API) with the PDF file: email, text, messaging apps. Shown only where the browser can share files (most phones). | Yes |
| **Send from the app** | Only when `RESEND_API_KEY` and `INVOICE_EMAIL_FROM` are set. Resend sends from the app's domain with the business name as the sender name and Reply-To set to the user's email. | Yes (PDF) |

After the first two, the app asks **Did you send it?** and only then marks the invoice sent and logs it (`invoice_sends.channel` = `email_app` or `share`). The per-user rate limit applies only to emails the app sends itself (`channel = resend`); failed attempts count.

Also: **Download PDF**, **Copy share link** (read-only `/i/<token>`, 192-bit random token, revocable, shows only what's printed on the invoice; rate-limited per client address).

## Rules

- Numbers: `<prefix>0001` upward per user, editable, unique (case-insensitive). The next number follows the highest used with the prefix.
- Statuses: Draft, Sent, Partly paid, Paid, Overdue (day after the due date with a balance), Void. Only drafts can be edited or deleted. Sent invoices can be voided (when no payments are recorded), never deleted. A sent invoice keeps the business details it was sent with.
- GST (registered businesses): 15%, prices entered excluding (GST added) or including (GST = total × 15/115). Titled **Tax invoice**.
- Withholding tax (schedular payments, KAN-70): on the GST-exclusive subtotal, shown as a deduction; amount due = total − withholding.
- Payments: partial payments allowed up to the balance. "Add to my income" creates an income record tagged to the payment (`income_records.invoice_payment_id`). Bank sync and CSV import link a matching deposit (same amount, within 10 days, not already linked) so it isn't counted twice.
- CSV export: `/api/invoices/export.csv` (spreadsheet formulas in text cells are neutralised).

## IRD taxable supply information

Checked against IRD's "How taxable supply information for GST works" (last updated 31 Mar 2026):

- $200 or less: seller name, date, description, amount.
- Over $200 to $1,000: plus seller GST number and either GST-exclusive amount + GST + GST-inclusive amount, or the inclusive amount with a GST-included statement.
- Over $1,000: plus the buyer's name and one identifier (address, phone, email, NZBN, trading name or website) when the buyer is GST registered.

Invoices always show seller name, GST number (when registered), dates, line descriptions and the exclusive / GST / inclusive breakdown. Sending a tax invoice over $1,000 requires the client's address or email.

## Files

| Path | Role |
| --- | --- |
| `src/lib/invoiceCalc.ts` | Totals, GST, withholding, due dates, status, numbering |
| `server/invoices/store.ts` | Per-user store, payments → income, bank link, share tokens, send log, CSV |
| `server/invoices/pdf.ts` | PDF (pdf-lib, embedded DejaVu Sans — licence in `server/invoices/fonts/`) |
| `server/invoices/email.ts` | Resend client and send limits |
| `server/routes/invoices.ts`, `server/routes/publicInvoices.ts` | API |
| `src/pages/Invoices.tsx`, `InvoiceEditor.tsx`, `InvoiceDetail.tsx`, `PublicInvoice.tsx` | UI |
| `src/components/BusinessDetailsPanel.tsx`, `InvoicePreview.tsx` | Settings tab, shared invoice layout |

Tests: `npm run test:invoices`.
