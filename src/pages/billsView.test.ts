/**
 * Bills header counts (phase 1). Run: npm run test:bills
 */
import { billsSubtitle, headerCounts } from './billsView.ts';

function eq(a: unknown, b: unknown, msg: string): void {
  if (a !== b) throw new Error(`FAIL: ${msg} (got ${String(a)}, expected ${String(b)})`);
}

const counts = headerCounts([
  { status: 'active' },
  { status: 'active' },
  { status: 'paused' },
  { status: 'cancelled' },
  { status: 'other' },
]);
eq(counts.active, 2, 'active');
eq(counts.paused, 1, 'paused stays separate from cancelled');
eq(counts.cancelled, 1, 'cancelled is not folded into paused');
eq(billsSubtitle(counts), '2 active · 1 paused · found in your transactions or added by you', 'subtitle');
eq(billsSubtitle(headerCounts([])), '0 active · 0 paused · found in your transactions or added by you', 'empty list');

console.log('bills header tests ok');
