/**
 * Settings → Account view logic. Run: npm run test:account
 */
import { DELETED_ITEMS, KEPT_ITEMS, deleteConfirmed, providerList } from './accountView.ts';

function eq(a: unknown, b: unknown, msg: string): void {
  if (a !== b) throw new Error(`FAIL: ${msg} (got ${String(a)}, expected ${String(b)})`);
}

eq(deleteConfirmed('DELETE'), true, 'DELETE confirms');
eq(deleteConfirmed('  DELETE '), true, 'surrounding spaces are ignored, as on the server');
eq(deleteConfirmed('delete'), false, 'lower case does not confirm');
eq(deleteConfirmed('DELET'), false, 'partial word does not confirm');
eq(deleteConfirmed(''), false, 'empty does not confirm');

eq(providerList([]), '', 'no providers');
eq(providerList(['Google']), 'Google', 'one provider');
eq(providerList(['Google', 'Apple']), 'Google and Apple', 'two providers');
eq(providerList(['Google', 'Apple', 'Microsoft']), 'Google, Apple and Microsoft', 'three providers');
eq(providerList(['Google', 'Google']), 'Google', 'duplicates collapse');

// The user-facing lists never use developer wording.
for (const line of [...DELETED_ITEMS, ...KEPT_ITEMS.map((k) => k.text)]) {
  eq(/isolation|AUTH\.md|user_id|table/i.test(line), false, `plain language: ${line}`);
}

console.log('accountView tests passed');
