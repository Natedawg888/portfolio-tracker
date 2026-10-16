/**
 * The user's own mix for the Economic cycle page (KAN-31). Class totals come from
 * the signed-in user's net worth, the same figures as Portfolio. Only classes turned
 * on in Settings count. Nothing is estimated and nothing here forecasts returns.
 *
 * Mapping to the cycle's asset notes:
 *   Equities    stocks + KiwiSaver
 *   Property    full property value (before the mortgage)
 *   Cash        bank and wallet balances, plus term deposits held in Bonds (KAN-80)
 *   Commodities metals
 *   Bonds       government and corporate bonds (KAN-80)
 * Crypto, GoMining, collectables, art, precious stones and forex have no cycle
 * notes; they are listed as not covered.
 */

export type CycleClassId = 'equities' | 'property' | 'bonds' | 'cash' | 'commodities';

export type MixRow = { label: string; valueNzd: number; sharePct: number };
export type CoveredRow = MixRow & { id: CycleClassId };
export type CycleMix = { totalNzd: number; covered: CoveredRow[]; notCovered: MixRow[] };

export type NetWorthTotals = {
  cashNzd?: number | null;
  stocksNzd?: number | null;
  kiwiSaverNzd?: number | null;
  realEstateNzd?: number | null;
  metalsNzd?: number | null;
  cryptoNzd?: number | null;
  gominingMinersNzd?: number | null;
  collectablesNzd?: number | null;
  artNzd?: number | null;
  stonesNzd?: number | null;
  forexNzd?: number | null;
  /** Bonds and term deposits together (KAN-80), and the term-deposit part of it. */
  bondsNzd?: number | null;
  bondsTermDepositsNzd?: number | null;
  /** Derived here: bondsNzd − bondsTermDepositsNzd. */
  bondsOnlyNzd?: number | null;
};

const LABELS: Record<CycleClassId, string> = {
  equities: 'Equities',
  property: 'Property',
  bonds: 'Bonds',
  cash: 'Cash / term deposits',
  commodities: 'Commodities',
};

/** Each part: which net-worth figure, which Settings toggle, and where it goes. */
const PARTS: Array<{ field: keyof NetWorthTotals; pref: string; to: CycleClassId | { notCovered: string } }> = [
  { field: 'stocksNzd', pref: 'stock', to: 'equities' },
  { field: 'kiwiSaverNzd', pref: 'kiwisaver', to: 'equities' },
  { field: 'realEstateNzd', pref: 'real_estate', to: 'property' },
  { field: 'cashNzd', pref: 'cash', to: 'cash' },
  { field: 'metalsNzd', pref: 'metal', to: 'commodities' },
  { field: 'bondsOnlyNzd', pref: 'bonds', to: 'bonds' },
  { field: 'bondsTermDepositsNzd', pref: 'bonds', to: 'cash' },
  { field: 'cryptoNzd', pref: 'crypto', to: { notCovered: 'Crypto' } },
  { field: 'gominingMinersNzd', pref: 'gomining', to: { notCovered: 'GoMining' } },
  { field: 'collectablesNzd', pref: 'collectable', to: { notCovered: 'Collectables' } },
  { field: 'artNzd', pref: 'art', to: { notCovered: 'Art' } },
  { field: 'stonesNzd', pref: 'stone', to: { notCovered: 'Precious stones' } },
  { field: 'forexNzd', pref: 'forex', to: { notCovered: 'Forex' } },
];

function positive(v: number | null | undefined): number {
  return v != null && Number.isFinite(v) && v > 0 ? v : 0;
}

/** The user's mix, or null when nothing enabled has a value. Rows are largest first; zero rows are left out. */
export function cycleMix(nwIn: NetWorthTotals, enabled: (pref: string) => boolean): CycleMix | null {
  const nw: NetWorthTotals = { ...nwIn, bondsOnlyNzd: (nwIn.bondsNzd ?? 0) - (nwIn.bondsTermDepositsNzd ?? 0) };
  const covered = new Map<CycleClassId, number>();
  const notCovered = new Map<string, number>();
  for (const part of PARTS) {
    if (!enabled(part.pref)) continue;
    const v = positive(nw[part.field]);
    if (v === 0) continue;
    if (typeof part.to === 'string') covered.set(part.to, (covered.get(part.to) ?? 0) + v);
    else notCovered.set(part.to.notCovered, (notCovered.get(part.to.notCovered) ?? 0) + v);
  }
  const totalNzd = [...covered.values(), ...notCovered.values()].reduce((s, v) => s + v, 0);
  if (totalNzd <= 0) return null;
  const share = (v: number) => (v / totalNzd) * 100;
  const byValue = <T extends MixRow>(a: T, b: T) => b.valueNzd - a.valueNzd || a.label.localeCompare(b.label);
  return {
    totalNzd,
    covered: [...covered].map(([id, v]) => ({ id, label: LABELS[id], valueNzd: v, sharePct: share(v) })).sort(byValue),
    notCovered: [...notCovered].map(([label, v]) => ({ label, valueNzd: v, sharePct: share(v) })).sort(byValue),
  };
}

/** "52%", "0.4%" or "<0.1%" for tiny shares. */
export function formatShare(pct: number): string {
  if (pct > 0 && pct < 0.1) return '<0.1%';
  return pct < 1 ? `${pct.toFixed(1)}%` : `${Math.round(pct)}%`;
}

/** "Your mix: 52% equities, 31% cash / term deposits, 9% commodities, 8% not covered by these notes." */
export function mixSentence(mix: CycleMix): string {
  const parts = mix.covered.map((r) => `${formatShare(r.sharePct)} ${r.label.toLowerCase()}`);
  const other = mix.notCovered.reduce((s, r) => s + r.sharePct, 0);
  if (other > 0) parts.push(`${formatShare(other)} not covered by these notes`);
  return `Your mix: ${parts.join(', ')}.`;
}

/** Covered rows paired with the selected phase's note for that class (same ids as the cycle payload). */
export function mixInPhase<A extends { id: string; tendency: string; explanation: string }>(
  mix: CycleMix,
  assets: ReadonlyArray<A>,
): Array<CoveredRow & { tendency: string | null; explanation: string | null }> {
  return mix.covered.map((row) => {
    const note = assets.find((a) => a.id === row.id);
    return { ...row, tendency: note?.tendency ?? null, explanation: note?.explanation ?? null };
  });
}
