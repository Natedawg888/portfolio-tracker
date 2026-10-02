/**
 * TODO: Manual GoMining digital-miner snapshots + optional GOMINING token quote refresh.
 * Track miners (TH/s, rarity, level, marketplace estimate) — not GMT alone.
 * Docs: docs/GOMINING.md
 * Token price: CoinGecko API id `gmt-token` (symbol gomining). Never invent prices.
 */

import type { GoMiningMinerSnapshot } from './types';

export function validateMinerSnapshot(_m: GoMiningMinerSnapshot): GoMiningMinerSnapshot {
  // TODO: require hashrateTh >= 0, asOf ISO, null valuations if no source
  throw new Error('TODO: implement validateMinerSnapshot');
}

export function estimateValueFromPricePerTh(
  hashrateTh: number,
  pricePerThGmt: number,
  asOf: string,
  valuationSource: string,
): Pick<GoMiningMinerSnapshot, 'estValueGmt' | 'asOf' | 'valuationSource'> {
  // TODO: pure multiply; caller supplies cited pricePerThGmt from marketplace
  void hashrateTh;
  void pricePerThGmt;
  void asOf;
  void valuationSource;
  throw new Error('TODO: implement estimateValueFromPricePerTh');
}
