/**
 * Donations page helpers (KAN-25). Run: npm run test:donations
 */
import { donationBodyFromFields, donationYearLabel, donationYearNotes, emptyDonationFields, fieldsFromDonation } from './donationsView.ts';
import type { Donation, DonationTaxYearTotals } from '../types/index.ts';

function eq(actual: unknown, expected: unknown, msg: string): void {
  if (JSON.stringify(actual) !== JSON.stringify(expected)) throw new Error(`FAIL: ${msg} (got ${JSON.stringify(actual)}, expected ${JSON.stringify(expected)})`);
}

eq(donationYearLabel(2027), '2026/27', 'end year 2027 is 2026/27');
eq(donationYearLabel(2100), '2099/00', 'century');

const f = { ...emptyDonationFields('2026-11-23'), recipient: '  Red Cross ', amount: '$1,200.50', notes: ' ' };
const ok = donationBodyFromFields(f);
eq(ok.ok && ok.body, { date: '2026-11-23', recipient: 'Red Cross', amountNzd: 1200.5, notes: null, evidenceUrl: null }, 'trimmed, $ and commas stripped');
eq(donationBodyFromFields({ ...f, recipient: ' ' }).ok, false, 'recipient required');
eq(donationBodyFromFields({ ...f, amount: '0' }).ok, false, 'amount over 0');
eq(donationBodyFromFields({ ...f, amount: 'abc' }).ok, false, 'amount a number');
eq(donationBodyFromFields({ ...f, date: '' }).ok, false, 'date required');
eq(donationBodyFromFields({ ...f, evidenceUrl: 'ftp://x' }).ok, false, 'link must be http(s)');
eq(donationBodyFromFields({ ...f, evidenceUrl: 'https://charity.org.nz/r/1' }).ok, true, 'https link fine');

const d = { id: 'd1', date: '2026-05-01', recipient: 'SPCA', amountNzd: 50, notes: null, evidenceUrl: null } as Donation;
eq(fieldsFromDonation(d), { date: '2026-05-01', recipient: 'SPCA', amount: '50', notes: '', evidenceUrl: '' }, 'edit fields');

const year = { belowMinimumCount: 2, minimumDonationNzd: 5, eligibleCapApplied: true, eligibleCapNzd: 100000 } as DonationTaxYearTotals;
const notes = donationYearNotes(year);
eq(notes.length, 2, 'under $5 and cap notes');
eq(notes[0].startsWith('2 gifts were under $5'), true, 'under $5 note');
eq(donationYearNotes({ ...year, belowMinimumCount: 0, eligibleCapApplied: false }).length, 0, 'nothing to say');

console.log('donationsView.test.ts ok');
