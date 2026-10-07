/**
 * Custodial / exchange address denylist tests (KAN-69).
 * Run: npm run test:wallets
 */
import fs from 'node:fs';
import {
  DENYLIST_PATH,
  buildDenylist,
  custodialKey,
  custodialMessage,
  findCustodialAddress,
  type CustodialEntry,
  type CustodialFile,
} from './custodialDenylist.ts';
import { toChecksumAddress, validateWalletAddress, type WalletNetwork } from './walletAddress.ts';

function assert(cond: unknown, msg: string): void {
  if (!cond) throw new Error(`FAIL: ${msg}`);
}

let passed = 0;
function check(cond: unknown, msg: string) {
  assert(cond, msg);
  passed++;
}

// The shipped file loads, every entry is a valid address, and it covers each family.
const file = JSON.parse(fs.readFileSync(DENYLIST_PATH, 'utf8')) as CustodialFile;
const shipped = buildDenylist(file.addresses);
check(shipped.size > 0, 'shipped denylist is not empty');
for (const family of ['evm', 'bitcoin', 'solana'] as const) {
  check(file.addresses.some((e) => e.family === family), `shipped denylist has ${family} entries`);
}
check(
  file.addresses.every((e) => e.source && file.sources[e.source]),
  'every shipped entry names a known source',
);

// Fixture list so these tests don't depend on what the exchanges publish today.
const EVM = '0x18e226459ccf0eec276514a4fd3b226d8961e4d1';
const BTC_LEGACY = '12VuUfQHTGqWDvBzm8TBad1mZBm4hjGEzN';
const BTC_BECH32 = 'bc1qrp33g0q5c5txsp9arysrx4k6zdkfs4nce4xj0gdcccefvpysxf3qccfmv3';
const SOL = '28nYGHJyUVcVdxZtzKByBXEj127XnrUkrE3VaGuWj1ZU';
const entries: CustodialEntry[] = [
  { family: 'evm', address: EVM, custodian: 'Binance', source: 'test' },
  { family: 'bitcoin', address: BTC_LEGACY, custodian: 'Binance', source: 'test' },
  { family: 'bitcoin', address: BTC_BECH32, custodian: 'Example Exchange', source: 'test' },
  { family: 'solana', address: SOL, custodian: 'Binance', source: 'test' },
];
const list = buildDenylist(entries);

/** Mirrors the route: validate + normalise, then look up. */
function blocked(network: WalletNetwork, raw: string): string | null {
  const r = validateWalletAddress(network, raw);
  assert(r.ok, `${network} ${raw} should be a valid address`);
  return r.ok ? (findCustodialAddress(network, r.address, list)?.custodian ?? null) : null;
}

// One EVM entry covers every EVM network, in any case form.
for (const network of ['ethereum', 'polygon', 'base', 'arbitrum'] as const) {
  check(blocked(network, EVM) === 'Binance', `evm lowercase blocked on ${network}`);
}
check(blocked('ethereum', toChecksumAddress(EVM.slice(2))) === 'Binance', 'evm checksummed blocked');
check(blocked('ethereum', EVM.toUpperCase().replace('0X', '0x')) === 'Binance', 'evm uppercase blocked');

check(blocked('bitcoin', BTC_LEGACY) === 'Binance', 'btc legacy blocked');
check(blocked('bitcoin', BTC_BECH32.toUpperCase()) === 'Example Exchange', 'btc bech32 uppercase blocked');
check(blocked('solana', SOL) === 'Binance', 'solana blocked');
check(blocked('solana', ` ${SOL} `) === 'Binance', 'solana with surrounding whitespace blocked');

// Self-custody addresses still pass.
check(blocked('ethereum', '0x52908400098527886E0F7030069857D2E4169EE7') === null, 'self-custody evm passes');
check(blocked('bitcoin', '1A1zP1eP5QGefi2DMPTfTL5SLmv7DivfNa') === null, 'self-custody btc passes');
check(blocked('bitcoin', 'bc1qw508d6qejxtdg4y5r3zarvary0c5xw7kv8f3t4') === null, 'self-custody bech32 passes');
check(blocked('solana', 'So11111111111111111111111111111111111111112') === null, 'self-custody solana passes');

// Base58 is case-sensitive: a different-case legacy address is a different key.
check(custodialKey('bitcoin', BTC_LEGACY.toLowerCase()) !== custodialKey('bitcoin', BTC_LEGACY), 'base58 case matters');

// A typo in the data file fails loudly instead of never matching.
let threw = false;
try {
  buildDenylist([{ family: 'evm', address: '0x1234', custodian: 'Typo', source: 'test' }]);
} catch {
  threw = true;
}
check(threw, 'invalid entry throws');

// The message names the custodian and points to the manual holding.
const msg = custodialMessage(entries[0]);
check(msg.includes('Binance') && msg.includes('manual crypto holding'), 'message names custodian + manual flow');

console.log(`custodialDenylist: ${passed} passed`);
