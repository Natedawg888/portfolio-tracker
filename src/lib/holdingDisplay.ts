/**
 * Holding shape and display helpers shared by the Portfolio tabs.
 * Values come from the API (quotes × quantity, Akahu notes); nothing is estimated.
 */
import { formatNzd } from '../api/client';
import type { MtgColour } from '../types';
import { parseNzdValueFromNotes } from './holdingValue';

export type Holding = {
  id: string;
  assetClass: string;
  name: string;
  costBasisNzd: number | null;
  minerName?: string;
  hashrateThs?: number;
  energyEfficiencyWth?: number | null;
  rarity?: string | null;
  level?: number | null;
  estimatedValueNzd?: number | null;
  estimatedValueAt?: string | null;
  estimatedValueSource?: string | null;
  asset?: string;
  amount?: number;
  symbol?: string;
  shares?: number;
  exchange?: string | null;
  notes?: string;
  metal?: string;
  unit?: string;
  ownershipPct?: number;
  purchasePriceNzd?: number | null;
  purchaseDate?: string | null;
  lastValuationNzd?: number | null;
  artworkTitle?: string;
  artist?: string;
  artKind?: 'fractional' | 'physical' | null;
  stoneType?: string;
  carat?: number;
  clarity?: string | null;
  cut?: string | null;
  colour?: string | null;
  valuationNzd?: number | null;
  valuationSource?: string | null;
  valuationNotes?: string | null;
  lastValuationAt?: string | null;
  source?: string;
  /** Akahu / Sharesies instrument logo (icons only). */
  logoUrl?: string | null;
  marketValueNzd?: number | null;
  spotPriceNzdPerOzT?: number | null;
  spotAsOf?: string | null;
  /** forex ISO currency (USD/EUR/GBP) */
  currency?: string;
  unitPriceNzd?: number | null;
  quoteAsOf?: string | null;
  quoteNotes?: string | null;
  /** real_estate */
  propertyValueNzd?: number | null;
  mortgageOutstandingNzd?: number | null;
  equityNzd?: number | null;
  photoPath?: string | null;
  photoUrl?: string | null;
  /** collectable */
  cardGame?: string | null;
  cardSet?: string | null;
  cardNumber?: string | null;
  cardFinish?: string | null;
  cardApiId?: string | null;
  cardImageUrl?: string | null;
  cardColours?: MtgColour[] | null;
  cardRarity?: string | null;
  quantity?: number | null;
};

/** Market value in NZD when known — never invent FX or prices. */
export function marketValueNzd(h: Holding): number | null {
  if (h.assetClass === 'gomining_miner' && h.estimatedValueNzd != null && Number.isFinite(h.estimatedValueNzd)) {
    return Number(h.estimatedValueNzd);
  }
  if (h.assetClass === 'art') {
    if (h.lastValuationNzd != null && Number.isFinite(h.lastValuationNzd)) {
      return Number(h.lastValuationNzd);
    }
    if (h.purchasePriceNzd != null && Number.isFinite(h.purchasePriceNzd)) {
      return Number(h.purchasePriceNzd);
    }
    return null;
  }
  if (h.assetClass === 'stone' && h.valuationNzd != null && Number.isFinite(h.valuationNzd)) {
    return Number(h.valuationNzd);
  }
  if (h.assetClass === 'real_estate') {
    // Card Value shows equity (value − mortgage); gross in meta
    if (h.equityNzd != null && Number.isFinite(h.equityNzd)) return Number(h.equityNzd);
    if (h.propertyValueNzd != null && Number.isFinite(h.propertyValueNzd)) {
      const mort = h.mortgageOutstandingNzd != null ? Number(h.mortgageOutstandingNzd) : 0;
      return Number(h.propertyValueNzd) - (Number.isFinite(mort) ? mort : 0);
    }
  }
  if (h.assetClass === 'collectable') {
    if (h.marketValueNzd != null && Number.isFinite(h.marketValueNzd)) return Number(h.marketValueNzd);
    if (h.valuationNzd != null && Number.isFinite(h.valuationNzd)) return Number(h.valuationNzd);
  }
  // Stocks / crypto / metals: prefer API marketValueNzd (Akahu × live FX or Metals.Dev)
  if (h.marketValueNzd != null && Number.isFinite(h.marketValueNzd)) {
    return Number(h.marketValueNzd);
  }
  return parseNzdValueFromNotes(h.notes);
}

