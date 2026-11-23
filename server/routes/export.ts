/**
 * CSV / PDF export (KAN-63).
 *   GET /api/export/csv?section=budget|assets|kiwisaver|all&from=YYYY-MM&to=YYYY-MM
 *   GET /api/export/pdf?from=YYYY-MM&to=YYYY-MM     summary PDF
 * Defaults: this calendar year to this month. Built in server/export/userExport.ts.
 */
import { Router } from 'express';
import type { AuthedRequest } from '../middleware/requireAuth.ts';
import { requireUserId } from '../lib/userScope.ts';
import { getDb } from '../db/index.ts';
import { aucklandToday } from '../debts/model.ts';
import { EXPORT_SECTIONS, exportCsv, exportPdf, type ExportSection } from '../export/userExport.ts';

const router = Router();
const ym = (v: unknown) => (typeof v === 'string' && /^\d{4}-(0[1-9]|1[0-2])$/.test(v) ? v : null);

function range(q: Record<string, unknown>, today: string): { from: string; to: string } | null {
  const from = q.from == null || q.from === '' ? `${today.slice(0, 4)}-01` : ym(q.from);
  const to = q.to == null || q.to === '' ? today.slice(0, 7) : ym(q.to);
  return from && to && from <= to ? { from, to } : null;
}

router.get('/csv', async (req, res) => {
  const userId = requireUserId(req as AuthedRequest, res);
  if (!userId) return;
  const section = (req.query.section ?? 'all') as ExportSection;
  if (!(EXPORT_SECTIONS as readonly string[]).includes(section)) {
    res.status(400).json({ error: `section must be one of ${EXPORT_SECTIONS.join(', ')}` });
    return;
  }
  const today = aucklandToday();
  const r = range(req.query as Record<string, unknown>, today);
  if (!r) {
    res.status(400).json({ error: 'from and to must be YYYY-MM, from on or before to' });
    return;
  }
  const csv = await exportCsv(await getDb(), userId, section, r.from, r.to);
  res.setHeader('Content-Type', 'text/csv; charset=utf-8');
  res.setHeader('Content-Disposition', `attachment; filename="koruledger-${section}-${r.from}-to-${r.to}.csv"`);
  res.send(`\uFEFF${csv}`);
});

router.get('/pdf', async (req, res) => {
  const userId = requireUserId(req as AuthedRequest, res);
  if (!userId) return;
  const today = aucklandToday();
  const r = range(req.query as Record<string, unknown>, today);
  if (!r) {
    res.status(400).json({ error: 'from and to must be YYYY-MM, from on or before to' });
    return;
  }
  const pdf = await exportPdf(await getDb(), userId, r.from, r.to, today);
  res.setHeader('Content-Type', 'application/pdf');
  res.setHeader('Content-Disposition', `attachment; filename="koruledger-summary-${r.from}-to-${r.to}.pdf"`);
  res.send(Buffer.from(pdf));
});

export default router;
