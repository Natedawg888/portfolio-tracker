/**
 * Warranties header counts (phase 1). Run: npm run test:warranties
 */
import { warrantiesSubtitle } from './warrantiesView.ts';

function eq(a: unknown, b: unknown, msg: string): void {
  if (a !== b) throw new Error(`FAIL: ${msg} (got ${String(a)}, expected ${String(b)})`);
}

const days = 60;

eq(
  warrantiesSubtitle({ active: 3, expiring: 1, expired: 2 }, days),
  '3 covered · 1 ending in 60 days · 2 expired',
  'disjoint counts: covered is active only',
);
eq(
  warrantiesSubtitle({ active: 4, expiring: 1, expired: 0 }, days),
  '4 covered · 1 ending in 60 days · 0 expired',
  'active is not added to expiring',
);
eq(
  warrantiesSubtitle({ active: 1, expiring: 0, expired: 0 }, days),
  '1 covered · 0 ending in 60 days · 0 expired',
  'one covered',
);
eq(
  warrantiesSubtitle({ active: 0, expiring: 1, expired: 1 }, days),
  '0 covered · 1 ending in 60 days · 1 expired',
  'one ending and one expired',
);
eq(
  warrantiesSubtitle({ active: 0, expiring: 0, expired: 0 }, days),
  '0 covered · 0 ending in 60 days · 0 expired',
  'zeros stay visible',
);
eq(
  warrantiesSubtitle({ active: 2, expiring: 2, expired: 2 }, 1),
  '2 covered · 2 ending in 1 day · 2 expired',
  'one day in the window',
);
eq(
  warrantiesSubtitle({ active: Number.NaN, expiring: -3, expired: 1.9 }, Number.POSITIVE_INFINITY),
  '0 covered · 0 ending in 0 days · 1 expired',
  'non-counts become zero; a fractional expired count floors',
);

console.log('warranties view tests ok');
