/**
 * Businesses for the signed-in user (KAN-84).
 *   GET    /?taxYear=2027            business cards with the tax year's totals
 *   POST   /                         create
 *   GET    /:id?taxYear=             one business: totals, assets, clients, invoices, tagged money
 *   PUT    /:id | DELETE /:id        edit | delete (not while it has invoices)
 *   POST   /:id/logo { image } | DELETE /:id/logo
 *   POST   /:id/archive | /:id/restore   archive hides it (kept with its invoices); restore brings it back
 *   POST   /:id/assets               { category, name, quantity, … }
 *   PUT    /assets/:assetId | DELETE /assets/:assetId
 *   POST   /assets/:assetId/movements { date, kind, quantity, amountNzd?, notes? }
 *   DELETE /movements/:id
 *   GET    /money/candidates?taxYear=&q=   untagged transactions and income to pick from
 *   POST   /money/tag { kind, id, businessId | null }
 *   GET    /produce/candidates | POST /produce/link { commodityId, businessId | null }
 *                                   commodities held as a business's produce (KAN-81)
 *   GET    /clients/:clientId        client view: invoices, billed, outstanding, last payment
 *   POST   /:id/employees            { name, role?, email?, phone?, address?, bankAccount?, payRateNzd?, payUnit?, payFrequency?, payDate?, startDate?, status?, notes? }
 *   PUT    /employees/:employeeId | DELETE /employees/:employeeId (also removes the contract file)
 *   POST   /employees/:employeeId/contract  { fileBase64, fileName? }  PDF, Word (.docx/.doc) or photo, max 8MB; replaces any earlier one
 *   DELETE /employees/:employeeId/contract
 *   GET    /:id/stock?includeArchived=1   items with on-hand, average cost, margin and level (KAN-107)
 *   POST   /:id/stock               { name, sku?, unit?, sellPriceNzd?, reorderLevel?, notes? }
 *   PUT    /stock/:itemId           same body; SKU is unique per business (409)
 *   POST   /stock/:itemId/archive | /stock/:itemId/restore   archive is the only delete; history is kept
 *   POST   /stock/:itemId/photo { image } | DELETE /stock/:itemId/photo
 *   POST   /stock/:itemId/batches   { date?, quantity, unitCostNzd, notes? }  refused while archived
 *   PUT    /stock/batches/:batchId | DELETE /stock/batches/:batchId
 *   POST   /stock/:itemId/adjustments { kind: damage, quantityLost | recount, countedQuantity; reason, date? }
 *   DELETE /stock/adjustments/:id
 *   GET    /:id/suppliers           suppliers with bill count and unpaid total
 *   POST   /:id/suppliers           { name, contactPerson?, email?, phone?, address?, nzbn?, gstNumber?, notes? }
 *   PUT    /suppliers/:supplierId | DELETE /suppliers/:supplierId (409 while it has bills)
 *   GET    /:id/bills?supplierId=   supplier and delivery bills, newest first, with paid/unpaid/overdue
 *   POST   /:id/bills               { supplierId, kind?, reference?, invoiceDate, dueDate, amountNzd, deliveryNzd?,
 *                                     deliveryTreatment?, paidOn?, transactionId?, notes? }
 *   PUT    /bills/:billId | DELETE /bills/:billId (also removes its file and batch links)
 *   POST   /bills/:billId/file { fileBase64, fileName? }  PDF or photo, checked by its signature, max 8MB
 *   DELETE /bills/:billId/file
 *   POST   /bills/:billId/batches { batchId } | DELETE /bills/:billId/batches/:batchId   batches of the same business
 *
 *   GET    /:id/profit-loss?taxYear=2027 | ?from=YYYY-MM-DD&to=YYYY-MM-DD   P&L, months and invoice
 *                                   figures (KAN-126). Business plan only (402 BUSINESS_PLAN_REQUIRED);
 *                                   409 for an archived business
 *   GET    /:id/gst?date=YYYY-MM-DD   the GST return for the period containing that date (default today):
 *                                   GST101A boxes, due date and the items behind them (KAN-127)
 *   PUT    /:id/gst/settings        { frequency: monthly | two_monthly | six_monthly, periodEndMonth: 1–12 }
 *   PUT    /:id/gst/items           { kind: income | transaction, id, treatment: standard | zero | exempt | null }
 *                                   The GST routes are Business plan only, like the P&L.
 *   GET    /:id/export.csv?taxYear= | ?from=&to= [&section=all|pnl|transactions|invoices|gst]
 *                                   accountant export (KAN-128); Business plan only
 *
 * Clients are created and edited through /api/invoices/clients with a businessId.
 */
