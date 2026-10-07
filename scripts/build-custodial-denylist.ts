/**
 * Regenerate server/lib/custodialAddresses.json (KAN-69).
 *
 * Sources:
 *  - Binance proof-of-reserves wallet list (public, no key).
 *  - server/lib/custodialAddresses.manual.json: hand-checked addresses for custodians
 *    that don't publish a machine-readable list. Check each on an explorer first and
 *    record where it came from in `source`.
 *
 * Every address is normalised with the same validators Add Wallet uses; invalid ones
 * are dropped and reported. Nothing is written if a fetch fails.
 *
 * Run: npm run denylist:update   (review the diff, then commit)
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import type { WalletFamily } from '../server/lib/walletAddress.ts';
import {
  DENYLIST_PATH,
  custodialKey,
  type CustodialEntry,
  type CustodialFile,
} from '../server/lib/custodialDenylist.ts';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const MANUAL_PATH = path.join(ROOT, 'server/lib/custodialAddresses.manual.json');

const BINANCE_POR_URL = 'https://www.binance.com/bapi/apex/v1/public/apex/market/por/address';

/** Binance network codes → our address family. Other chains aren't supported by Add Wallet. */
const BINANCE_FAMILY: Record<string, WalletFamily> = {
  BTC: 'bitcoin',
  ETH: 'evm',
  MATIC: 'evm',
  ARBITRUM: 'evm',
  BASE: 'evm',
  SOL: 'solana',
};

type BinanceRow = { network: string; address: string; thirdPartyCustodianName?: string };

async function fetchBinance(): Promise<CustodialEntry[]> {
  const res = await fetch(BINANCE_POR_URL, {
    headers: { 'user-agent': 'Mozilla/5.0', accept: 'application/json' },
    signal: AbortSignal.timeout(30_000),
  });
  if (!res.ok) throw new Error(`Binance proof-of-reserves: HTTP ${res.status}`);
  const body = (await res.json()) as { data?: BinanceRow[] };
  if (!Array.isArray(body.data)) throw new Error('Binance proof-of-reserves: missing data array');
  return body.data.flatMap((r) => {
    const family = BINANCE_FAMILY[r.network?.toUpperCase()];
    if (!family || !r.address) return [];
    const custodian = r.thirdPartyCustodianName ? `Binance (${r.thirdPartyCustodianName})` : 'Binance';
    return [{ family, address: r.address, custodian, source: 'binance-por' }];
  });
}

function readManual(): CustodialEntry[] {
  const file = JSON.parse(fs.readFileSync(MANUAL_PATH, 'utf8')) as { addresses: CustodialEntry[] };
  return file.addresses;
}

async function main() {
  const fetchedAt = new Date().toISOString();
  const raw = [...(await fetchBinance()), ...readManual()];

  const byKey = new Map<string, CustodialEntry>();
  const rejected: CustodialEntry[] = [];
  for (const e of raw) {
    const key = custodialKey(e.family, e.address);
    if (!key) {
      rejected.push(e);
      continue;
    }
    // Store the canonical form so the file diff is stable; manual entries win on conflict.
    const address = key.slice(e.family.length + 1);
    byKey.set(key, { family: e.family, address, custodian: e.custodian, source: e.source });
  }
  const addresses = [...byKey.values()].sort(
    (a, b) => a.family.localeCompare(b.family) || a.address.localeCompare(b.address),
  );

  const out: CustodialFile = {
    updatedAt: fetchedAt,
    sources: {
      'binance-por': { url: BINANCE_POR_URL, fetchedAt },
      manual: { url: 'server/lib/custodialAddresses.manual.json', fetchedAt },
    },
    addresses,
  };
  fs.writeFileSync(DENYLIST_PATH, `${JSON.stringify(out, null, 2)}\n`);

  const counts = addresses.reduce<Record<string, number>>((acc, e) => {
    acc[e.family] = (acc[e.family] ?? 0) + 1;
    return acc;
  }, {});
  console.log(`Wrote ${addresses.length} addresses to ${path.relative(ROOT, DENYLIST_PATH)}`, counts);
  for (const e of rejected) console.warn(`  skipped invalid ${e.family} address from ${e.source}: ${e.address}`);
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
