/**
 * Link Budget Charity transactions to PAYE IR526 donation tax credits (localStorage prefs).
 */
import {
  loadPayePrefs,
  savePayePrefs,
  type CharityDonationLink,
  type PayePrefs,
} from './payePrefs';

export const CHARITY_CATEGORY_ID = 'cat-charity';

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

function sumLinks(links: CharityDonationLink[]): number {
  return round2(links.reduce((s, l) => s + Math.max(0, Number(l.amountNzd) || 0), 0));
}

function applyLinksToPrefs(prefs: PayePrefs, links: CharityDonationLink[]): PayePrefs {
  const next = { ...prefs, charityLinks: links };
  const total = sumLinks(links);
  if (links.length > 0) {
    next.charityDonationsOn = true;
    next.charityDonationsAnnual = String(total);
  } else {
    // Keep On flag / manual annual if user cleared all Budget links — leave annual as-is.
  }
  return next;
}

/** Add or replace a charity donation linked from a Budget transaction. */
export function linkCharityDonationToPaye(input: {
  txnId: string;
  amountNzd: number;
  date: string;
  description: string;
  receiptUrl?: string | null;
}): PayePrefs {
  const prefs = loadPayePrefs();
  const amount = round2(Math.abs(Number(input.amountNzd) || 0));
  const link: CharityDonationLink = {
    txnId: input.txnId,
    amountNzd: amount,
    date: input.date,
    description: (input.description || '').trim() || 'Charity donation',
    receiptUrl: input.receiptUrl ?? null,
  };
  const links = prefs.charityLinks.filter((l) => l.txnId !== input.txnId);
  links.push(link);
  links.sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));
  const next = applyLinksToPrefs(prefs, links);
  savePayePrefs(next);
  return next;
}

/** Remove a Budget txn from PAYE charity links (e.g. category changed away / deleted). */
export function unlinkCharityDonationFromPaye(txnId: string): PayePrefs {
  const prefs = loadPayePrefs();
  const links = prefs.charityLinks.filter((l) => l.txnId !== txnId);
  const next = applyLinksToPrefs(prefs, links);
  // If links remain, annual is the sum; if empty, leave annual/on as last user values
  // but if we just unlinked the last one that drove the sum, reset annual to 0 only when
  // it matched the previous sum (avoid wiping a manually typed figure).
  if (links.length === 0) {
    const prevSum = sumLinks(prefs.charityLinks);
    const annual = Number(prefs.charityDonationsAnnual) || 0;
    if (Math.abs(annual - prevSum) < 0.005) {
      next.charityDonationsAnnual = '0';
    }
  }
  savePayePrefs(next);
  return next;
}

export function charityLinksTotal(prefs?: PayePrefs): number {
  const p = prefs ?? loadPayePrefs();
  return sumLinks(p.charityLinks);
}