import { Router, type Request, type Response } from 'express';
import type { AuthedRequest } from '../middleware/requireAuth.ts';
import { requireUserId } from '../lib/userScope.ts';
import { getDb } from '../db/index.ts';
import { aucklandToday } from '../debts/model.ts';
import { taxYearOf, taxYearRange } from '../../src/lib/business.ts';
import {
  addMovement,
  archiveBusiness,
  restoreBusiness,
  createAsset,
  createBusiness,
  deleteAsset,
  deleteBusiness,
  deleteMovement,
  getBusinessDetail,
  getClientView,
  linkProduce,
  listBusinesses,
  moneyCandidates,
  parseAsset,
  parseBusiness,
  parseMovement,
  produceCandidates,
  removeBusinessLogo,
  setBusinessLogo,
  tagMoney,
  updateAsset,
  updateBusiness,
} from '../business/store.ts';
import {
  addAdjustment,
  addBatch,
  createItem,
  deleteAdjustment,
  deleteBatch,
  listStock,
  parseStockAdjustment,
  parseStockBatch,
  parseStockItem,
  removeItemPhoto,
  setItemArchived,
  setItemPhoto,
  updateBatch,
  updateItem,
} from '../business/stock.ts';
import {
  clearBillFile,
  createBill,
  createSupplier,
  deleteBill,
  deleteSupplier,
  linkBillBatch,
  listBills,
  listSuppliers,
  parseBill,
  parseSupplier,
  setBillFile,
  unlinkBillBatch,
  updateBill,
  updateSupplier,
} from '../business/suppliers.ts';
import { clearEmployeeContract, createEmployee, deleteEmployee, parseEmployee, setEmployeeContract, updateEmployee } from '../business/employees.ts';
import { profitLoss } from '../business/profitLoss.ts';
import { gstReturn, parseGstSettings, setGstSettings, setItemGst } from '../business/gst.ts';
import { accountantCsv, fileSlug, isExportSection } from '../business/accountantExport.ts';
import { isGstTreatment } from '../../src/lib/gst.ts';
import { taxYears } from '../business/store.ts';
import { businessRow } from '../business/profile.ts';
import { requireFeature } from '../middleware/requireFeature.ts';
import { isYmd } from '../../src/lib/invoiceCalc.ts';

const router = Router();

router.use((req, res, next) => {
  const userId = requireUserId(req as AuthedRequest, res);
  if (!userId) return;
  (req as AuthedRequest & { scopeUserId: string }).scopeUserId = userId;
  next();
});

function uid(req: Request): string {
  return (req as AuthedRequest & { scopeUserId?: string }).scopeUserId || (req as AuthedRequest).user?.id || '';
}

function reply<T>(res: Response, result: { ok: true; value: T } | { ok: false; status: number; error: string }, created = false) {
  if (!result.ok) {
    res.status(result.status).json({ error: result.error });
    return;
  }
  res.status(created ? 201 : 200).json(result.value);
}

/** ?taxYear=2027 → 2027; missing or out of range → null (the current year). */
function taxYearParam(req: Request): number | null {
  const n = Number(req.query.taxYear);
  return Number.isInteger(n) && n >= 2000 && n <= 2100 ? n : null;
}

router.get('/', async (req, res) => {
  const db = await getDb();
  res.json(listBusinesses(db, uid(req), aucklandToday(), taxYearParam(req)));
});

router.post('/', async (req, res) => {
  const parsed = parseBusiness(req.body);
  if (!parsed.ok) {
    res.status(400).json({ error: parsed.error });
    return;
  }
  const db = await getDb();
  res.status(201).json(createBusiness(db, uid(req), parsed.value));
});

router.get('/money/candidates', async (req, res) => {
  const db = await getDb();
  const { start, end } = taxYearRange(taxYearParam(req) ?? taxYearOf(aucklandToday()));
  const q = typeof req.query.q === 'string' ? req.query.q.slice(0, 80) : '';
  res.json(moneyCandidates(db, uid(req), start, end, q));
});

