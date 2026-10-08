/**
 * Invoice PDF (KAN-71). Same document for Download PDF, email attachments and share links.
 * A4, DejaVu Sans embedded (subset) so macrons and other non-Latin-1 text print correctly.
 * Font licence: server/invoices/fonts/LICENSE-DejaVu.txt.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import fontkit from '@pdf-lib/fontkit';
import { PDFDocument, rgb, type PDFFont, type PDFPage } from 'pdf-lib';
import { INVOICE_STATUS_LABELS } from '../../src/lib/invoiceCalc.ts';
import type { PublicInvoice } from '../../src/types/index.ts';

const FONT_DIR = path.join(path.dirname(fileURLToPath(import.meta.url)), 'fonts');
let fontBytes: { regular: Buffer; bold: Buffer } | null = null;

function fonts(): { regular: Buffer; bold: Buffer } {
  fontBytes ??= {
    regular: fs.readFileSync(path.join(FONT_DIR, 'DejaVuSans.ttf')),
    bold: fs.readFileSync(path.join(FONT_DIR, 'DejaVuSans-Bold.ttf')),
  };
  return fontBytes;
}

const A4 = { w: 595.28, h: 841.89 };
const MARGIN = 48;
const INK = rgb(0.12, 0.12, 0.12);
const MUTED = rgb(0.42, 0.42, 0.42);
const RULE = rgb(0.82, 0.82, 0.82);

export function formatMoney(n: number): string {
  return new Intl.NumberFormat('en-NZ', { style: 'currency', currency: 'NZD' }).format(n);
}

export function formatDate(ymd: string): string {
  const d = new Date(`${ymd}T00:00:00Z`);
  if (Number.isNaN(d.getTime())) return ymd;
  return new Intl.DateTimeFormat('en-NZ', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' }).format(d);
}

function formatQty(n: number): string {
  return Number.isInteger(n) ? String(n) : String(Math.round(n * 10000) / 10000);
}

/** Split text into lines no wider than maxWidth, keeping explicit line breaks. */
export function wrap(text: string, font: PDFFont, size: number, maxWidth: number): string[] {
  const out: string[] = [];
  for (const para of text.split('\n')) {
    const words = para.split(/\s+/).filter(Boolean);
    if (words.length === 0) {
      out.push('');
      continue;
    }
    let line = '';
    for (const word of words) {
      const next = line ? `${line} ${word}` : word;
      if (font.widthOfTextAtSize(next, size) <= maxWidth) {
        line = next;
        continue;
      }
      if (line) out.push(line);
      // A single word wider than the column is broken by characters.
      let rest = word;
      while (font.widthOfTextAtSize(rest, size) > maxWidth && rest.length > 1) {
        let cut = rest.length - 1;
        while (cut > 1 && font.widthOfTextAtSize(rest.slice(0, cut), size) > maxWidth) cut -= 1;
        out.push(rest.slice(0, cut));
        rest = rest.slice(cut);
      }
      line = rest;
    }
    out.push(line);
  }
  return out;
}

