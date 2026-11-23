/**
 * Receipt OCR on the server (KAN-60). Runs the Tesseract OCR engine installed in the image
 * (Dockerfile: tesseract-ocr + English). Images never leave the server and aren't stored: the
 * photo is written to a private temp file, read, and deleted. Text → fields: src/lib/receiptParse.ts.
 */
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { randomBytes } from 'node:crypto';
import { parseReceipt, type ParsedReceipt } from '../../src/lib/receiptParse.ts';

export const MAX_RECEIPT_BYTES = 8 * 1024 * 1024;
const TIMEOUT_MS = 30_000;

export class OcrError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message);
  }
}

export type OcrRunner = (imagePath: string) => Promise<string>;

/** Default runner: `tesseract <image> stdout -l eng --psm 6`. */
export const tesseractRunner: OcrRunner = (imagePath) =>
  new Promise((resolve, reject) => {
    const child = spawn(process.env.TESSERACT_BIN || 'tesseract', [imagePath, 'stdout', '-l', 'eng', '--psm', '6'], { stdio: ['ignore', 'pipe', 'pipe'] });
    let out = '';
    child.stdout.on('data', (c: Buffer) => (out += c.toString('utf8')));
    child.stderr.on('data', () => {});
    const timer = setTimeout(() => child.kill('SIGKILL'), TIMEOUT_MS);
    child.on('error', (err: NodeJS.ErrnoException) => {
      clearTimeout(timer);
      reject(err.code === 'ENOENT' ? new OcrError(503, 'Receipt scanning isn’t available on this server yet.') : err);
    });
    child.on('close', (code) => {
      clearTimeout(timer);
      if (code === 0) resolve(out);
      else reject(new OcrError(422, 'Couldn’t read that receipt. Try a sharper, straighter photo.'));
    });
  });

/** Decode a data URL or base64 photo; JPEG, PNG, WebP, TIFF or BMP only. */
export function decodeImage(raw: unknown): { bytes: Buffer; ext: string } {
  if (typeof raw !== 'string' || !raw.trim()) throw new OcrError(400, 'Choose a photo of the receipt.');
  const m = /^data:([^;,]+);base64,(.*)$/s.exec(raw.trim());
  const bytes = Buffer.from(m ? m[2] : raw.trim(), 'base64');
  if (!bytes.length) throw new OcrError(400, 'That photo is empty.');
  if (bytes.length > MAX_RECEIPT_BYTES) throw new OcrError(413, 'That photo is over 8 MB. Try a smaller one.');
  const sig = bytes.subarray(0, 12);
  if (sig[0] === 0xff && sig[1] === 0xd8) return { bytes, ext: 'jpg' };
  if (sig.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) return { bytes, ext: 'png' };
  if (sig.subarray(0, 4).toString() === 'RIFF' && sig.subarray(8, 12).toString() === 'WEBP') return { bytes, ext: 'webp' };
  if (sig.subarray(0, 2).toString() === 'BM') return { bytes, ext: 'bmp' };
  if (sig.subarray(0, 4).equals(Buffer.from([0x49, 0x49, 0x2a, 0x00])) || sig.subarray(0, 4).equals(Buffer.from([0x4d, 0x4d, 0x00, 0x2a]))) return { bytes, ext: 'tif' };
  throw new OcrError(415, 'Use a JPEG or PNG photo. (iPhone HEIC photos: set the camera to “Most compatible”.)');
}

export async function scanReceipt(raw: unknown, runner: OcrRunner = tesseractRunner): Promise<ParsedReceipt & { text: string }> {
  const { bytes, ext } = decodeImage(raw);
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'koru-receipt-'));
  const file = path.join(dir, `${randomBytes(8).toString('hex')}.${ext}`);
  try {
    fs.writeFileSync(file, bytes, { mode: 0o600 });
    const text = await runner(file);
    return { ...parseReceipt(text), text: text.slice(0, 4000) };
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}
