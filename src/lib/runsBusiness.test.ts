/** "I run a business" stays next to the other profile preferences. Run: npm run test:plans */
import { mergeRunsBusinessIntoPreferencesJson, parseRunsBusiness } from './runsBusiness.ts';

function eq(actual: unknown, expected: unknown, msg: string): void {
  if (actual !== expected) throw new Error(`FAIL: ${msg} (got ${JSON.stringify(actual)}, expected ${JSON.stringify(expected)})`);
}

eq(parseRunsBusiness(null), false, 'a new profile has not ticked it');
eq(parseRunsBusiness('not json'), false, 'broken json is not ticked');
const saved = mergeRunsBusinessIntoPreferencesJson(JSON.stringify({ usageMode: 'both', news: { savedUrls: ['a'] } }), true);
const parsed = JSON.parse(saved) as { usageMode: string; news: { savedUrls: string[] }; runsBusiness: boolean };
eq(parsed.runsBusiness, true, 'the tick is stored');
eq(parsed.usageMode, 'both', 'usage mode stays');
eq(parsed.news.savedUrls[0], 'a', 'other preferences stay');
eq(parseRunsBusiness(mergeRunsBusinessIntoPreferencesJson(saved, false)), false, 'unticking is stored');

console.log('runsBusiness: ok');
