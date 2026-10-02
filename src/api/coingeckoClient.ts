/**
 * TODO: CoinGecko simple price helper for GOMINING (+ optional BTC).
 * Docs: docs/GOMINING.md
 * API id for GoMining Token is `gmt-token` (verify via /search if unsure).
 * On HTTP/rate-limit failure → return status unavailable; never invent prices.
 */

export type CoingeckoPriceStatus = 'ok' | 'unavailable';

export interface CoingeckoSimplePrice {
  id: string;
  usd: number | null;
  nzd: number | null;
  status: CoingeckoPriceStatus;
  asOf: string;
  source: 'coingecko';
}

export async function fetchSimplePrice(_ids: string[]): Promise<CoingeckoSimplePrice[]> {
  // TODO: GET https://api.coingecko.com/api/v3/simple/price?ids=...&vs_currencies=usd,nzd
  throw new Error('TODO: implement fetchSimplePrice');
}

export async function fetchGominingTokenPrice(): Promise<CoingeckoSimplePrice> {
  // TODO: fetchSimplePrice(['gmt-token'])[0]
  throw new Error('TODO: implement fetchGominingTokenPrice');
}
