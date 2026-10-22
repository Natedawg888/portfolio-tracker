/**
 * Stock derivations (KAN-107): weighted average landed cost, on-hand from batches, sales and
 * adjustments, freight split across batches, levels and the archive rule.
 * Run: npm run test:business
 */
import {
  checkSaleItems,
  landedCosts,
  replayStock,
  stockPosition,
  type StockAdjustment,
  type StockBatch,
  type StockItem,
  type StockSaleLine,
  type SupplierInvoiceCost,
} from './stock.ts';

function eq(actual: unknown, expected: unknown, msg: string): void {
  const close = typeof actual === 'number' && typeof expected === 'number' && Math.abs(actual - expected) < 1e-9;
  if (!close && actual !== expected) throw new Error(`FAIL: ${msg} (got ${String(actual)}, expected ${String(expected)})`);
}

let seq = 0;
const t = () => `2026-10-01T00:00:${String(seq++).padStart(2, '0')}.000Z`;
const batch = (date: string, quantity: number, unitCostNzd: number, id = `b${seq}`, itemId = 'i1', createdAt = t()): StockBatch => ({
  id, itemId, date, quantity, unitCostNzd, notes: '', createdAt,
});
const sale = (date: string, quantity: number, id = `l${seq}`, createdAt = t()): StockSaleLine => ({
  id, saleId: `s${seq}`, itemId: 'i1', quantity, unitPriceNzd: 10, date, createdAt,
});
const damage = (date: string, quantityLost: number, id = `a${seq}`, createdAt = t()): StockAdjustment => ({
  id, itemId: 'i1', date, reason: 'broken', createdAt, kind: 'damage', quantityLost,
});
const recount = (date: string, countedQuantity: number, id = `a${seq}`, createdAt = t()): StockAdjustment => ({
  id, itemId: 'i1', date, reason: 'stocktake', createdAt, kind: 'recount', countedQuantity,
});

type Case = {
  name: string;
  batches?: StockBatch[];
  saleLines?: StockSaleLine[];
  adjustments?: StockAdjustment[];
  onHand: number;
  wac: number | null;
  oversoldSince?: string | null;
  lineCost?: [string, number | null][];
  adjustmentCost?: [string, number | null][];
};

const cases: Case[] = [
  { name: 'plain WAC across batches', batches: [batch('2026-01-01', 10, 2), batch('2026-01-02', 10, 4)], onHand: 20, wac: 3 },
  {
    name: 'sale then batch: the sale costs at the WAC then, the batch averages with what is left',
    batches: [batch('2026-01-01', 10, 2), batch('2026-01-03', 5, 5)],
    saleLines: [sale('2026-01-02', 5, 'L1')],
    onHand: 10,
    wac: 3.5,
    lineCost: [['L1', 10]],
  },
  {
    name: 'oversell then restock: on-hand goes negative, the next batch restarts the WAC',
    batches: [batch('2026-01-01', 5, 2), batch('2026-01-03', 10, 6)],
    saleLines: [sale('2026-01-02', 8, 'L1')],
    onHand: 7,
    wac: 6,
    oversoldSince: null,
    lineCost: [['L1', 16]],
  },
  {
    name: 'oversold and not yet restocked is flagged from the day it went negative',
    batches: [batch('2026-01-01', 5, 2)],
    saleLines: [sale('2026-01-02', 3), sale('2026-01-04', 4), sale('2026-01-05', 1)],
    onHand: -3,
    wac: 2,
    oversoldSince: '2026-01-04',
  },
  {
    name: 'sale before any batch has no cost; the later batch sets the WAC',
    batches: [batch('2026-01-02', 10, 3)],
    saleLines: [sale('2026-01-01', 2, 'L1')],
    onHand: 8,
    wac: 3,
    lineCost: [['L1', null]],
  },
  { name: 'sale with no batch at all: oversold, no cost', saleLines: [sale('2026-01-01', 2)], onHand: -2, wac: null, oversoldSince: '2026-01-01' },
  {
    name: 'same day: the batch comes before a sale entered earlier',
    batches: [batch('2026-01-01', 10, 2, 'B1', 'i1', '2026-10-01T09:00:00.000Z')],
    saleLines: [sale('2026-01-01', 4, 'L1', '2026-10-01T08:00:00.000Z')],
    onHand: 6,
    wac: 2,
    oversoldSince: null,
    lineCost: [['L1', 8]],
  },
  {
    name: 'damage removes stock at the WAC',
    batches: [batch('2026-01-01', 10, 2)],
    adjustments: [damage('2026-01-02', 3, 'D1')],
    onHand: 7,
    wac: 2,
    adjustmentCost: [['D1', 6]],
  },
  {
    name: 'recount sets on-hand to what was counted; stock found has negative cost',
    batches: [batch('2026-01-01', 10, 2)],
    saleLines: [sale('2026-01-02', 3)],
    adjustments: [recount('2026-01-03', 9, 'R1')],
    onHand: 9,
    wac: 2,
    adjustmentCost: [['R1', -4]],
  },
  {
    name: 'a back-dated sale entered after a recount does not change on-hand after the recount',
    batches: [batch('2026-01-01', 10, 2)],
    adjustments: [recount('2026-01-03', 6, 'R1', '2026-10-01T09:00:00.000Z')],
    saleLines: [sale('2026-01-02', 3, 'L1', '2026-10-02T00:00:00.000Z')],
    onHand: 6,
    wac: 2,
    lineCost: [['L1', 6]],
    adjustmentCost: [['R1', 2]],
  },
  {
    name: 'a sale on the recount day comes before the end-of-day count, whenever it was entered',
    batches: [batch('2026-01-01', 10, 2)],
    adjustments: [recount('2026-01-03', 6, 'R1', '2026-10-01T09:00:00.000Z')],
    saleLines: [sale('2026-01-03', 3, 'L1', '2026-10-02T00:00:00.000Z')],
    onHand: 6,
    wac: 2,
  },
  {
    name: 'stock after the recount moves on from the counted figure',
    batches: [batch('2026-01-01', 10, 2), batch('2026-01-05', 4, 5)],
    adjustments: [recount('2026-01-03', 6)],
    saleLines: [sale('2026-01-06', 1)],
    onHand: 9,
    wac: 3.2,
  },
  { name: 'kg quantities add without float drift', batches: [batch('2026-01-01', 0.1, 10), batch('2026-01-01', 0.2, 10)], saleLines: [sale('2026-01-02', 0.3)], onHand: 0, wac: 10, oversoldSince: null },
];

