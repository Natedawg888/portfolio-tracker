/**
 * Projections page view rules: form fields follow the URL, including a nav
 * click back to /projections while another scenario is cached.
 * Run: npm run test:projections-page
 */
import { clearPageCache, readPageCache, syncPageCacheUser, writePageCache } from '../lib/pageDataCache.ts';
import { formatNzd } from '../api/client.ts';
import { setMoneyHidden } from '../lib/privacy.tsx';
import {
  classNumbers,
  inputsToParams,
  flatLineNote,
  projectionCacheKey,
  readInputs,
  scenarioFrameFromSearch,
  scenarioRequestFailure,
} from './projectionsView.ts';

function assert(condition: boolean, message: string): void {
  if (!condition) throw new Error(message);
}

const scenarioUrl = new URLSearchParams('months=120&annualReturnPercent=5&monthlySavingNzd=500');
const navUrl = new URLSearchParams('');

clearPageCache();
syncPageCacheUser('projection-user');

const scenario = readInputs(scenarioUrl);
const defaults = readInputs(navUrl);
const scenarioKey = projectionCacheKey(scenario);
const defaultKey = projectionCacheKey(defaults);
assert(scenarioKey !== defaultKey, 'the 10-year scenario and /projections do not share a cache entry');

writePageCache(scenarioKey, { id: 'ten-year' });
writePageCache(defaultKey, { id: 'one-year' });

const onScenario = scenarioFrameFromSearch(scenarioUrl, (key) => readPageCache<{ id: string }>(key));
assert(onScenario.form.months === 120, 'the scenario link shows 10 years');
assert(onScenario.form.returnPct === '5', 'the scenario link shows the typed return');
assert(onScenario.form.saving === '500', 'the scenario link shows the typed saving');
assert(onScenario.data?.id === 'ten-year', 'the scenario link paints its own cache entry');

// Clicking Projections goes to /projections. The default scenario is cached.
const afterNav = scenarioFrameFromSearch(navUrl, (key) => readPageCache<{ id: string }>(key));
assert(afterNav.form.months === 12, 'the nav link resets Time ahead to 1 year');
assert(afterNav.form.returnPct === '', 'the nav link clears the return field');
assert(afterNav.form.saving === '', 'the nav link clears the saving field');
assert(afterNav.form.window === 3, 'the nav link uses the default budget window');
assert(afterNav.loaded, 'a cached default scenario paints immediately');
assert(afterNav.data?.id === 'one-year', 'the nav link paints the default cache, not the 10-year scenario');

// Same click when only the previous scenario is cached.
clearPageCache();
syncPageCacheUser('projection-user');
writePageCache(scenarioKey, { id: 'ten-year' });
const afterNavMiss = scenarioFrameFromSearch(navUrl, (key) => readPageCache<{ id: string }>(key));
assert(afterNavMiss.form.months === 12, 'Time ahead still resets when the default scenario is not cached');
assert(afterNavMiss.form.returnPct === '', 'the return still clears when the default scenario is not cached');
assert(afterNavMiss.form.saving === '', 'the saving still clears when the default scenario is not cached');
assert(afterNavMiss.data === null, 'the 10-year cache is not shown for /projections');
assert(afterNavMiss.loaded === false, 'a cache miss is not treated as loaded');
assert(readPageCache(scenarioKey) != null, 'the previous scenario stays cached');
assert(
  scenarioRequestFailure(readPageCache(defaultKey) != null).kind === 'error',
  'a failed /projections request does not treat the 10-year cache as this scenario',
);

// A fresh load of /projections, with nothing cached.
clearPageCache();
syncPageCacheUser('projection-user');
const fresh = scenarioFrameFromSearch(navUrl, (key) => readPageCache<{ id: string }>(key));
assert(fresh.form.months === 12, 'a fresh /projections load starts at 1 year');
assert(fresh.form.returnPct === '', 'a fresh load leaves the return blank');
assert(fresh.form.saving === '', 'a fresh load leaves the saving blank');
assert(fresh.data === null, 'a fresh load with an empty cache has no figures');

