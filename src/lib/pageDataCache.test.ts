/**
 * Memory cache: user isolation, 401/sign-out clearing, and stale writes.
 * Run: npm run test:page-cache
 */
import { setMoneyHidden } from './privacy.tsx';
import {
  abandonPageRead,
  beginPageRead,
  clearPageCache,
  commitPageRead,
  invalidateAfterAkahuLinkChange,
  invalidateAfterBudgetEdit,
  invalidateAfterDebtEdit,
  invalidateAfterKiwiSaverEdit,
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

writePageCache('news-page', { sections: 1 });
writePageCache('news:NZ:expansion', { items: 1 });
writePageCache('projections:12:3::', { net: 1 });
invalidateFinancial('portfolio');
assert(readPageCache('news-page') === undefined, 'holding edits drop the news page cache');
assert(readPageCache('news:NZ:expansion') !== undefined, 'phase news stays when holdings change');
assert(readPageCache('projections:12:3::') !== undefined, 'projections stay until their own scope is cleared');
invalidateFinancial('projections');
assert(readPageCache('projections:12:3::') === undefined, 'projection cache drops on its own scope');

// A wallet summary write must not replace a portfolio read that is still running.
writePageCache('portfolio', { holdings: 1 });
const portfolioRead = beginPageRead('portfolio');
assert(writePageCache('portfolio', { holdings: 9 }) === false, 'wallet write waits while a portfolio read is running');
assert(
  (readPageCache<{ holdings: number }>('portfolio')?.holdings ?? 0) === 1,
  'in-flight portfolio read keeps the previous summary',
);
assert(commitPageRead(portfolioRead, { holdings: 2 }), 'the portfolio read can still commit');
assert(readPageCache<{ holdings: number }>('portfolio')?.holdings === 2, 'committed portfolio read wins');
const abandoned = beginPageRead('portfolio');
abandonPageRead(abandoned);
assert(writePageCache('portfolio', { holdings: 3 }), 'wallet write proceeds after the read is abandoned');
assert(readPageCache<{ holdings: number }>('portfolio')?.holdings === 3, 'abandoned read no longer blocks the write');

function assertPortfolioSummaryCleared(label: string): void {
  assert(readPageCache('portfolio') === undefined, `${label} clears the portfolio net-worth summary`);
  assert(
    readPageCache<{ discountPct: number }>('portfolio:gomining')?.discountPct === 4,
    `${label} leaves GoMining settings cached`,
  );
}

writePageCache('portfolio', { holdings: 1 });
writePageCache('portfolio:gomining', { discountPct: 4 });
invalidateAfterBudgetEdit();
assertPortfolioSummaryCleared('budget edit');
writePageCache('portfolio', { holdings: 1 });
invalidateAfterDebtEdit();
assertPortfolioSummaryCleared('debt edit');
writePageCache('portfolio', { holdings: 1 });
invalidateAfterKiwiSaverEdit();
assertPortfolioSummaryCleared('KiwiSaver edit');

writePageCache('portfolio', { holdings: 8 });
writePageCache('dashboard:main', { total: 1 });
writePageCache('settings:akahu', { configured: true });
writePageCache('portfolio:gomining', { discountPct: 4 });
invalidateAfterAkahuLinkChange();
assert(readPageCache('portfolio') === undefined, 'Akahu link change clears the portfolio summary');
assert(readPageCache('dashboard:main') === undefined, 'Akahu link change clears the dashboard');
assert(readPageCache('settings:akahu') === undefined, 'Akahu link change clears the bank-link status');
assert(writePageCache('dashboard:main', { total: 2 }), 'same user can cache again after an Akahu link change');
assert(readPageCache<{ total: number }>('dashboard:main')?.total === 2, 'Akahu link change does not sign the user out');

// A return visit starts a newer read. The earlier response still fills an empty slot.
const firstMonth = beginPageRead('dashboard:month');
const returnMonth = beginPageRead('dashboard:month');
assert(commitPageRead(firstMonth, { incomeNzd: 0 }) === false, 'the earlier month read is no longer the active one');
assert(readPageCache<{ incomeNzd: number }>('dashboard:month')?.incomeNzd === 0, 'the earlier month read still paints on return');
assert(commitPageRead(returnMonth, { incomeNzd: 5 }), 'the return visit can refresh the month');
assert(readPageCache<{ incomeNzd: number }>('dashboard:month')?.incomeNzd === 5, 'the newer month read replaces the seed');
assert(commitPageRead(firstMonth, { incomeNzd: 0 }) === false, 'a late month read cannot overwrite the refresh');
assert(readPageCache<{ incomeNzd: number }>('dashboard:month')?.incomeNzd === 5, 'refresh stays after the late response');

assert(
  writePageCache('debts', { rows: [], summary: { outstandingTotalNzd: 0 } }),
  'an empty debt list is cached',
);
const emptyDebts = readPageCache<{ rows: unknown[]; summary: { outstandingTotalNzd: number } }>('debts');
assert(emptyDebts != null && emptyDebts.rows.length === 0, 'a return visit can read the empty debt list');
assert(writePageCache('news-page', { sections: [], fetchedAt: 't' }), 'an empty news payload is cached');
assert(readPageCache('news-page') != null, 'a return visit can read empty headlines');
assert(writePageCache('savings-goals', []), 'an empty savings-goal list is cached');
assert(Array.isArray(readPageCache('savings-goals')), 'a return visit can read no savings goals');
assert(writePageCache('economy:NZ', { country: 'NZ' }), 'a finished indicator extract is cached');
assert(
  readPageCache<{ country: string }>('economy:NZ')?.country === 'NZ',
  'a return visit can read the New Zealand extract',
);

const hiddenBefore = readPageCache<{ total: number }>('dashboard:main')?.total;
setMoneyHidden(true);
setMoneyHidden(false);
assert(readPageCache<{ total: number }>('dashboard:main')?.total === hiddenBefore, 'hiding amounts does not clear or bypass the cache');

console.log('pageDataCache tests passed');