for (const c of cases) {
  const batches = c.batches ?? [];
  const ledger = replayStock({ batches, landed: landedCosts(batches, []), adjustments: c.adjustments ?? [], saleLines: c.saleLines ?? [] });
  eq(ledger.onHand, c.onHand, `${c.name}: on-hand`);
  eq(ledger.wacNzd, c.wac, `${c.name}: WAC`);
  if (c.oversoldSince !== undefined) eq(ledger.oversoldSince, c.oversoldSince, `${c.name}: oversold since`);
  for (const [id, cost] of c.lineCost ?? []) eq(ledger.lineCost.get(id), cost, `${c.name}: cost of ${id}`);
  for (const [id, cost] of c.adjustmentCost ?? []) eq(ledger.adjustmentCost.get(id), cost, `${c.name}: cost of ${id}`);
}

// ---------------------------------------------------------------- freight
const honey = batch('2026-02-01', 10, 10, 'HONEY', 'honey'); // goods $100
const wax = batch('2026-02-01', 20, 15, 'WAX', 'wax'); // goods $300
const jars = batch('2026-02-01', 5, 0, 'JARS', 'jars'); // free samples
const bill = (o: Partial<SupplierInvoiceCost>): SupplierInvoiceCost => ({
  id: 'inv', kind: 'delivery', amountNzd: 40, deliveryNzd: 40, deliveryTreatment: 'capitalise', batchIds: ['HONEY', 'WAX'], ...o,
});

type FreightCase = { name: string; batches: StockBatch[]; invoices: SupplierInvoiceCost[]; landed: [string, number][] };
const freight: FreightCase[] = [
  { name: 'capitalised freight split by goods value', batches: [honey, wax], invoices: [bill({})], landed: [['HONEY', 110], ['WAX', 330]] },
  { name: 'expensed freight stays out of cost', batches: [honey, wax], invoices: [bill({ deliveryTreatment: 'expense' })], landed: [['HONEY', 100], ['WAX', 300]] },
  {
    name: 'a goods bill capitalises only its freight line',
    batches: [honey, wax],
    invoices: [bill({ kind: 'stock', amountNzd: 440, deliveryNzd: 20 })],
    landed: [['HONEY', 105], ['WAX', 315]],
  },
  { name: 'two freight bills on one batch both land', batches: [honey], invoices: [bill({ id: 'f1', batchIds: ['HONEY'] }), bill({ id: 'f2', amountNzd: 5, deliveryNzd: 5, batchIds: ['HONEY'] })], landed: [['HONEY', 145]] },
  { name: 'freight over batches worth nothing is split equally', batches: [jars, batch('2026-02-01', 1, 0, 'JARS2', 'jars')], invoices: [bill({ batchIds: ['JARS', 'JARS2'] })], landed: [['JARS', 20], ['JARS2', 20]] },
  { name: 'a link to a batch not loaded is skipped', batches: [honey], invoices: [bill({ batchIds: ['HONEY', 'GONE'] })], landed: [['HONEY', 140]] },
];
for (const c of freight) {
  const landed = landedCosts(c.batches, c.invoices);
  for (const [id, n] of c.landed) eq(landed.get(id), n, `${c.name}: landed ${id}`);
}