router.post('/money/tag', async (req, res) => {
  const b = (req.body ?? {}) as Record<string, unknown>;
  if ((b.kind !== 'transaction' && b.kind !== 'income') || typeof b.id !== 'string' || !b.id) {
    res.status(400).json({ error: 'kind (transaction or income) and id are required' });
    return;
  }
  const businessId = typeof b.businessId === 'string' && b.businessId ? b.businessId : null;
  const db = await getDb();
  reply(res, tagMoney(db, uid(req), b.kind, b.id, businessId));
});

router.get('/produce/candidates', async (req, res) => {
  const db = await getDb();
  res.json(produceCandidates(db, uid(req), aucklandToday()));
});

router.post('/produce/link', async (req, res) => {
  const b = (req.body ?? {}) as Record<string, unknown>;
  if (typeof b.commodityId !== 'string' || !b.commodityId) {
    res.status(400).json({ error: 'commodityId is required' });
    return;
  }
  const db = await getDb();
  reply(res, linkProduce(db, uid(req), b.commodityId, typeof b.businessId === 'string' && b.businessId ? b.businessId : null));
});

router.get('/clients/:clientId', async (req, res) => {
  const db = await getDb();
  const view = getClientView(db, uid(req), req.params.clientId, aucklandToday());
  if (!view) {
    res.status(404).json({ error: 'Client not found' });
    return;
  }
  res.json(view);
});

router.put('/employees/:employeeId', async (req, res) => {
  const parsed = parseEmployee(req.body);
  if (!parsed.ok) {
    res.status(400).json({ error: parsed.error });
    return;
  }
  const db = await getDb();
  reply(res, updateEmployee(db, uid(req), req.params.employeeId, parsed.value, aucklandToday()));
});

router.post('/employees/:employeeId/contract', async (req, res) => {
  const db = await getDb();
  reply(res, setEmployeeContract(db, uid(req), req.params.employeeId, req.body?.fileBase64, req.body?.fileName, aucklandToday()));
});

router.delete('/employees/:employeeId/contract', async (req, res) => {
  const db = await getDb();
  reply(res, clearEmployeeContract(db, uid(req), req.params.employeeId, aucklandToday()));
});

router.delete('/employees/:employeeId', async (req, res) => {
  const db = await getDb();
  if (!deleteEmployee(db, uid(req), req.params.employeeId)) {
    res.status(404).json({ error: 'Employee not found' });
    return;
  }
  res.json({ ok: true, id: req.params.employeeId });
});

function parsedOr400<T>(res: Response, parsed: { ok: true; value: T } | { ok: false; error: string }): T | null {
  if (parsed.ok) return parsed.value;
  res.status(400).json({ error: parsed.error });
  return null;
}

router.put('/stock/batches/:batchId', async (req, res) => {
  const draft = parsedOr400(res, parseStockBatch(req.body, aucklandToday()));
  if (!draft) return;
  const db = await getDb();
  reply(res, updateBatch(db, uid(req), req.params.batchId, draft));
});

router.delete('/stock/batches/:batchId', async (req, res) => {
  const db = await getDb();
  reply(res, deleteBatch(db, uid(req), req.params.batchId));
});

router.delete('/stock/adjustments/:id', async (req, res) => {
  const db = await getDb();
  reply(res, deleteAdjustment(db, uid(req), req.params.id));
});

router.put('/stock/:itemId', async (req, res) => {
  const draft = parsedOr400(res, parseStockItem(req.body));
  if (!draft) return;
  const db = await getDb();
  reply(res, updateItem(db, uid(req), req.params.itemId, draft));
});

router.post('/stock/:itemId/archive', async (req, res) => {
  const db = await getDb();
  reply(res, setItemArchived(db, uid(req), req.params.itemId, true));
});

router.post('/stock/:itemId/restore', async (req, res) => {
  const db = await getDb();
  reply(res, setItemArchived(db, uid(req), req.params.itemId, false));
});

