/**
 * Economic cycle: the user's mix (KAN-31). Run: npm run test:economy-page
 */
import { cycleMix, formatShare, mixInPhase, mixSentence } from './cycleMix.ts';

function eq(a: unknown, b: unknown, msg: string): void {
  if (a !== b) throw new Error(`FAIL: ${msg} (got ${String(a)}, expected ${String(b)})`);
}

const all = () => true;
const nw = {
  cashNzd: 31000,
  stocksNzd: 40000,
  kiwiSaverNzd: 12000,
  realEstateNzd: 0,
  metalsNzd: 9000,
  cryptoNzd: 5000,
  collectablesNzd: 3000,
  artNzd: null,
  forexNzd: -20, // never counted below zero
};
const mix = cycleMix(nw, all)!;
eq(mix.totalNzd, 100000, 'total of the enabled, positive class values');
eq(mix.covered.map((r) => r.id).join(','), 'equities,cash,commodities', 'largest first; zero classes left out');
eq(mix.covered[0].valueNzd, 52000, 'equities are stocks + KiwiSaver');
eq(mix.covered[0].sharePct, 52, 'share of the total');
eq(mix.notCovered.map((r) => r.label).join(','), 'Crypto,Collectables', 'classes without cycle notes are listed as not covered');
eq(mixSentence(mix), 'Your mix: 52% equities, 31% cash / term deposits, 9% commodities, 8% not covered by these notes.', 'sentence');

const withHouse = cycleMix({ ...nw, realEstateNzd: 600000 }, all)!;
eq(withHouse.covered[0].id, 'property', 'property at full value');
eq(withHouse.covered[0].valueNzd, 600000, 'mortgage is not subtracted');

const noCrypto = cycleMix(nw, (p) => p !== 'crypto' && p !== 'kiwisaver')!;
eq(noCrypto.notCovered.map((r) => r.label).join(','), 'Collectables', 'classes turned off in Settings are left out');
eq(noCrypto.covered[0].valueNzd, 40000, 'KiwiSaver off leaves stocks only');

eq(cycleMix({}, all), null, 'nothing held');
eq(cycleMix({ cashNzd: 0, stocksNzd: null }, all), null, 'zeros and nulls are nothing');

eq(formatShare(52.4), '52%', 'whole percent');
eq(formatShare(0.42), '0.4%', 'one decimal under 1%');
eq(formatShare(0.04), '<0.1%', 'tiny share');

const assets = [
  { id: 'equities', label: 'Equities', tendency: 'positive', explanation: 'Equities note.' },
  { id: 'cash', label: 'Cash / term deposits', tendency: 'neutral', explanation: 'Cash note.' },
];
const paired = mixInPhase(mix, assets);
eq(paired[0].tendency, 'positive', 'equities paired with the phase note');
eq(paired[1].explanation, 'Cash note.', 'cash note');
eq(paired[2].tendency, null, 'a class without a note in the payload stays null');

console.log('cycle mix tests ok');
