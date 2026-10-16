/**
 * Projections leave out asset classes hidden in Settings. Run: npm run test:projections
 * Uses a throwaway data dir. Does not touch data/.
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'pt-proj-hidden-'));
process.env.DATABASE_PATH = path.join(dataDir, 'portfolio.db');

function eq(actual: unknown, expected: unknown, msg: string): void {
  if (actual !== expected) throw new Error(`FAIL: ${msg} (got ${String(actual)}, expected ${String(expected)})`);
}

const { classStartValues, withoutHiddenClasses } = await import('./load.ts');
const { defaultAssetClassPrefs } = await import('../../src/lib/assetClassPrefs.ts');

const nw = {
  cashNzd: 1200.5,
  stocksNzd: 115.62,
  kiwiSaverNzd: 5000,
  cryptoNzd: 60,
  gominingMinersNzd: null,
  metalsNzd: null,
  realEstateNzd: 240000,
  bondsNzd: null,
  artNzd: 300,
  stonesNzd: null,
  collectablesNzd: 50,
  forexNzd: 25,
} as unknown as Parameters<typeof classStartValues>[0];

const all = defaultAssetClassPrefs();
const start = classStartValues(nw, all);
eq(start.property, 240000, 'property counted when shown');
eq(start.other, 375, 'other = art + collectables + forex');
eq(classStartValues(nw).property, 240000, 'no prefs: everything counts');

const hidden = { ...all, real_estate: false, art: false, kiwisaver: false };
const s2 = classStartValues(nw, hidden);
eq(s2.property, 0, 'hidden property starts at 0');
eq(s2.kiwiSaver, 0, 'hidden KiwiSaver starts at 0');
eq(s2.other, 75, 'other drops only hidden art');
eq(s2.cash, 1200.5, 'cash unaffected');

const input = (key: string, startNzd: number) => ({
  key,
  startNzd,
  annualReturnPercent: 5,
  returnSource: 'saved',
  monthlyAdditionNzd: 100,
  monthlyAdditionsNzd: [100, 100],
  additionSource: 'saved',
  additionReason: 'Your saved monthly addition.',
});
const classes = [input('property', 240000), input('other', 75), input('shares', 115.62)] as unknown as Parameters<typeof withoutHiddenClasses>[0];
const out = withoutHiddenClasses(classes, hidden);
eq(out[0].startNzd, 0, 'hidden property: no start');
eq(out[0].monthlyAdditionNzd, null, 'hidden property: no additions');
eq(out[0].monthlyAdditionsNzd, undefined, 'hidden property: no month-by-month additions');
eq(out[1].monthlyAdditionNzd, 100, 'other keeps additions while some of it is shown');
eq(out[2], classes[2], 'shown class untouched');
eq(withoutHiddenClasses(classes, all)[0], classes[0], 'nothing hidden: untouched');

console.log('projections hidden.test.ts ok');
fs.rmSync(dataDir, { recursive: true, force: true });