/** Display cost: blank/— when unknown; never show fake $0 for Akahu unknowns. */
export function displayCostBasisNzd(h: Holding): number | null {
  const c = h.costBasisNzd;
  if (c == null || !Number.isFinite(c)) {
    if (
      h.assetClass === 'art' &&
      h.purchasePriceNzd != null &&
      Number.isFinite(h.purchasePriceNzd)
    ) {
      return Number(h.purchasePriceNzd);
    }
    return null;
  }
  if (c === 0 && (h.source === 'Sharesies' || h.source === 'Hatch')) return null;
  return c;
}

export function formatAmount(n: number | null | undefined, digits = 6): string {
  if (n == null || Number.isNaN(n)) return '—';
  return new Intl.NumberFormat('en-NZ', {
    maximumFractionDigits: digits,
  }).format(n);
}

export function tickerFor(h: Holding): string {
  if (h.assetClass === 'stock') return (h.symbol ?? h.name).toUpperCase();
  if (h.assetClass === 'crypto') return (h.asset ?? h.name).toUpperCase();
  if (h.assetClass === 'gomining_miner') return 'GM';
  if (h.assetClass === 'metal') return (h.metal ?? 'METAL').toUpperCase().slice(0, 4);
  if (h.assetClass === 'forex') return (h.currency ?? h.asset ?? 'FX').toUpperCase().slice(0, 3);
  if (h.assetClass === 'art') return 'ART';
  if (h.assetClass === 'stone') return (h.stoneType ?? 'ST').toUpperCase().slice(0, 3);
  if (h.assetClass === 'real_estate') return 'RE';
  if (h.assetClass === 'collectable') {
    const g = (h.cardGame ?? 'CARD').toUpperCase();
    return g === 'POKEMON' ? 'PKMN' : g === 'MTG' ? 'MTG' : g.slice(0, 4);
  }
  return h.name.slice(0, 2).toUpperCase();
}

export function displayName(h: Holding): string {
  if (h.assetClass === 'gomining_miner') return h.minerName ?? h.name;
  if (h.assetClass === 'art') return h.artworkTitle ?? h.name;
  if (h.assetClass === 'metal') return h.name || (h.metal ?? 'Metal');
  if (h.assetClass === 'forex') {
    const cur = (h.currency ?? h.asset ?? 'FX').toUpperCase();
    const src = h.source?.trim();
    return h.name || (src ? `${cur} (${src})` : cur);
  }
  if (h.assetClass === 'stone') return h.name || (h.stoneType ?? 'Stone');
  if (h.assetClass === 'real_estate') return h.name || 'Property';
  if (h.assetClass === 'collectable') {
    const bits = [h.name];
    if (h.cardSet) bits.push(String(h.cardSet).toUpperCase());
    if (h.cardNumber) bits.push(`#${h.cardNumber}`);
    return bits.filter(Boolean).join(' · ');
  }
  return h.name;
}

export function amountLabel(h: Holding): string {
  switch (h.assetClass) {
    case 'stock':
      return `${formatAmount(h.shares, 4)} shares`;
    case 'crypto':
      return `${formatAmount(h.amount)} ${h.asset ?? ''}`.trim();
    case 'gomining_miner':
      return `${formatHashrate(h.hashrateThs)} TH/s`;
    case 'metal': {
      const unit = h.unit === 'oz_t' ? 'oz t' : h.unit === 'g' ? 'g' : h.unit ?? '';
      return `${formatAmount(h.amount, 4)} ${unit}`.trim();
    }
    case 'forex': {
      const cur = (h.currency ?? h.asset ?? '').toUpperCase();
      return `${formatAmount(h.amount, 2)} ${cur}`.trim();
    }
    case 'art':
      return h.ownershipPct != null ? `${formatAmount(h.ownershipPct, 2)}% ownership` : '—';
    case 'stone':
      return h.carat != null ? `${formatAmount(h.carat, 3)} ct` : '—';
    case 'real_estate': {
      const pv = h.propertyValueNzd != null ? formatNzd(h.propertyValueNzd) : '—';
      const mort = formatNzd(h.mortgageOutstandingNzd ?? 0);
      return `Value ${pv} · Mortgage ${mort}`;
    }
    case 'collectable': {
      const q = h.quantity ?? h.amount ?? 1;
      const fin = h.cardFinish ? ` · ${h.cardFinish}` : '';
      return `${formatAmount(q, 0)}× ${(h.cardGame ?? 'card').toUpperCase()}${fin}`;
    }
    default:
      return '—';
  }
}

/** TH/s with enough decimals that a tiny miner (0.003 TH/s) never rounds to 0. */
export function formatHashrate(ths: number | null | undefined): string {
  if (ths == null || !Number.isFinite(ths)) return '—';
  const digits = ths > 0 && ths < 0.01 ? 4 : ths < 1 ? 3 : 2;
  return formatAmount(ths, digits);
}
