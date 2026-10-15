/**
 * Splits and settle-up maths (KAN-77 phase 3). Pure: no database, no clock.
 * All money is handled in whole cents so shares always add up to the total exactly.
 */

export type SplitMethod = 'equal' | 'percent' | 'amount';
export type SplitEntry = { memberId: string; value?: number };
export type ShareResult = { ok: true; shares: { memberId: string; amountNzd: number }[] } | { ok: false; error: string };

const cents = (n: number) => Math.round(n * 100);

/**
 * Each member's share of `totalNzd`.
 * - equal: the members listed, evenly; leftover cents go to the first members listed.
 * - percent: value = percent; must add up to 100; leftover cents go to the largest shares.
 * - amount: value = dollars; must add up to the total exactly.
 */
export function splitShares(totalNzd: number, method: SplitMethod, entries: SplitEntry[]): ShareResult {
  const total = cents(totalNzd);
  if (!(total > 0)) return { ok: false, error: 'Only money spent can be split' };
  const ids = entries.map((e) => e.memberId);
  if (ids.length < 2) return { ok: false, error: 'Choose at least two people to split between' };
  if (new Set(ids).size !== ids.length) return { ok: false, error: 'Each person can only appear once' };

  let out: number[];
  if (method === 'equal') {
    const base = Math.floor(total / ids.length);
    const extra = total - base * ids.length;
    out = ids.map((_, i) => base + (i < extra ? 1 : 0));
  } else if (method === 'percent') {
    const pct = entries.map((e) => Number(e.value));
    if (pct.some((p) => !Number.isFinite(p) || p < 0)) return { ok: false, error: 'Percentages must be 0 or more' };
    const sum = pct.reduce((s, p) => s + p, 0);
    if (Math.abs(sum - 100) > 0.001) return { ok: false, error: `Percentages must add up to 100 (they add up to ${Math.round(sum * 100) / 100})` };
    const raw = pct.map((p) => (total * p) / 100);
    out = raw.map((r) => Math.floor(r));
    let left = total - out.reduce((s, c) => s + c, 0);
    // Largest remainders first, then list order, so the result is stable.
    const order = raw.map((r, i) => ({ i, rem: r - Math.floor(r) })).sort((a, b) => b.rem - a.rem || a.i - b.i);
    for (let k = 0; left > 0; k = (k + 1) % order.length, left -= 1) out[order[k].i] += 1;
  } else if (method === 'amount') {
    const amounts = entries.map((e) => Number(e.value));
    if (amounts.some((a) => !Number.isFinite(a) || a < 0)) return { ok: false, error: 'Amounts must be 0 or more' };
    out = amounts.map(cents);
    const sum = out.reduce((s, c) => s + c, 0);
    if (sum !== total) return { ok: false, error: `Amounts must add up to ${(total / 100).toFixed(2)} (they add up to ${(sum / 100).toFixed(2)})` };
  } else {
    return { ok: false, error: 'Choose how to split it' };
  }
  return { ok: true, shares: ids.map((memberId, i) => ({ memberId, amountNzd: out[i] / 100 })) };
}

export type SplitRecord = { payerId: string; shares: { memberId: string; amountNzd: number }[] };
export type Settlement = { fromId: string; toId: string; amountNzd: number };

/**
 * Net balance per person: positive = is owed money, negative = owes money.
 * A split: the payer is owed everyone else's share. A settlement: `from` paid `to`.
 */
export function balances(splits: SplitRecord[], settlements: Settlement[]): Map<string, number> {
  const net = new Map<string, number>();
  const add = (id: string, c: number) => net.set(id, (net.get(id) ?? 0) + c);
  for (const s of splits) {
    for (const sh of s.shares) {
      if (sh.memberId === s.payerId) continue;
      const c = cents(sh.amountNzd);
      add(s.payerId, c);
      add(sh.memberId, -c);
    }
  }
  for (const p of settlements) {
    const c = cents(p.amountNzd);
    add(p.fromId, c);
    add(p.toId, -c);
  }
  return new Map([...net].map(([id, c]) => [id, c / 100]));
}

/** Fewest payments that settle everyone: largest debtor pays largest creditor, repeatedly. */
export function settleUp(net: Map<string, number>): Settlement[] {
  const owe = [...net].filter(([, v]) => v < -0.004).map(([id, v]) => ({ id, c: -cents(v) }));
  const owed = [...net].filter(([, v]) => v > 0.004).map(([id, v]) => ({ id, c: cents(v) }));
  const out: Settlement[] = [];
  const byDesc = (a: { id: string; c: number }, b: { id: string; c: number }) => b.c - a.c || a.id.localeCompare(b.id);
  while (owe.length && owed.length) {
    owe.sort(byDesc);
    owed.sort(byDesc);
    const d = owe[0];
    const r = owed[0];
    const pay = Math.min(d.c, r.c);
    out.push({ fromId: d.id, toId: r.id, amountNzd: pay / 100 });
    d.c -= pay;
    r.c -= pay;
    if (d.c === 0) owe.shift();
    if (r.c === 0) owed.shift();
  }
  return out;
}
