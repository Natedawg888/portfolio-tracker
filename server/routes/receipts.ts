/**
 * Receipt scanning (KAN-60). POST /api/receipts/scan { imageBase64 } → { merchant, date, amountNzd, text }.
 * OCR runs on this server (server/receipts/ocr.ts); nothing is stored. 30 scans an hour per user.
 */
import { Router } from 'express';
import type { AuthedRequest } from '../middleware/requireAuth.ts';
import { requireUserId } from '../lib/userScope.ts';
import { OcrError, scanReceipt, tesseractRunner, type OcrRunner } from '../receipts/ocr.ts';

const router = Router();
const PER_HOUR = 30;
const recent = new Map<string, number[]>();
let runner: OcrRunner = tesseractRunner;
/** Tests: a fake OCR engine. */
export function setOcrRunnerForTest(r: OcrRunner): void {
  runner = r;
}

router.post('/scan', async (req, res) => {
  const userId = requireUserId(req as AuthedRequest, res);
  if (!userId) return;
  const now = Date.now();
  const mine = (recent.get(userId) ?? []).filter((t) => now - t < 3_600_000);
  if (mine.length >= PER_HOUR) {
    res.status(429).json({ error: 'That’s a lot of scans. Try again in a while.' });
    return;
  }
  recent.set(userId, [...mine, now]);
  try {
    res.json(await scanReceipt(req.body?.imageBase64, runner));
  } catch (err) {
    if (err instanceof OcrError) {
      res.status(err.status).json({ error: err.message });
      return;
    }
    res.status(500).json({ error: 'Couldn’t read that receipt.' });
  }
});

export default router;
