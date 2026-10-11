/**
 * Projections page view rules: form fields follow the URL, including a nav
 * click back to /projections while another scenario is cached.
 * Run: npm run test:projections-page
 */
import { clearPageCache, readPageCache, syncPageCacheUser, writePageCache } from '../lib/pageDataCache.ts';
import { formatNzd } from '../api/client.ts';
import { setMoneyHidden } from '../lib/privacy.tsx';
import {
  additionsAreEven,
  budgetAverageInput,
  budgetAverageLabel,
  canUseBudgetAverage,
  classNumbers,
  growthSliderMax,
  horizonPhrase,
  horizonPill,
  inputsToParams,
  flatLineNote,
  projectionBreakdown,
  projectionCacheKey,
  projectionFigures,
  readInputs,
  sampleProjectionPoints,
  savingSliderBounds,
  scenarioFrameFromSearch,
  scenarioRequestFailure,
  sliderPercentLabel,
  todayPlusAddedPoints,
  typedOrInUse,
  yearlyIncreaseCaption,
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

// Per-class yearly increase (growShares …).
{
  const g = readInputs(new URLSearchParams('growShares=100&growCrypto=999'));
  assert(g.classGrowth.shares === '100', 'class increase read from the link');
  assert(g.classGrowth.crypto === '' && g.ignored.some((m) => m.startsWith('Crypto yearly increase')), 'out of range dropped');
  assert(inputsToParams(g).get('growShares') === '100', 'written back to the link');
}

assert(horizonPhrase(12) === '1 year', '12 months reads as 1 year');
assert(horizonPhrase(120) === '10 years', '120 months reads as 10 years');
assert(horizonPhrase(24) === '2 years', 'the 2-year horizon keeps its label');
assert(horizonPill(12) === '1Y' && horizonPill(24) === '2Y' && horizonPill(360) === '30Y', 'range pills use year labels');

const withClasses = projectionFigures({
  startNetWorthNzd: 33033,
  endNetWorthNzd: 40000,
  classAddedNzd: [1000, -200],
  classGrowthNzd: [500, 250.5],
  savingsAddedNzd: 9999,
  kiwiSaverAddedNzd: 100,
});
assert(withClasses.todayNzd === 33033 && withClasses.endNzd === 40000, 'today and the end come from the points');
assert(withClasses.youAddNzd === 800, 'you add is the class additions, not the saving field');
assert(withClasses.growthNzd === 750.5, 'growth is the sum of class growth');

const noClasses = projectionFigures({
  startNetWorthNzd: 1000,
  endNetWorthNzd: 1500,
  classAddedNzd: null,
  classGrowthNzd: null,
  savingsAddedNzd: 400,
  kiwiSaverAddedNzd: 50,
});
assert(noClasses.youAddNzd === 450, 'without classes, you add is saving plus KiwiSaver');
assert(noClasses.growthNzd === null, 'growth stays unknown when there is no class breakdown');

const unknownAdd = projectionFigures({
  startNetWorthNzd: 10,
  endNetWorthNzd: 10,
  classAddedNzd: null,
  classGrowthNzd: [0],
  savingsAddedNzd: null,
  kiwiSaverAddedNzd: null,
});
assert(unknownAdd.youAddNzd === null, 'a missing saving figure is not shown as zero');
assert(
  projectionFigures({
    startNetWorthNzd: 10,
    endNetWorthNzd: 10,
    classAddedNzd: [Number.NaN],
    classGrowthNzd: [1],
    savingsAddedNzd: 5,
    kiwiSaverAddedNzd: null,
  }).youAddNzd === null,
  'a non-finite class addition makes you-add unavailable',
);

assert(
  projectionBreakdown(
    { todayNzd: 33033, endNzd: 33033, youAddNzd: 0, growthNzd: 0 },
    (value) => (value == null ? '—' : `$${value}`),
  ) === 'Today $33033 · you add $0 · growth $0',
  'the breakdown line names today, what you add, and growth',
);
assert(
  projectionBreakdown(
    { todayNzd: null, endNzd: null, youAddNzd: null, growthNzd: null },
    (value) => (value == null ? '—' : String(value)),
  ) === 'Today — · you add — · growth —',
  'missing figures stay em dashes',
);

const monthly = [
  { date: '2026-10-01', monthIndex: 0, netWorthNzd: 1000 },
  { date: '2026-11-01', monthIndex: 1, netWorthNzd: 1100 },
  { date: '2027-10-01', monthIndex: 12, netWorthNzd: 2000 },
];
assert(sampleProjectionPoints(monthly, 12).length === 3, 'a one-year line keeps every month');
const decade = Array.from({ length: 121 }, (_, monthIndex) => ({ monthIndex, date: `m${monthIndex}` }));
const sampled = sampleProjectionPoints(decade, 120);
assert(sampled.length === 11 && sampled[0].monthIndex === 0 && sampled.at(-1)?.monthIndex === 120, 'a ten-year line keeps one point a year');
assert(sampled.every((point) => point.monthIndex % 12 === 0), 'the yearly sample has no mid-year points');

const evenLine = todayPlusAddedPoints(monthly, 600, true);
assert(evenLine?.[0].value === 1000 && evenLine?.[1].value === 1050 && evenLine?.[2].value === 1600, 'even additions ramp from today to today plus the total');
const uneven = todayPlusAddedPoints(monthly, 600, false);
assert(uneven?.length === 2 && uneven[0].value === 1000 && uneven[1].value === 1600, 'uneven additions plot only the two real endpoints');
assert(todayPlusAddedPoints(monthly, null, true) === null, 'an unknown total is not drawn as zero');
assert(todayPlusAddedPoints([], 0, true) === null, 'no points means no contributions line');

assert(
  additionsAreEven({ defaultGrowthPercent: 0, classGrowthPercents: [0, null], hasMonthlySchedule: false }),
  'a constant monthly amount is an even ramp',
);
assert(
  !additionsAreEven({ defaultGrowthPercent: 10, classGrowthPercents: [0], hasMonthlySchedule: false }),
  'a yearly step-up is not treated as even',
);
assert(
  !additionsAreEven({ defaultGrowthPercent: 0, classGrowthPercents: [0], hasMonthlySchedule: true }),
  'a mining schedule is not treated as even',
);

assert(typedOrInUse('', 4) === 4, 'a blank field shows the figure already in use');
assert(typedOrInUse('7.5', 4) === 7.5, 'a typed value wins over the figure in use');
assert(typedOrInUse('nope', null) === null, 'an unreadable field with nothing in use stays blank');
assert(sliderPercentLabel(null) === '—', 'a missing percent is an em dash');
assert(sliderPercentLabel(0) === '0%' && sliderPercentLabel(5.04) === '5%' && sliderPercentLabel(5.25) === '5.3%', 'percent labels round to one decimal');
assert(growthSliderMax(0) === 100 && growthSliderMax(150) === 150 && growthSliderMax(900) === 500, 'the step-up slider grows with the value, up to the API limit');
assert(yearlyIncreaseCaption(0) === 'Same amount every year', 'zero step-up says the amount stays the same');
assert(yearlyIncreaseCaption(25) === 'Steps up by this much each year', 'a positive step-up says so');
assert(yearlyIncreaseCaption(null) === 'Same amount every year', 'an unknown step-up uses the zero caption');

const bounds = savingSliderBounds(0, null);
assert(bounds.min === 0 && bounds.max >= 2000 && bounds.step > 0, 'a zero saving slider still reaches upward');
const wide = savingSliderBounds(8000, 1500);
assert(wide.min <= 0 && wide.max >= 8000, 'the slider includes the amount in use');
const negative = savingSliderBounds(-320, 100);
assert(negative.min <= -320 && negative.max >= 2000, 'a negative saving stays on the slider');
assert(budgetAverageLabel(3, '$420') === 'Budget average (last 3 months): $420', 'the budget caption names the window and the amount');
assert(budgetAverageLabel(1, '—') === 'Budget average (last 1 month): —', 'a one-month window stays singular');
assert(canUseBudgetAverage(420) && !canUseBudgetAverage(null), 'use-it needs a real budget average');
assert(budgetAverageInput(420.126) === '420.13', 'the budget average is applied in cents');

console.log('projections view tests passed');
