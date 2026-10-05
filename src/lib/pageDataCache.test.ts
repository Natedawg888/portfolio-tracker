/**
 * Memory cache: user isolation, 401/sign-out clearing, and stale writes.
 * Run: npm run test:page-cache
 */
import {
  beginPageRead,
  clearPageCache,
  commitPageRead,
  invalidateFinancial,
  readPageCache,
  syncPageCacheUser,
  writePageCache,
} from './pageDataCache.ts';

function assert(condition: boolean, message: string): void {
  if (!condition) throw new Error(message);
}

function reset(): void {
  clearPageCache();
  syncPageCacheUser(null);
}

reset();

syncPageCacheUser('user-a');
assert(writePageCache('dashboard:main', { total: 10 }), 'write for user A');
assert(readPageCache<{ total: number }>('dashboard:main')?.total === 10, 'user A can read their data');

syncPageCacheUser('user-b');
assert(readPageCache('dashboard:main') === undefined, 'user B does not see user A');
writePageCache('dashboard:main', { total: 99 });
assert(readPageCache<{ total: number }>('dashboard:main')?.total === 99, 'user B has their own entry');

syncPageCacheUser('user-a');
assert(readPageCache('dashboard:main') === undefined, 'returning to user A does not restore the old entry');

syncPageCacheUser('user-a');
writePageCache('debts', { rows: [1] });
writePageCache('savings-goals', { rows: [2] });
const stale = beginPageRead('debts');
invalidateFinancial('debts', 'dashboard');
assert(readPageCache('debts') === undefined, 'debt cache dropped after an edit');
assert(readPageCache('savings-goals') !== undefined, 'unrelated cache stays');
assert(commitPageRead(stale, { rows: [1, 1] }) === false, 'in-flight read cannot rewrite invalidated data');
assert(readPageCache('debts') === undefined, 'stale commit left the cache empty');

const fresh = beginPageRead('debts');
assert(commitPageRead(fresh, { rows: [3] }), 'read started after invalidation can commit');
assert(JSON.stringify(readPageCache('debts')) === JSON.stringify({ rows: [3] }), 'fresh debts stored');

clearPageCache();
assert(readPageCache('debts') === undefined, 'clear drops the signed-in user cache');
assert(commitPageRead(fresh, { rows: [4] }) === false, 'clear rejects writes started before sign-out');

syncPageCacheUser('user-a');
writePageCache('dashboard:month', { incomeNzd: 1 });
syncPageCacheUser('user-a');
assert(readPageCache<{ incomeNzd: number }>('dashboard:month')?.incomeNzd === 1, 'same user keeps cache');

writePageCache('portfolio', { holdings: 1 });
writePageCache('portfolio:gomining', { discountPct: 4 });
invalidateFinancial('portfolio');
assert(readPageCache('portfolio') === undefined, 'portfolio figures drop after an edit');
assert(
  readPageCache<{ discountPct: number }>('portfolio:gomining')?.discountPct === 4,
  'GoMining settings stay cached when holdings change',
);

console.log('pageDataCache tests passed');
