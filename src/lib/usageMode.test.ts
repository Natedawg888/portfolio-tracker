/**
 * Usage mode (KAN-124): parsing and defaults, saving, the nav per mode, and where "/" goes.
 * Run: npm run test:onboarding
 */
import { homePathForMode, isUsageMode, mergeUsageModeIntoPreferencesJson, navKeysForMode, parseUsageMode } from './usageMode.ts';

function eq(actual: unknown, expected: unknown, msg: string): void {
  if (JSON.stringify(actual) !== JSON.stringify(expected)) throw new Error(`FAIL: ${msg} (got ${JSON.stringify(actual)}, expected ${JSON.stringify(expected)})`);
}

// Accounts with no saved mode behave exactly as today.
for (const legacy of [null, undefined, '', '   ', '{}', '{"onboarding":{"assetClassesDone":true}}', 'not json', '[]', '{"usageMode":"accountant"}', '{"usageMode":null}']) {
  eq(parseUsageMode(legacy), { mode: 'personal', chosen: false }, `no valid mode → personal, not chosen (${String(legacy)})`);
}
eq(parseUsageMode('{"usageMode":"business"}'), { mode: 'business', chosen: true }, 'business is read back');
eq(parseUsageMode('{"usageMode":"both","news":{"x":1}}'), { mode: 'both', chosen: true }, 'both is read back');
eq(parseUsageMode('{"usageMode":"personal"}'), { mode: 'personal', chosen: true }, 'an explicit personal counts as chosen');
eq([isUsageMode('business'), isUsageMode('Business'), isUsageMode(1)], [true, false, false], 'only the three values');

// Saving keeps everything else in preferences_json.
const prefs = JSON.stringify({ onboarding: { assetClassesDone: true, budgetCategoriesDone: false, akahuStepDone: true }, news: { savedUrls: ['a'] } });
const saved = JSON.parse(mergeUsageModeIntoPreferencesJson(prefs, 'business'));
eq(saved.usageMode, 'business', 'mode saved');
eq([saved.onboarding.budgetCategoriesDone, saved.news.savedUrls], [false, ['a']], 'other preferences kept');
eq(JSON.parse(mergeUsageModeIntoPreferencesJson('broken', 'both')), { usageMode: 'both' }, 'unreadable preferences start fresh');
eq(parseUsageMode(mergeUsageModeIntoPreferencesJson(null, 'personal')).chosen, true, 'saving personal marks it chosen');

// Nav per mode.
eq(navKeysForMode('personal'), ['dashboard', 'budget', 'debts', 'portfolio', 'projections', 'news', 'kiwisaver', 'paye', 'business', 'calendar', 'history', 'valueSearch'], 'personal is today’s nav');
eq(navKeysForMode('business'), ['business', 'invoices', 'clients', 'calendar'], 'business only shows business items');
for (const hidden of ['dashboard', 'budget', 'debts', 'portfolio', 'projections', 'kiwisaver', 'paye', 'history', 'valueSearch', 'news'] as const) {
  if (navKeysForMode('business').includes(hidden)) throw new Error(`FAIL: business mode hides ${hidden}`);
}
eq(navKeysForMode('both').slice(0, 2), ['dashboard', 'business'], 'both puts Business next to Dashboard');
eq([...navKeysForMode('both')].sort(), [...navKeysForMode('personal')].sort(), 'both keeps every personal item');

// Landing.
eq([homePathForMode('business'), homePathForMode('both'), homePathForMode('personal')], ['/business', '/', '/'], 'business lands on the business dashboard');

console.log('usage mode: ok');