export async function renderInvoicePdf(inv: PublicInvoice): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  doc.registerFontkit(fontkit);
  const f = fonts();
  const regular = await doc.embedFont(f.regular, { subset: true });
  const bold = await doc.embedFont(f.bold, { subset: true });
  doc.setTitle(`${inv.title} ${inv.number}`);
  doc.setAuthor(inv.business.businessName || 'Invoice');
  doc.setProducer('Koru Finance Tracker');
  doc.setCreator('Koru Finance Tracker');

  const pages: PDFPage[] = [];
  let page = doc.addPage([A4.w, A4.h]);
  pages.push(page);
  let y = A4.h - MARGIN;
  const right = A4.w - MARGIN;
  const width = right - MARGIN;

  const text = (s: string, x: number, size = 10, font = regular, color = INK) =>
    page.drawText(s, { x, y, size, font, color });
  const textRight = (s: string, xRight: number, size = 10, font = regular, color = INK) =>
    page.drawText(s, { x: xRight - font.widthOfTextAtSize(s, size), y, size, font, color });
  const newPage = () => {
    page = doc.addPage([A4.w, A4.h]);
    pages.push(page);
    y = A4.h - MARGIN;
  };
  const ensure = (needed: number) => {
    if (y - needed < MARGIN + 24) newPage();
  };

  // Header: title + number on the left, business details on the right.
  const headerTop = y;
  text(inv.title, MARGIN, 22, bold);
  y -= 22;
  text(inv.number, MARGIN, 12, regular, MUTED);
  if (inv.status === 'void') {
    y -= 18;
    text('VOID', MARGIN, 14, bold, rgb(0.7, 0.1, 0.1));
  }
  const leftBottom = y;

  y = headerTop;
  const biz = inv.business;
  const bizLines: Array<[string, PDFFont, number]> = [];
  if (biz.businessName) bizLines.push([biz.businessName, bold, 11]);
  for (const l of wrap(biz.address, regular, 9, 220)) if (l) bizLines.push([l, regular, 9]);
  if (biz.email) bizLines.push([biz.email, regular, 9]);
  if (biz.phone) bizLines.push([biz.phone, regular, 9]);
  if (biz.gstRegistered && biz.gstNumber) bizLines.push([`GST No. ${biz.gstNumber}`, regular, 9]);
  if (biz.nzbn) bizLines.push([`NZBN ${biz.nzbn}`, regular, 9]);
  for (const [l, font, size] of bizLines) {
    textRight(l, right, size, font);
    y -= size + 4;
  }
  y = Math.min(y, leftBottom) - 22;

  // Bill to + invoice details.
  const blockTop = y;
  text('Bill to', MARGIN, 9, bold, MUTED);
  y -= 14;
  text(inv.clientName || '—', MARGIN, 11, bold);
  y -= 14;
  for (const l of wrap(inv.clientAddress, regular, 9, 250)) {
    if (!l) continue;
    text(l, MARGIN, 9);
    y -= 12;
  }
  if (inv.clientEmail) {
    text(inv.clientEmail, MARGIN, 9);
    y -= 12;
  }
  if (inv.clientReference) {
    text(`Ref: ${inv.clientReference}`, MARGIN, 9, regular, MUTED);
    y -= 12;
  }
  const billBottom = y;

  y = blockTop;
  const meta: Array<[string, string]> = [
    ['Invoice number', inv.number],
    ['Issue date', formatDate(inv.issueDate)],
    ['Due date', inv.dueDate === inv.issueDate ? 'On receipt' : formatDate(inv.dueDate)],
  ];
  if (inv.reference) meta.push(['Reference / PO', inv.reference]);
  for (const [k, v] of meta) {
    textRight(v, right, 10, bold);
    textRight(k, right - 130, 9, regular, MUTED);
    y -= 15;
  }
  y = Math.min(y, billBottom) - 20;

  // Line items.
  const col = {
    desc: MARGIN,
    qty: MARGIN + width * 0.56,
    unit: MARGIN + width * 0.58,
    rate: MARGIN + width * 0.84,
    amount: right,
  };
  const descWidth = width * 0.5;
  const tableHeader = () => {
    text('Description', col.desc, 9, bold, MUTED);
    textRight('Qty', col.qty, 9, bold, MUTED);
    text('Unit', col.unit, 9, bold, MUTED);
    textRight(inv.gstMode === 'inclusive' ? 'Rate (incl. GST)' : 'Rate', col.rate, 9, bold, MUTED);
    textRight('Amount', col.amount, 9, bold, MUTED);
    y -= 6;
    page.drawLine({ start: { x: MARGIN, y }, end: { x: right, y }, thickness: 0.75, color: RULE });
    y -= 14;
  };
  tableHeader();
  for (const line of inv.lines) {
    const descLines = wrap(line.description || '—', regular, 10, descWidth);
    ensure(descLines.length * 13 + 8);
    if (y > A4.h - MARGIN - 1) tableHeader();
    const rowTop = y;
    for (const l of descLines) {
      text(l, col.desc, 10);
      y -= 13;
    }
    const after = y;
    y = rowTop;
    textRight(formatQty(line.quantity), col.qty, 10);
    text(line.unit.slice(0, 18), col.unit, 10, regular, MUTED);
    textRight(formatMoney(line.rate), col.rate, 10);
    textRight(formatMoney(line.lineTotalNzd), col.amount, 10);
    y = after - 4;
    page.drawLine({ start: { x: MARGIN, y: y + 6 }, end: { x: right, y: y + 6 }, thickness: 0.4, color: RULE });
    y -= 6;
  }

  // Totals.
  const totals: Array<[string, string, boolean]> = [];
  if (inv.gstMode === 'none') {
    totals.push(['Total', formatMoney(inv.totalNzd), true]);
  } else {
    totals.push(['Subtotal (excl. GST)', formatMoney(inv.subtotalNzd), false]);
    totals.push(['GST 15%', formatMoney(inv.gstNzd), false]);
    totals.push(['Total (incl. GST)', formatMoney(inv.totalNzd), true]);
  }
  if (inv.withholdingNzd > 0) {
    totals.push([`Less withholding tax (${inv.withholdingRatePct}%)`, `−${formatMoney(inv.withholdingNzd)}`, false]);
    totals.push(['Amount due', formatMoney(inv.amountDueNzd), true]);
  }
  if (inv.paidNzd > 0) {
    totals.push(['Paid', `−${formatMoney(inv.paidNzd)}`, false]);
    totals.push(['Balance due', formatMoney(inv.balanceNzd), true]);
  }
  ensure(totals.length * 17 + 30);
  y -= 6;
  for (const [label, value, strong] of totals) {
    textRight(value, right, strong ? 11 : 10, strong ? bold : regular);
    textRight(label, right - 120, strong ? 10 : 9, strong ? bold : regular, strong ? INK : MUTED);
    y -= strong ? 18 : 15;
  }
  if (inv.withholdingNzd > 0) {
    for (const l of wrap('Withholding tax is on the GST-exclusive amount and is paid to Inland Revenue by the payer.', regular, 8, 300)) {
      textRight(l, right, 8, regular, MUTED);
      y -= 10;
    }
  }
  if (inv.gstMode === 'inclusive') {
    textRight('Prices include GST.', right, 8, regular, MUTED);
    y -= 10;
  }
  if (inv.status !== 'draft' && inv.status !== 'void') {
    y -= 2;
    textRight(`Status: ${INVOICE_STATUS_LABELS[inv.status]}`, right, 9, regular, MUTED);
    y -= 12;
  }

  // Payment details and notes.
  const section = (heading: string, body: string) => {
    const bodyLines = wrap(body, regular, 9.5, width);
    ensure(20 + Math.min(bodyLines.length, 6) * 12);
    y -= 14;
    text(heading, MARGIN, 9, bold, MUTED);
    y -= 14;
    for (const l of bodyLines) {
      ensure(12);
      text(l, MARGIN, 9.5);
      y -= 12;
    }
  };
  const payParts: string[] = [];
  if (biz.bankAccount) payParts.push(`Bank account: ${biz.bankAccount}`);
  payParts.push(`Please use ${inv.number} as the reference.`);
  if (inv.paymentInstructions) payParts.push(inv.paymentInstructions);
  section('How to pay', payParts.join('\n'));
  if (inv.notes) section('Notes', inv.notes);

  // Footer: page numbers.
  pages.forEach((p, i) => {
    const label = `${inv.number} · page ${i + 1} of ${pages.length}`;
    p.drawText(label, {
      x: A4.w - MARGIN - regular.widthOfTextAtSize(label, 8),
      y: MARGIN - 20,
      size: 8,
      font: regular,
      color: MUTED,
    });
  });

  return doc.save();
}

/** Safe download name, e.g. "Invoice-INV-0007.pdf". */
export function pdfFilename(inv: Pick<PublicInvoice, 'number' | 'title'>): string {
  const base = `${inv.title === 'Tax invoice' ? 'Tax-invoice' : 'Invoice'}-${inv.number}`.replace(/[^A-Za-z0-9._-]+/g, '-');
  return `${base.replace(/-+/g, '-').slice(0, 80)}.pdf`;
}