router.post('/stock/:itemId/photo', async (req, res) => {
  const image = (req.body as { image?: unknown } | undefined)?.image;
  if (typeof image !== 'string' || !image) {
    res.status(400).json({ error: 'image is required' });
    return;
  }
  const db = await getDb();
  reply(res, setItemPhoto(db, uid(req), req.params.itemId, image));
});

router.delete('/stock/:itemId/photo', async (req, res) => {
  const db = await getDb();
  reply(res, removeItemPhoto(db, uid(req), req.params.itemId));
});

router.post('/stock/:itemId/batches', async (req, res) => {
  const draft = parsedOr400(res, parseStockBatch(req.body, aucklandToday()));
  if (!draft) return;
  const db = await getDb();
  reply(res, addBatch(db, uid(req), req.params.itemId, draft), true);
});

router.post('/stock/:itemId/adjustments', async (req, res) => {
  const draft = parsedOr400(res, parseStockAdjustment(req.body, aucklandToday()));
  if (!draft) return;
  const db = await getDb();
  reply(res, addAdjustment(db, uid(req), req.params.itemId, draft), true);
});

router.put('/suppliers/:supplierId', async (req, res) => {
  const draft = parsedOr400(res, parseSupplier(req.body));
  if (!draft) return;
  const db = await getDb();
  reply(res, updateSupplier(db, uid(req), req.params.supplierId, draft, aucklandToday()));
});

router.delete('/suppliers/:supplierId', async (req, res) => {
  const db = await getDb();
  reply(res, deleteSupplier(db, uid(req), req.params.supplierId));
});

router.put('/bills/:billId', async (req, res) => {
  const draft = parsedOr400(res, parseBill(req.body));
  if (!draft) return;
  const db = await getDb();
  reply(res, updateBill(db, uid(req), req.params.billId, draft, aucklandToday()));
});

router.delete('/bills/:billId', async (req, res) => {
  const db = await getDb();
  reply(res, deleteBill(db, uid(req), req.params.billId));
});

router.post('/bills/:billId/file', async (req, res) => {
  const db = await getDb();
  reply(res, setBillFile(db, uid(req), req.params.billId, req.body?.fileBase64, req.body?.fileName, aucklandToday()));
});

router.delete('/bills/:billId/file', async (req, res) => {
  const db = await getDb();
  reply(res, clearBillFile(db, uid(req), req.params.billId, aucklandToday()));
});

router.post('/bills/:billId/batches', async (req, res) => {
  const batchId = (req.body as { batchId?: unknown } | undefined)?.batchId;
  if (typeof batchId !== 'string' || !batchId) {
    res.status(400).json({ error: 'batchId is required' });
    return;
  }
  const db = await getDb();
  reply(res, linkBillBatch(db, uid(req), req.params.billId, batchId, aucklandToday()));
});

router.delete('/bills/:billId/batches/:batchId', async (req, res) => {
  const db = await getDb();
  reply(res, unlinkBillBatch(db, uid(req), req.params.billId, req.params.batchId, aucklandToday()));
});

router.put('/assets/:assetId', async (req, res) => {
  const parsed = parseAsset(req.body, aucklandToday());
  if (!parsed.ok) {
    res.status(400).json({ error: parsed.error });
    return;
  }
  const db = await getDb();
  reply(res, updateAsset(db, uid(req), req.params.assetId, parsed.value));
});

router.delete('/assets/:assetId', async (req, res) => {
  const db = await getDb();
  if (!deleteAsset(db, uid(req), req.params.assetId)) {
    res.status(404).json({ error: 'Asset not found' });
    return;
  }
  res.json({ ok: true, id: req.params.assetId });
});

router.post('/assets/:assetId/movements', async (req, res) => {
  const parsed = parseMovement(req.body, aucklandToday());
  if (!parsed.ok) {
    res.status(400).json({ error: parsed.error });
    return;
  }
  const db = await getDb();
  reply(res, addMovement(db, uid(req), req.params.assetId, parsed.value), true);
});

router.delete('/movements/:id', async (req, res) => {
  const db = await getDb();
  reply(res, deleteMovement(db, uid(req), req.params.id));
});

/** A custom period can span up to three years; a tax year is the usual ask. */
const MAX_PERIOD_DAYS = 3 * 366;