assert(scenarioRequestFailure(true).kind === 'keep-cache', 'a failed refresh keeps this scenario cache');
assert(scenarioRequestFailure(false).kind === 'error', 'a failed request with no cache for this scenario does not keep figures');

const zeroReturn = flatLineNote({
  annualReturnPercent: 0,
  compoundingAssetsNzd: 1000,
  monthlySavingNzd: null,
  debtHasSavedPayment: false,
});
assert(zeroReturn.includes('the return is 0%'), 'a zero return is described as 0%');
assert(!zeroReturn.includes('nothing for that return to grow'), 'a zero return is not described as having nothing to grow');

const nothingToGrow = flatLineNote({
  annualReturnPercent: 5,
  compoundingAssetsNzd: 0,
  monthlySavingNzd: 0,
  debtHasSavedPayment: false,
});
assert(!nothingToGrow.includes('the return is 0%'), 'a non-zero return is not called 0%');
assert(nothingToGrow.includes('nothing for that return to grow'), 'no compounding assets means the return has nothing to grow');
assert(nothingToGrow.includes('5%'), 'the note uses the return from the response');
assert(nothingToGrow.includes('no monthly saving'), 'a zero saving is described as no monthly saving');

const withAssets = flatLineNote({
  annualReturnPercent: 5,
  compoundingAssetsNzd: 1000,
  monthlySavingNzd: null,
  debtHasSavedPayment: true,
});
assert(withAssets.includes('the yearly return is 5%'), 'a non-zero return with assets names that return');
assert(!withAssets.includes('nothing for that return to grow'), 'assets mean the return has something to grow');
assert(!withAssets.includes('no debt has a saved payment'), 'a stepped debt is not described as having no payment');

setMoneyHidden(true);
try {
  const hidden = flatLineNote({
    annualReturnPercent: 5,
    compoundingAssetsNzd: 0,
    monthlySavingNzd: 250,
    debtHasSavedPayment: true,
  });
  assert(hidden.includes(formatNzd(250)), 'a non-zero saving uses the same masking as other amounts');
  assert(!hidden.includes('250'), 'a masked saving does not show the raw amount');
} finally {
  setMoneyHidden(false);
}

// Per-asset-class fields (returnShares / addCrypto …).
{
  const withClasses = readInputs(new URLSearchParams('months=24&returnShares=7&addCrypto=200&returnMetals=99'));
  assert(withClasses.classReturns.shares === '7', 'shares return read from the link');
  assert(withClasses.classAdds.crypto === '200', 'crypto addition read from the link');
  assert(withClasses.classReturns.metals === '', 'an out-of-range class return is dropped');
  assert(withClasses.ignored.some((m) => m.startsWith('Metals')), 'and reported');
  const back = inputsToParams(withClasses);
  assert(back.get('returnShares') === '7' && back.get('addCrypto') === '200', 'form → link keeps class fields');
  assert(!back.has('returnCash'), 'blank class fields are left out of the link');
  assert(classNumbers(withClasses.classReturns).shares === 7 && classNumbers(withClasses.classReturns).cash === undefined, 'only set classes are sent');
  const plain = readInputs(new URLSearchParams('months=24'));
  assert(projectionCacheKey(withClasses) !== projectionCacheKey(plain), 'class fields change the cache key');
}

// Yearly step-up of what's added (addGrowth).
{
  const g = readInputs(new URLSearchParams('months=60&addGrowth=100'));
  assert(g.addGrowth === '100', 'step-up read from the link');
  assert(inputsToParams(g).get('addGrowth') === '100', 'and written back');
  const bad = readInputs(new URLSearchParams('addGrowth=900'));
  assert(bad.addGrowth === '' && bad.ignored.some((m) => m.includes('yearly increase')), 'out-of-range step-up dropped and reported');
  assert(projectionCacheKey(g) !== projectionCacheKey(readInputs(new URLSearchParams('months=60'))), 'step-up changes the cache key');
}

console.log('projections view tests passed');
