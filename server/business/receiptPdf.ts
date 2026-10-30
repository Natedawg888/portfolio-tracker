/**
 * Receipt PDF for a sale (KAN-120): one A4 page per ~30 lines, from the business and client as
 * they were when the receipt was issued (the snapshot), and the sale's lines. Prices are what was
 * charged, GST-inclusive when the business was GST-registered. Shares fonts and layout constants
 * with the invoice PDF (server/invoices/pdf.ts).
 */
import fontkit from '@pdf-lib/fontkit';
import { PDFDocument, type PDFFont, type PDFPage } from 'pdf-lib';
import type { BusinessSale } from '../../src/types/index.ts';
import { A4, INK, MARGIN, MUTED, RULE, fonts, formatDate, formatMoney, wrap } from '../invoices/pdf.ts';
import type { ReceiptSnapshot } from './sales.ts';

function formatQty(n: number): string {
  return Number.isInteger(n) ? String(n) : n.toFixed(3).replace(/0+$/, '').replace(/\.$/, '');
}

export async function renderReceiptPdf(sale: BusinessSale, snap: ReceiptSnapshot): Promise<Uint8Array> {
  const number = sale.receipt?.kind === 'issued' ? sale.receipt.number : '';
  const biz = snap.business;
  const doc = await PDFDocument.create();
  doc.registerFontkit(fontkit);
  const f = fonts();
  const regular = await doc.embedFont(f.regular, { subset: true });
  const bold = await doc.embedFont(f.bold, { subset: true });
  doc.setTitle(`Receipt ${number}`);
  doc.setAuthor(biz.businessName || 'Receipt');
  doc.setProducer('Koru Finance Tracker');
  doc.setCreator('Koru Finance Tracker');

  const pages: PDFPage[] = [];
  let page = doc.addPage([A4.w, A4.h]);
  pages.push(page);
  let y = A4.h - MARGIN;
  const right = A4.w - MARGIN;
  const width = right - MARGIN;
  const text = (s: string, x: number, size = 10, font: PDFFont = regular, color = INK) => page.drawText(s, { x, y, size, font, color });
  const textRight = (s: string, xRight: number, size = 10, font: PDFFont = regular, color = INK) =>
    page.drawText(s, { x: xRight - font.widthOfTextAtSize(s, size), y, size, font, color });
  const ensure = (needed: number) => {
    if (y - needed < MARGIN + 24) {
      page = doc.addPage([A4.w, A4.h]);
      pages.push(page);
      y = A4.h - MARGIN;
    }
  };

  // Header: title and number on the left, business on the right.
  const headerTop = y;
  text('Receipt', MARGIN, 22, bold);
  y -= 22;
  text(number, MARGIN, 12, regular, MUTED);
  const leftBottom = y;
  y = headerTop;
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

  // Sold to + receipt details.
  const blockTop = y;
  if (snap.client) {
    text('Sold to', MARGIN, 9, bold, MUTED);
    y -= 14;
    text(snap.client.name || '—', MARGIN, 11, bold);
    y -= 14;
    for (const l of wrap(snap.client.address, regular, 9, 250)) {
      if (!l) continue;
      text(l, MARGIN, 9);
      y -= 12;
    }
    if (snap.client.email) {
      text(snap.client.email, MARGIN, 9);
      y -= 12;
    }
  }
  const soldBottom = y;
  y = blockTop;
  for (const [k, v] of [
    ['Receipt number', number],
    ['Date of sale', formatDate(sale.date)],
  ] as const) {
    textRight(v, right, 10, bold);
    textRight(k, right - 130, 9, regular, MUTED);
    y -= 15;
  }
  y = Math.min(y, soldBottom) - 20;

  // Lines.
  const col = { desc: MARGIN, qty: MARGIN + width * 0.56, unit: MARGIN + width * 0.58, rate: MARGIN + width * 0.84, amount: right };
  const header = () => {
    text('Item', col.desc, 9, bold, MUTED);
    textRight('Qty', col.qty, 9, bold, MUTED);
    text('Unit', col.unit, 9, bold, MUTED);
    textRight(biz.gstRegistered ? 'Price (incl. GST)' : 'Price', col.rate, 9, bold, MUTED);
    textRight('Amount', col.amount, 9, bold, MUTED);
    y -= 6;
    page.drawLine({ start: { x: MARGIN, y }, end: { x: right, y }, thickness: 0.75, color: RULE });
    y -= 14;
  };
  header();
  for (const line of sale.lines) {
    const desc = wrap(line.description || '—', regular, 10, width * 0.5);
    const before = pages.length;
    ensure(desc.length * 13 + 8);
    if (pages.length !== before) header();
    const top = y;
    for (const l of desc) {
      text(l, col.desc, 10);
      y -= 13;
    }
    const after = y;
    y = top;
    textRight(formatQty(line.quantity), col.qty, 10);
    text(line.unit.slice(0, 18), col.unit, 10, regular, MUTED);
    textRight(formatMoney(line.unitPriceNzd), col.rate, 10);
    textRight(formatMoney(line.totalNzd), col.amount, 10);
    y = after - 4;
    page.drawLine({ start: { x: MARGIN, y: y + 6 }, end: { x: right, y: y + 6 }, thickness: 0.4, color: RULE });
    y -= 6;
  }

  // Totals: GST is 3/23 of a GST-inclusive total.
  ensure(70);
  y -= 6;
  textRight(formatMoney(sale.totalNzd), right, 11, bold);
  textRight(biz.gstRegistered ? 'Total (incl. GST)' : 'Total', right - 120, 10, bold);
  y -= 18;
  if (biz.gstRegistered) {
    const gst = Math.round(((sale.totalNzd * 3) / 23) * 100) / 100;
    textRight(formatMoney(gst), right, 10);
    textRight('Includes GST 15%', right - 120, 9, regular, MUTED);
    y -= 15;
  }
  textRight('Paid in full. Thank you.', right, 9, regular, MUTED);
  y -= 14;

  if (sale.notes) {
    const body = wrap(sale.notes, regular, 9.5, width);
    ensure(20 + Math.min(body.length, 6) * 12);
    y -= 14;
    text('Notes', MARGIN, 9, bold, MUTED);
    y -= 14;
    for (const l of body) {
      ensure(12);
      text(l, MARGIN, 9.5);
      y -= 12;
    }
  }

  pages.forEach((p, i) => {
    const label = `${number} · page ${i + 1} of ${pages.length}`;
    p.drawText(label, { x: A4.w - MARGIN - regular.widthOfTextAtSize(label, 8), y: MARGIN - 20, size: 8, font: regular, color: MUTED });
  });
  return doc.save();
}

/** Safe download name, e.g. "Receipt-RCT-0007.pdf". */
export function receiptFilename(number: string): string {
  return `Receipt-${number}`.replace(/[^A-Za-z0-9._-]+/g, '-') + '.pdf';
}