/** ?taxYear=, or ?from=&to= (both, in order, up to three years). Sends a 400 and returns null when invalid. */
function periodParam(req: Request, res: Response, today: string): { start: string; end: string; taxYear: number | null } | null {
  const from = typeof req.query.from === 'string' ? req.query.from : '';
  const to = typeof req.query.to === 'string' ? req.query.to : '';
  if (!from && !to) {
    const year = taxYearParam(req) ?? taxYearOf(today);
    return { ...taxYearRange(year), taxYear: year };
  }
  const error = !isYmd(from) || !isYmd(to)
    ? 'from and to must both be YYYY-MM-DD'
    : to < from
      ? 'to must be on or after from'
      : (Date.parse(to) - Date.parse(from)) / 86_400_000 > MAX_PERIOD_DAYS
        ? 'Pick a period of three years or less'
        : null;
  if (error) {
    res.status(400).json({ error });
    return null;
  }
  return { start: from, end: to, taxYear: null };
}

router.get('/:id/profit-loss', requireFeature('business_reports'), async (req, res) => {
  const found = await activeBusiness(req, res);
  if (!found) return;
  const today = aucklandToday();
  const period = periodParam(req, res, today);
  if (!period) return;
  res.json(profitLoss(found.db, uid(req), { id: found.r.id, name: found.r.name }, { ...period, taxYears: taxYears(found.db, uid(req), today) }, today));
});

router.get('/:id/export.csv', requireFeature('business_reports'), async (req, res) => {
  const section = req.query.section == null || req.query.section === '' ? 'all' : req.query.section;
  if (!isExportSection(section)) {
    res.status(400).json({ error: 'section must be all, pnl, transactions, invoices or gst' });
    return;
  }
  const found = await activeBusiness(req, res);
  if (!found) return;
  const today = aucklandToday();
  const period = periodParam(req, res, today);
  if (!period) return;
  const csv = accountantCsv(found.db, uid(req), { id: found.r.id, name: found.r.name, gstRegistered: Number(found.r.gst_registered) === 1 }, period, today, section);
  const name = `${fileSlug(found.r.name)}-${period.start}-to-${period.end}${section === 'all' ? '' : `-${section}`}.csv`;
  res.setHeader('Content-Type', 'text/csv; charset=utf-8');
  res.setHeader('Content-Disposition', `attachment; filename="${name}"`);
  res.setHeader('Cache-Control', 'no-store');
  // The BOM makes Excel read the file as UTF-8 (macrons in names).
  res.send(`\ufeff${csv}`);
});

/** This user's business, not archived; else the reply is sent and null comes back. */
async function activeBusiness(req: Request, res: Response) {
  const db = await getDb();
  const r = businessRow(db, uid(req), req.params.id);
  if (!r) {
    res.status(404).json({ error: 'Business not found' });
    return null;
  }
  if (r.archived_at) {
    res.status(409).json({ error: 'This business is archived. Restore it to see its reports.' });
    return null;
  }
  return { db, r };
}

router.get('/:id/gst', requireFeature('business_reports'), async (req, res) => {
  const found = await activeBusiness(req, res);
  if (!found) return;
  const date = typeof req.query.date === 'string' && isYmd(req.query.date) ? req.query.date : aucklandToday();
  res.json(gstReturn(found.db, uid(req), { id: found.r.id, gstRegistered: Number(found.r.gst_registered) === 1 }, date));
});

router.put('/:id/gst/settings', requireFeature('business_reports'), async (req, res) => {
  const parsed = parseGstSettings(req.body);
  if (!parsed.ok) {
    res.status(400).json({ error: parsed.error });
    return;
  }
  const found = await activeBusiness(req, res);
  if (!found) return;
  setGstSettings(found.db, uid(req), found.r.id, parsed.value);
  res.json(parsed.value);
});

router.put('/:id/gst/items', requireFeature('business_reports'), async (req, res) => {
  const b = (req.body ?? {}) as { kind?: unknown; id?: unknown; treatment?: unknown };
  if ((b.kind !== 'income' && b.kind !== 'transaction') || typeof b.id !== 'string' || !(b.treatment === null || isGstTreatment(b.treatment))) {
    res.status(400).json({ error: 'Send kind (income or transaction), id, and treatment (standard, zero, exempt or null)' });
    return;
  }
  const found = await activeBusiness(req, res);
  if (!found) return;
  if (!setItemGst(found.db, uid(req), found.r.id, b.kind, b.id, b.treatment)) {
    res.status(404).json({ error: 'Not found in this business’s money (invoice payments follow their invoice)' });
    return;
  }
  res.json({ ok: true });
});

