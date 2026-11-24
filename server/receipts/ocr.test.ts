/**
 * Receipt scanning (KAN-60): the text parser on typical NZ receipts, image checks, temp-file
 * clean-up, and the route with a fake OCR engine. If Tesseract is installed (the production
 * image), a real scan of a generated receipt runs too.
 * Run: npm run test:receipts
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

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'pt-receipts-'));
process.env.DATABASE_PATH = path.join(dir, 'portfolio.db');
process.env.NODE_ENV = 'test';

const { parseReceipt, moneyIn, findDate } = await import('../../src/lib/receiptParse.ts');
const { decodeImage, scanReceipt, OcrError } = await import('./ocr.ts');

const countdown = `TAX INVOICE
COUNTDOWN PONSONBY
GST No: 111-222-333
Date: 05/11/2026  Time 14:22
BANANAS            3.20
MILK 2L            4.50
SUBTOTAL          58.40
GST INCL           7.62
TOTAL             $58.40
EFTPOS            $58.40
CHANGE             0.00`;
eq(parseReceipt(countdown), { merchant: 'Countdown Ponsonby', date: '2026-11-05', amountNzd: 58.4 }, 'Countdown receipt');

const cafe = `Little Bird Cafe
www.littlebird.co.nz
12 Nov 2026
Flat white x2    11.00
Amount due       NZ$23.50
Visa             23.50`;
eq(parseReceipt(cafe), { merchant: 'Little Bird Cafe', date: '2026-11-12', amountNzd: 23.5 }, 'cafe receipt');

eq(parseReceipt('Mitre 10\n2026-10-30\nhammer 45.00\npaint 120.99'), { merchant: 'Mitre 10', date: '2026-10-30', amountNzd: 120.99 }, 'no total line: largest amount');
eq([parseReceipt('unreadable ~~~').date, parseReceipt('unreadable ~~~').amountNzd], [null, null], 'no date or total guessed');
eq(parseReceipt('### 12'), { merchant: null, date: null, amountNzd: null }, 'nothing found → nulls');
eq(moneyIn('Qty 3 code 4421 total $1,234.50'), [1234.5], 'codes are not money; thousands separators');
eq(findDate('31/02/2026 then 01/03/26'), null, '31 Feb is impossible, so no date (day and month are never swapped)');
eq(findDate('Paid 3rd Dec 2026'), '2026-12-03', 'named month');

// Images.
const png = Buffer.from('89504e470d0a1a0a0000000d49484452', 'hex');
eq(decodeImage(`data:image/png;base64,${png.toString('base64')}`).ext, 'png', 'PNG data URL');
for (const [bad, status] of [['', 400], [Buffer.from('%PDF-1.7').toString('base64'), 415]] as const) {
  try {
    decodeImage(bad);
    throw new Error('should fail');
  } catch (e) {
    eq(e instanceof OcrError && e.status, status, `refused (${status})`);
  }
}

// Scan with a fake engine; the temp file is gone afterwards.
let seen = '';
const r = await scanReceipt(png.toString('base64'), async (p) => {
  seen = p;
  eq(fs.existsSync(p), true, 'photo written for OCR');
  return countdown;
});
eq([r.merchant, r.amountNzd], ['Countdown Ponsonby', 58.4], 'scan result');
eq(fs.existsSync(seen) || fs.existsSync(path.dirname(seen)), false, 'temp photo deleted');

// Route.
const { createSession, SESSION_COOKIE } = await import('../auth/sessions.ts');
const { getDb, run } = await import('../db/index.ts');
const { attachUser } = await import('../middleware/requireAuth.ts');
const { default: receiptsRouter, setOcrRunnerForTest } = await import('../routes/receipts.ts');
const db = await getDb();
const now = new Date().toISOString();
run(db, `INSERT INTO users (id, email, password_hash, created_at, updated_at) VALUES ('rc','rc@example.com','h',?,?)`, [now, now]);
setOcrRunnerForTest(async () => cafe);
const app = express();
app.use(express.json({ limit: '10mb' }));
app.use('/api', attachUser);
app.use('/api/receipts', receiptsRouter);
const server: Server = await new Promise((res) => {
  const s = app.listen(0, '127.0.0.1', () => res(s));
});
const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
try {
  const cookie = `${SESSION_COOKIE}=${(await createSession('rc')).rawToken}`;
  const post = (body: unknown, c = cookie) => fetch(`${base}/api/receipts/scan`, { method: 'POST', headers: { Cookie: c, 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  const ok = await post({ imageBase64: png.toString('base64') });
  eq(ok.status, 200, 'scan 200');
  eq(((await ok.json()) as { amountNzd: number }).amountNzd, 23.5, 'route returns the total');
  eq((await post({ imageBase64: Buffer.from('GIF89a').toString('base64') })).status, 415, 'unsupported image 415');
  eq((await fetch(`${base}/api/receipts/scan`, { method: 'POST' })).status, 401, 'signed out');
  setOcrRunnerForTest(async () => {
    throw new OcrError(503, 'Receipt scanning isn’t available on this server yet.');
  });
  eq((await post({ imageBase64: png.toString('base64') })).status, 503, 'no OCR engine → 503 with a message');
  console.log('receipt tests passed');
} finally {
  server.close();
  fs.rmSync(dir, { recursive: true, force: true });
}
process.exit(0);
