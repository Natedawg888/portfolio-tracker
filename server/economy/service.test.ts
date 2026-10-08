/**
 * A new extract revision must not keep serving an older cached download.
 * Run: npm run test:economy
 */
import { cacheIsCurrent, cacheLifetimeMs, cacheNote, visibleCacheNote } from './service.ts';

function assert(cond: unknown, msg: string): void {
  if (!cond) throw new Error(`FAIL: ${msg}`);
}

let passed = 0;

{
  const note = cacheNote(['Business activity and credit conditions have no feed connected in this version.']);
  assert(cacheIsCurrent(note), 'a note from this revision is current');
  assert(!cacheIsCurrent('Business activity has no feed.'), 'an older note is not current');
  assert(!cacheIsCurrent(null), 'a missing note is not current');
  const visible = visibleCacheNote(note);
  assert(visible != null && !visible.includes('rev:'), `revision token stays out of the page: ${visible}`);
  assert(visible?.includes('Business activity'), 'the warning text remains');
  passed += 1;
}

{
  const clean = cacheLifetimeMs(cacheNote([]));
  const partial = cacheLifetimeMs(cacheNote(['RBNZ credit conditions: The C60 download was not a workbook.']));
  assert(partial < clean, `a refresh with a failed series is retried sooner: ${partial} vs ${clean}`);
  assert(partial === 60 * 60 * 1000, `a partial refresh is retried after an hour: ${partial}`);
  passed += 1;
}

console.log(`${passed} service cache tests passed`);
