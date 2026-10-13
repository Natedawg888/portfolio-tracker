/**
 * Warranties header counts (phase 1). Run: npm run test:warranties
 */
import {
  COVER_OPTIONS,
  WARRANTY_STATUS_LABELS,
  coverChoiceFor,
  coverEndDate,
  coverLine,
  longDate,
  saveBlocker,
  timeLeftText,
  warrantiesHeaderLine,
  warrantiesSubtitle,
  type CoverChoice,
} from './warrantiesView.ts';

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

eq(warrantiesHeaderLine(0, { active: 0, expiring: 0, expired: 0 }, days), 'What you bought, and when the cover ends', 'no counts before the first warranty');
eq(warrantiesHeaderLine(6, { active: 3, expiring: 1, expired: 2 }, days), '3 covered · 1 ending in 60 days · 2 expired', 'counts once there are warranties');
eq(WARRANTY_STATUS_LABELS.expiring, 'Ending soon', 'ending soon wording');

// Add form (phase 2).
const today = '2026-10-13';
eq(longDate('2027-10-08'), '8 Oct 2027', 'long date');
eq(timeLeftText(today, today), 'Ends today', 'ends today');
eq(timeLeftText('2026-10-14', today), '1 day left', 'one day');
eq(timeLeftText('2026-12-11', today), '59 days left', 'days under 60');
eq(timeLeftText('2026-12-12', today), '1 month left', '60 days is a month');
eq(timeLeftText('2027-10-12', today), '11 months left', 'months under 2 years');
eq(timeLeftText('2028-10-11', today), '23 months left', '729 days still months');
eq(timeLeftText('2028-10-12', today), '2.0 years left', '730 days is years');
eq(timeLeftText('2031-10-12', today), '5.0 years left', 'five years');
eq(timeLeftText('2026-10-12', today), 'Ended 1 day ago', 'ended one day ago');
eq(timeLeftText('2026-09-13', today), 'Ended 30 days ago', 'ended days ago');
eq(COVER_OPTIONS.map((o) => o.label).join(','), '6 months,1 year,2 years,3 years,5 years,Custom', 'cover options');

const preset = (cover: string): CoverChoice => ({ cover, customBy: 'months', customMonths: '', endsOn: '' });
eq(coverEndDate(today, preset('12')), '2027-10-12', '1 year from today');
eq(coverEndDate('', preset('12')), '', 'no date yet');
eq(coverEndDate(today, { cover: 'custom', customBy: 'months', customMonths: '18', endsOn: '' }), '2028-04-12', 'custom 18 months');
eq(coverEndDate(today, { cover: 'custom', customBy: 'months', customMonths: '1.5', endsOn: '' }), '', 'whole months only');
eq(coverEndDate(today, { cover: 'custom', customBy: 'date', customMonths: '', endsOn: '2027-01-31' }), '2027-01-31', 'custom end date');
eq(coverLine('2027-10-12', today), 'Covered until 12 Oct 2027 · 11 months left', 'live cover line');
eq(coverLine('2025-03-01', today), 'Cover ended 1 Mar 2025 · Ended 591 days ago', 'already ended');

const form = { itemName: 'TV', startsOn: today, price: '', ...preset('12') };
eq(saveBlocker(form), null, 'ready to save');
eq(saveBlocker({ ...form, itemName: '  ' }), 'Add what it is to save', 'item needed');
eq(saveBlocker({ ...form, startsOn: '' }), 'Add the date you bought it', 'date needed');
eq(saveBlocker({ ...form, cover: 'custom', customBy: 'months', customMonths: '' }), 'Enter cover length in whole months (1–600)', 'months needed');
eq(saveBlocker({ ...form, cover: 'custom', customBy: 'date', endsOn: '' }), 'Pick the day cover ends', 'end date needed');
eq(saveBlocker({ ...form, cover: 'custom', customBy: 'date', endsOn: '2026-10-01' }), 'Cover can’t end before you bought it', 'end before start');
eq(saveBlocker({ ...form, price: '-5' }), 'Price must be 0 or more', 'negative price');
eq(saveBlocker({ ...form, price: '1299' }), null, 'price ok');
eq(coverChoiceFor('2026-10-09', '2027-10-08').cover, '12', 'saved 1 year shows the preset');
eq(coverChoiceFor('2026-10-09', '2027-11-30').cover, 'custom', 'other end date is custom');
eq(coverChoiceFor('2026-10-09', '2027-11-30').customBy, 'date', 'custom by date');

console.log('warranties view tests ok');
