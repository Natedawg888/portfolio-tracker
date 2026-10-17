/**
 * Crypto mining type and provider (KAN-85). Run: npm run test:crypto-mining
 */
import { GOMINING, isGoMiningMiner, minerProvider, minerType, parseMiningTag, providerLabel } from './miningProviders.ts';

function eq(actual: unknown, expected: unknown, msg: string): void {
  if (actual !== expected) throw new Error(`FAIL: ${msg} (got ${String(actual)}, expected ${String(expected)})`);
}

// Rows saved before KAN-85 have no type or provider: they were GoMining cloud miners.
eq(minerType({}), 'cloud', 'untyped → cloud');
eq(minerProvider({}), GOMINING, 'untyped → GoMining');
eq(isGoMiningMiner({ miningType: null, miningProvider: null }), true, 'legacy row is GoMining');

// Hardware never has a provider, even if one was stored.
eq(minerProvider({ miningType: 'hardware', miningProvider: 'gomining' }), null, 'hardware has no provider');
eq(isGoMiningMiner({ miningType: 'hardware' }), false, 'hardware is not GoMining');

// Another cloud provider keeps its typed name.
eq(minerProvider({ miningType: 'cloud', miningProvider: 'NiceHash' }), 'NiceHash', 'typed provider');
eq(isGoMiningMiner({ miningType: 'cloud', miningProvider: 'NiceHash' }), false, 'not GoMining');
eq(providerLabel('gomining'), 'GoMining', 'listed label');
eq(providerLabel('NiceHash'), 'NiceHash', 'typed label');
eq(providerLabel(null), null, 'no provider');

// Parsing request bodies.
let t = parseMiningTag('hardware', 'gomining');
eq(t.ok && t.miningType === 'hardware' && t.miningProvider === null, true, 'hardware drops provider');
t = parseMiningTag(undefined, undefined);
eq(t.ok && t.miningType === 'cloud' && t.miningProvider === GOMINING, true, 'default is GoMining cloud');
t = parseMiningTag('cloud', ' GOMINING ');
eq(t.ok && t.miningProvider === GOMINING, true, 'listed provider matched by label, any case');
t = parseMiningTag('cloud', 'Hashing24');
eq(t.ok && t.miningProvider === 'Hashing24', true, 'unlisted provider kept as typed');
t = parseMiningTag('cloud', 'x'.repeat(80));
eq(t.ok && t.miningProvider?.length, 60, 'provider name capped');
eq(parseMiningTag('asic', null).ok, false, 'unknown type rejected');

console.log('crypto mining provider tests passed');