const withFreight = landedCosts([honey, wax], [bill({})]);
eq(replayStock({ batches: [honey], landed: withFreight, adjustments: [], saleLines: [] }).wacNzd, 11, 'freight reaches the WAC');

// ---------------------------------------------------------------- position and level
const item = (o: Partial<StockItem> = {}): StockItem => ({
  id: 'i1', businessId: 'biz', name: 'Manuka 500g', sku: 'MAN-500', unit: 'each', sellPriceNzd: 30, reorderLevel: 5,
  photoUrl: null, notes: '', archivedAt: null, createdAt: '', updatedAt: '', ...o,
});
const ledger = (onHand: number, wacNzd: number | null) => ({ onHand, wacNzd, lineCost: new Map(), adjustmentCost: new Map(), oversoldSince: null });

const p = stockPosition(item(), ledger(12, 18));
eq(p.valueNzd, 216, 'value at cost');
eq(p.sellValueNzd, 360, 'value at sell price');
eq(p.marginPerUnitNzd, 12, 'margin per unit');
eq(p.marginTotalNzd, 144, 'margin in total');
eq(p.level, 'ok', 'above the reorder level');
eq(stockPosition(item(), ledger(1, 1 / 3)).wacNzd, 0.3333, 'WAC per unit to 4 places');

const noPrice = stockPosition(item({ sellPriceNzd: null }), ledger(12, 18));
eq(noPrice.marginPerUnitNzd, null, 'no sell price: margin unknown, not guessed');
eq(noPrice.sellValueNzd, null, 'no sell price: no sell value');
const noCost = stockPosition(item(), ledger(0, null));
eq(noCost.valueNzd, null, 'no batch: value unknown');
eq(noCost.marginPerUnitNzd, null, 'no batch: margin unknown');

const oversold = stockPosition(item(), ledger(-3, 18));
eq(oversold.valueNzd, 0, 'oversold stock is worth 0, not negative');
eq(oversold.marginTotalNzd, 0, 'and has no margin in total');

const levels: [number, number | null, string][] = [
  [6, 5, 'ok'], [5, 5, 'low'], [0.5, 5, 'low'], [0, 5, 'out'], [-1, 5, 'oversold'], [0, 0, 'out'], [1, 0, 'ok'],
  [3, null, 'untracked'], [0, null, 'untracked'], [-2, null, 'oversold'],
];
for (const [onHand, reorderLevel, want] of levels) {
  eq(stockPosition(item({ reorderLevel }), ledger(onHand, 1)).level, want, `level at ${onHand} with reorder level ${reorderLevel}`);
}

// ---------------------------------------------------------------- archive rule for sales
const live = item({ id: 'live' });
const gone = item({ id: 'gone', archivedAt: '2026-10-01T00:00:00.000Z' });
const items = new Map([['live', live], ['gone', gone]]);
eq(checkSaleItems([{ itemId: 'live' }], items, null).ok, true, 'a live item can be sold');
const blocked = checkSaleItems([{ itemId: 'live' }, { itemId: 'gone' }, { itemId: 'nope' }], items, null);
eq(!blocked.ok && blocked.archived.map((i) => i.id).join(), 'gone', 'an archived item can’t go on a new sale');
eq(!blocked.ok && blocked.missing.join(), 'nope', 'an unknown item is reported');
eq(checkSaleItems([{ itemId: 'gone' }], items, { lines: [{ itemId: 'gone' }] }).ok, true, 'an edited sale keeps its line for an item archived since');
eq(checkSaleItems([{ itemId: 'gone' }], items, { lines: [{ itemId: 'live' }] }).ok, false, 'but can’t add one');

console.log('stock derivation tests passed');
