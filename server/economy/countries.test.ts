/**
 * The country list is the only place a new country is registered.
 * Run: npm run test:economy
 */
import assert from 'node:assert/strict';
import { economyCountry, listEconomyCountries, requireEconomyCountry } from './countries.ts';

const codes = listEconomyCountries().map((country) => country.code);
assert.deepEqual(codes, ['NZ', 'US']);
assert.equal(requireEconomyCountry(undefined).code, 'NZ');
assert.equal(requireEconomyCountry('us').name, 'United States');
assert.equal(economyCountry('FR'), null);
assert.throws(() => requireEconomyCountry('FR'), /Received FR/);

console.log('country list tests passed');
