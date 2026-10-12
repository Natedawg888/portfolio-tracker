/**
 * News settings live in users.preferences_json.news and must not wipe other keys.
 * Run: npm run test:news
 */
import {
  applyNewsUserPatch,
  defaultNewsUserState,
  mergeNewsIntoPreferences,
  newsFromPreferences,
  normalizeNewsUserState,
  withAllRead,
  withReadUrl,
  withSavedUrl,
} from './newsPrefs.ts';

function assert(condition: boolean, message: string): void {
  if (!condition) throw new Error(message);
}

const defaults = defaultNewsUserState();
assert(defaults.groupDailyPriceUpdates === true, 'price updates start grouped');
assert(defaults.includeClosedPositions === false, 'closed positions start hidden');
assert(defaults.readUrls.length === 0 && defaults.savedUrls.length === 0, 'nothing is read or saved yet');

const junk = normalizeNewsUserState({
  readUrls: ['https://example.com/a', 'not a url', 'https://example.com/a', 4, 'http://example.com/b'],
  savedUrls: 'nope',
  groupDailyPriceUpdates: 'yes',
  includeClosedPositions: false,
});
assert(junk.readUrls.join(',') === 'https://example.com/a,http://example.com/b', 'only real unique urls are kept');
assert(junk.savedUrls.length === 0, 'a bad saved list is empty');
assert(junk.groupDailyPriceUpdates === true, 'a non-boolean grouping flag keeps the default');
assert(junk.includeClosedPositions === false, 'a boolean closed flag is kept');
assert(normalizeNewsUserState(null).groupDailyPriceUpdates === true, 'missing settings use the defaults');

const read = withReadUrl(defaults, 'https://news.example/1');
assert(read.readUrls.length === 1, 'opening a headline marks that url read');
assert(withReadUrl(read, 'https://news.example/1') === read, 'marking the same url again changes nothing');
const saved = withSavedUrl(read, 'https://news.example/1', true);
assert(saved.savedUrls[0] === 'https://news.example/1', 'a headline can be saved');
const unsaved = withSavedUrl(saved, 'https://news.example/1', false);
assert(unsaved.savedUrls.length === 0, 'saving again removes it');
const all = withAllRead(defaults, ['https://news.example/1', 'https://news.example/2', 'nope']);
assert(all.readUrls.length === 2, 'mark all read keeps only feed urls');

const many = Array.from({ length: 450 }, (_, i) => `https://news.example/${i}`);
const capped = applyNewsUserPatch(defaults, { readUrls: many });
assert(capped.readUrls.length === 400, 'read urls stay capped');
assert(capped.readUrls[0] === 'https://news.example/50', 'the cap keeps the newest urls');
assert(capped.readUrls.at(-1) === 'https://news.example/449', 'the latest url is kept');

const stored = JSON.stringify({
  assetClasses: { stock: true },
  onboarding: { assetClassesDone: true },
});
const merged = mergeNewsIntoPreferences(stored, {
  ...defaults,
  groupDailyPriceUpdates: false,
  savedUrls: ['https://news.example/saved'],
});
const parsed = JSON.parse(merged) as {
  assetClasses: { stock: boolean };
  onboarding: { assetClassesDone: boolean };
  news: { groupDailyPriceUpdates: boolean; savedUrls: string[] };
};
assert(parsed.assetClasses.stock === true, 'saving news keeps asset classes');
assert(parsed.onboarding.assetClassesDone === true, 'saving news keeps onboarding');
assert(parsed.news.groupDailyPriceUpdates === false, 'the grouping choice is stored');
assert(parsed.news.savedUrls[0] === 'https://news.example/saved', 'the saved url is stored');
const roundTrip = newsFromPreferences(merged);
assert(roundTrip.groupDailyPriceUpdates === false, 'the stored grouping choice is read back');
assert(roundTrip.includeClosedPositions === false, 'an omitted closed flag stays off');
assert(newsFromPreferences('{').groupDailyPriceUpdates === true, 'broken json falls back to defaults');
assert(newsFromPreferences(null).readUrls.length === 0, 'a new account has no read headlines');

console.log('news prefs ok');
