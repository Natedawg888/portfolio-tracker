/**
 * Sales page helpers (KAN-123): line prices and totals, the save hint, the body, labels.
 * Run: npm run test:business
 */
import { blankLine, draftLines, draftTotal, incomeNote, itemOptions, receiptLabel, saleBody, saleDraft, saleHint, type SaleItemOption } from './salesView.ts';
import type { BusinessSale } from '../types/index.ts';

function eq(actual: unknown, expected: unknown, msg: string): void {
  if (JSON.stringify(actual) !== JSON.stringify(expected)) {
    throw new Error(`FAIL: ${msg} (got ${JSON.stringify(actual)}, expected ${JSON.stringify(expected)})`);
  }
}

const today = '2026-10-30';
const list: SaleItemOption[] = [
  { id: 'jar', name: 'Honey jar', sellPriceNzd: 23, archived: false },
  { id: 'wax', name: 'Beeswax', sellPriceNzd: null, archived: false },
  { id: 'old', name: 'Old label', sellPriceNzd: 5, archived: true },
];
const items = new Map(list.map((i) => [i.id, i]));

// Prices: blank uses the sell price; typed wins; no sell price needs one.
const draft = { date: today, clientId: '', notes: ' Market ', lines: [{ itemId: 'jar', quantity: '3', price: '' }, { itemId: 'wax', quantity: '1.5', price: '30' }] };
const lines = draftLines(draft, items);
eq(lines.map((l) => [l.price, l.usesSellPrice, l.totalNzd]), [[23, true, 69], [30, false, 45]], 'line prices and totals');
eq(draftTotal(draft, items), 114, 'sale total');
eq(saleHint(draft, items, today), null, 'ready to save');

// Hints, in order.
eq(saleHint({ ...draft, lines: [] }, items, today), 'Add an item', 'no lines');
eq(saleHint({ ...draft, date: '2026-11-01' }, items, today), 'The date can’t be in the future', 'future');
eq(saleHint({ ...draft, lines: [blankLine()] }, items, today), 'Line 1: pick an item', 'no item');
eq(saleHint({ ...draft, lines: [{ itemId: 'jar', quantity: '0', price: '' }] }, items, today), 'Line 1: enter a quantity', 'zero qty');
eq(saleHint({ ...draft, lines: [{ itemId: 'jar', quantity: 'x', price: '' }] }, items, today), 'Line 1: enter a quantity', 'bad qty');
eq(saleHint({ ...draft, lines: [{ itemId: 'wax', quantity: '1', price: '' }] }, items, today), 'Line 1: Beeswax has no sell price, so enter the price charged', 'no price');
eq(draftTotal({ ...draft, lines: [{ itemId: 'wax', quantity: '1', price: '' }] }, items), 0, 'unpriced line adds nothing');

// Body: blank price → null (the server uses the sell price), trimmed notes, empty client → null.
eq(saleBody(draft), { date: today, clientId: null, invoiceId: null, transactionId: null, notes: 'Market', lines: [{ itemId: 'jar', quantity: 3, unitPriceNzd: null }, { itemId: 'wax', quantity: 1.5, unitPriceNzd: 30 }] }, 'body');

const sale: BusinessSale = {
  id: 's1', businessId: 'b', date: '2026-10-01', clientId: 'c1', clientName: 'Hive', invoiceId: null, invoiceNumber: null, transactionId: null, notes: 'n',
  lines: [{ id: 'l1', itemId: 'old', description: 'Old label', quantity: 2, unit: 'each', unitPriceNzd: 5, totalNzd: 10, costNzd: 4 }],
  totalNzd: 10, gstNzd: null, costNzd: 4, grossProfitNzd: 6, countsAsIncome: true, receipt: null, createdAt: '', updatedAt: '',
};
eq(saleDraft(sale, today), { date: '2026-10-01', clientId: 'c1', notes: 'n', lines: [{ itemId: 'old', quantity: '2', price: '5' }] }, 'sale back into the form');
eq(saleDraft(null, today).lines.length, 1, 'new sale starts with one line');

// Archived items: hidden from new sales, kept on a sale that already has them.
eq(itemOptions(list, null).map((i) => i.id), ['wax', 'jar'], 'active items, by name');
eq(itemOptions(list, sale).map((i) => i.id), ['wax', 'jar', 'old'], 'editing keeps the archived line');

eq(receiptLabel(sale), 'No receipt', 'no receipt');
eq(receiptLabel({ ...sale, receipt: { kind: 'issued', number: 'RCT-0004', issuedAt: '', pdfUrl: '' } }), 'Receipt RCT-0004', 'issued');
eq(receiptLabel({ ...sale, receipt: { kind: 'uploaded', url: '', name: 'x' } }), 'Receipt uploaded', 'uploaded');
eq(incomeNote(sale), 'Counted as income on the day', 'cash sale');
eq(incomeNote({ ...sale, invoiceId: 'i', invoiceNumber: 'INV-0002' }), 'Counted through invoice INV-0002', 'invoice sale');
eq(incomeNote({ ...sale, transactionId: 't' }), 'Paid into the bank (the deposit isn’t counted again)', 'deposit sale');

console.log('sales view: ok');
