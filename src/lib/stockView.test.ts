/**
 * Stock page helpers (KAN-119): search, sort, pages, bar lengths and the stock take.
 * Run: npm run test:business
 */
import type { StockItemView, StockLevel } from './stock.ts';
import {
  barPercent,
  barScale,
  filterSortStock,
  formatQty,
  pageCount,
  pageOf,
  parseCount,
  stockHistory,
  stockTakeRows,
  stockTakeSummary,
} from './stockView.ts';

function eq(actual: unknown, expected: unknown, msg: string): void {
  if (JSON.stringify(actual) !== JSON.stringify(expected)) {
    throw new Error(`FAIL: ${msg} (got ${JSON.stringify(actual)}, expected ${JSON.stringify(expected)})`);
  }
}

function item(id: string, name: string, onHand: number, level: StockLevel, extra: Partial<StockItemView> = {}, wac: number | null = 2): StockItemView {
  return {
    id,
    businessId: 'b1',
    name,
    sku: '',
    unit: 'each',
    sellPriceNzd: null,
    reorderLevel: null,
    photoUrl: null,
    notes: '',
    archivedAt: null,
    createdAt: '2026-10-01T00:00:00.000Z',
    updatedAt: '2026-10-01T00:00:00.000Z',
    onChart: true,
    batches: [],
    adjustments: [],
    ...extra,
    position: {
      onHand,
      wacNzd: wac,
      valueNzd: wac == null ? null : Math.max(onHand, 0) * wac,
      sellPriceNzd: null,
      sellValueNzd: null,
      marginPerUnitNzd: null,
      marginTotalNzd: null,
      level,
      oversoldSince: null,
    },
  };
}

const jars = item('a', 'Honey jars', 40, 'ok', { sku: 'HJ-500', reorderLevel: 10 });
const lids = item('b', 'lids', 5, 'low', { reorderLevel: 20 });
const wax = item('c', 'Beeswax', 0, 'out', { unit: 'kg', reorderLevel: 2 });
const labels = item('d', 'Labels', -3, 'oversold');
const combs = item('e', 'Comb frames', 12, 'untracked', {}, null);
const all = [jars, lids, wax, labels, combs];

// Search and sort.
eq(filterSortStock(all, 'hj-5', 'name').map((i) => i.id), ['a'], 'search matches SKU, any case');
eq(filterSortStock(all, '  LIDS ', 'name').map((i) => i.id), ['b'], 'search trims and ignores case');
eq(filterSortStock(all, '', 'name').map((i) => i.name), ['Beeswax', 'Comb frames', 'Honey jars', 'Labels', 'lids'], 'name sort ignores case');
eq(filterSortStock(all, '', 'level').map((i) => i.id), ['d', 'c', 'b', 'a', 'e'], 'level sort: oversold, out, low, ok, untracked');
eq(filterSortStock(all, '', 'onHand').map((i) => i.id), ['a', 'e', 'b', 'c', 'd'], 'on-hand sort is most first');
eq(filterSortStock(all, '', 'value').map((i) => i.id), ['a', 'b', 'c', 'd', 'e'], 'value sort puts unknown cost last');
eq(all.map((i) => i.id), ['a', 'b', 'c', 'd', 'e'], 'sorting does not reorder the input');

// Pages of 8.
const many = Array.from({ length: 17 }, (_, n) => n);
eq(pageCount(17), 3, '17 items are 3 pages');
eq(pageCount(0), 1, 'an empty list is one page');
eq(pageOf(many, 2), [16], 'last page holds the remainder');
eq(pageOf(many, 9), [16], 'a page past the end clamps to the last');
eq(pageOf(many, -1).length, 8, 'a negative page clamps to the first');

// Bars.
eq(barScale([jars, lids]), 40, 'scale is the largest on-hand');
eq(barScale([lids]), 20, 'scale includes reorder levels, so a low bar sits short of its mark');
eq(barScale([labels]), 0, 'oversold only: no scale');
eq(barPercent(5, 20), 25, 'bar percent');
eq(barPercent(-3, 20), 0, 'oversold bar is empty');
eq(barPercent(5, 0), 0, 'zero scale is empty');
eq(barPercent(50, 40), 100, 'bar is capped at full');

eq(formatQty(12, 'each'), '12', 'each has no unit');
eq(formatQty(2.5, 'kg'), '2.5 kg', 'kg shows its unit');
eq(formatQty(1234.5678, 'L'), '1,234.568 L', 'thousands and 3 decimals');

// Counts.
eq(parseCount(''), null, 'blank is not counted');
eq(parseCount(' 0 '), 0, 'zero is a count');
eq(parseCount('2.50001'), 2.5, 'counts round like quantities');
eq(parseCount('-1'), 'invalid', 'negative count is invalid');
eq(parseCount('abc'), 'invalid', 'text is invalid');

// Stock take.
const counts = { a: '38', b: '5', c: '', d: '0', e: 'x' };
const rows = stockTakeRows(all, counts);
eq(rows.map((r) => r.difference), [-2, 0, null, 3, null], 'differences are counted − on-hand');
eq(rows[0].differenceNzd, -4, 'missing stock costs at the average cost');
eq(rows[3].differenceNzd, 6, 'an oversold item counted at 0 finds stock');
eq(rows[4].differenceNzd, null, 'an invalid count has no difference');
const summary = stockTakeSummary(rows, counts);
eq(summary, { counted: 3, total: 5, changed: 2, invalid: ['Comb frames'], netNzd: 2 }, 'summary');
eq(stockTakeSummary(stockTakeRows([combs], { e: '5' }), { e: '5' }).netNzd, null, 'no cost known: no net figure');

// History, newest first.
const withHistory = item('f', 'Smokers', 3, 'ok', {
  batches: [{ id: 'b1', itemId: 'f', date: '2026-09-01', quantity: 5, unitCostNzd: 10, notes: '', createdAt: '2026-09-01T01:00:00.000Z', landedNzd: 55 }],
  adjustments: [
    { id: 'x1', itemId: 'f', date: '2026-09-10', kind: 'damage', quantityLost: 1, reason: 'Dropped', createdAt: '2026-09-10T01:00:00.000Z' },
    { id: 'x2', itemId: 'f', date: '2026-09-10', kind: 'recount', countedQuantity: 3, reason: 'Stock take', createdAt: '2026-09-10T02:00:00.000Z' },
  ],
});
eq(stockHistory(withHistory).map((h) => h.id), ['x2', 'x1', 'b1'], 'history is newest first, same day by entry time');

console.log('stock page helpers: ok');