router.get('/:id', async (req, res) => {
  const db = await getDb();
  const detail = getBusinessDetail(db, uid(req), req.params.id, aucklandToday(), taxYearParam(req));
  if (!detail) {
    res.status(404).json({ error: 'Business not found' });
    return;
  }
  res.json(detail);
});

router.put('/:id', async (req, res) => {
  const parsed = parseBusiness(req.body);
  if (!parsed.ok) {
    res.status(400).json({ error: parsed.error });
    return;
  }
  const db = await getDb();
  const saved = updateBusiness(db, uid(req), req.params.id, parsed.value);
  if (!saved) {
    res.status(404).json({ error: 'Business not found' });
    return;
  }
  res.json(saved);
});

router.delete('/:id', async (req, res) => {
  const db = await getDb();
  const out = deleteBusiness(db, uid(req), req.params.id);
  if (!out.ok) {
    res.status(out.status).json({ error: out.error });
    return;
  }
  res.json({ ok: true, id: req.params.id });
});

router.post('/:id/archive', async (req, res) => {
  const db = await getDb();
  reply(res, archiveBusiness(db, uid(req), req.params.id));
});

router.post('/:id/restore', async (req, res) => {
  const db = await getDb();
  reply(res, restoreBusiness(db, uid(req), req.params.id));
});

router.post('/:id/logo', async (req, res) => {
  const image = (req.body as { image?: unknown } | undefined)?.image;
  if (typeof image !== 'string' || !image) {
    res.status(400).json({ error: 'image is required' });
    return;
  }
  const db = await getDb();
  reply(res, setBusinessLogo(db, uid(req), req.params.id, image));
});

router.delete('/:id/logo', async (req, res) => {
  const db = await getDb();
  reply(res, removeBusinessLogo(db, uid(req), req.params.id));
});

router.post('/:id/employees', async (req, res) => {
  const parsed = parseEmployee(req.body);
  if (!parsed.ok) {
    res.status(400).json({ error: parsed.error });
    return;
  }
  const db = await getDb();
  reply(res, createEmployee(db, uid(req), req.params.id, parsed.value, aucklandToday()), true);
});

router.get('/:id/stock', async (req, res) => {
  const db = await getDb();
  reply(res, listStock(db, uid(req), req.params.id, { includeArchived: req.query.includeArchived === '1' || req.query.includeArchived === 'true' }));
});

router.post('/:id/stock', async (req, res) => {
  const draft = parsedOr400(res, parseStockItem(req.body));
  if (!draft) return;
  const db = await getDb();
  reply(res, createItem(db, uid(req), req.params.id, draft), true);
});

router.get('/:id/suppliers', async (req, res) => {
  const db = await getDb();
  reply(res, listSuppliers(db, uid(req), req.params.id, aucklandToday()));
});

router.post('/:id/suppliers', async (req, res) => {
  const draft = parsedOr400(res, parseSupplier(req.body));
  if (!draft) return;
  const db = await getDb();
  reply(res, createSupplier(db, uid(req), req.params.id, draft, aucklandToday()), true);
});

router.get('/:id/bills', async (req, res) => {
  const supplierId = typeof req.query.supplierId === 'string' && req.query.supplierId ? req.query.supplierId : null;
  const db = await getDb();
  reply(res, listBills(db, uid(req), req.params.id, aucklandToday(), supplierId));
});

router.post('/:id/bills', async (req, res) => {
  const draft = parsedOr400(res, parseBill(req.body));
  if (!draft) return;
  const db = await getDb();
  reply(res, createBill(db, uid(req), req.params.id, draft, aucklandToday()), true);
});

router.post('/:id/assets', async (req, res) => {
  const parsed = parseAsset(req.body, aucklandToday());
  if (!parsed.ok) {
    res.status(400).json({ error: parsed.error });
    return;
  }
  const db = await getDb();
  reply(res, createAsset(db, uid(req), req.params.id, parsed.value), true);
});

export default router;
