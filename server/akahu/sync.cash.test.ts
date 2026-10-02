/**
 * Cash-sync predicate + balance coerce tests — includes explicit Kiwibank fixtures.
 * Run: npm run test:cash-sync
 */
import {
  shouldSyncAsCash,
  mapAkahuAccountType,
  coerceAkahuBalance,
  cashAccountDisplayName,
  isLiquidCashAccountType,
  LIQUID_CASH_ACCOUNT_TYPES,
  LIABILITY_ACCOUNT_TYPES,
} from './sync.ts';
import { deriveCardName } from './syncTransactions.ts';
import type { AkahuAccount, AkahuTransaction } from './client.ts';

function assert(cond: unknown, msg: string): void {
  if (!cond) throw new Error(`FAIL: ${msg}`);
}

function kiwibank(partial: Partial<AkahuAccount> & { name: string; type: string }): AkahuAccount {
  return {
    _id: partial._id ?? 'acc_test_kiwibank',
    name: partial.name,
    type: partial.type,
    status: partial.status ?? 'ACTIVE',
    connection: partial.connection ?? { _id: 'conn_kb', name: 'Kiwibank' },
    balance: partial.balance,
    formatted_account: partial.formatted_account,
    meta: partial.meta,
  };
}

let passed = 0;

{
  const a = kiwibank({
    name: 'Main',
    type: 'CHECKING',
    formatted_account: '38-9014-0109286-01',
    balance: { currency: 'NZD', current: 590.58, available: 590.58 },
  });
  assert(shouldSyncAsCash(a) === true, 'Kiwibank Main CHECKING with balance syncs');
  assert(mapAkahuAccountType('CHECKING') === 'cheque', 'CHECKING → cheque');
  assert(coerceAkahuBalance(a.balance) === 590.58, 'coerce pulls current 590.58');
  assert(
    cashAccountDisplayName(a) === 'Main · 38-9014-0109286-01',
    'display name includes formatted_account, not balance object',
  );
  assert(!cashAccountDisplayName(a).includes('object'), 'display name must not contain [object Object]');
  passed += 1;
}

{
  const a = kiwibank({
    name: 'Debit card',
    type: 'CHECKING',
    formatted_account: '38-9014-0109286-02',
    balance: { currency: 'NZD', current: 0, available: 0 },
  });
  assert(shouldSyncAsCash(a) === true, 'Kiwibank Debit card balance 0 syncs');
  assert(coerceAkahuBalance(a.balance) === 0, 'coerce keeps 0');
  assert(
    cashAccountDisplayName(a) === 'Debit card · 38-9014-0109286-02',
    'Debit card display name',
  );
  passed += 1;
}

{
  assert(coerceAkahuBalance({ current: 12.5, currency: 'NZD' }) === 12.5, 'object coerce');
  assert(coerceAkahuBalance(99) === 99, 'number coerce');
  assert(coerceAkahuBalance('3.14') === 3.14, 'string coerce');
  assert(coerceAkahuBalance(null) === null, 'null coerce');
  assert(coerceAkahuBalance({}) === null, 'empty object not a balance');
  // Critical: never stringify the object into UI
  const label = ['Main', '38-9014-0109286-01', coerceAkahuBalance({ current: 1, available: 1 })]
    .filter((x) => x != null && x !== '')
    .join(' · ');
  assert(label === 'Main · 38-9014-0109286-01 · 1', 'join uses numeric current not [object Object]');
  passed += 1;
}

{
  const a: AkahuAccount = {
    _id: 'acc_asb',
    name: 'Everyday',
    type: 'CHECKING',
    status: 'ACTIVE',
    connection: { _id: 'conn_asb', name: 'ASB' },
    balance: { currency: 'NZD', current: 12.34 },
  };
  assert(shouldSyncAsCash(a) === true, 'ASB CHECKING syncs without name whitelist');
  passed += 1;
}

{
  assert(
    shouldSyncAsCash(
      kiwibank({
        name: "Nathan's Investments",
        type: 'INVESTMENT',
        connection: { _id: 'c', name: 'Sharesies' },
        balance: { currency: 'NZD', current: 100 },
      }),
    ) === false,
    'INVESTMENT not cash',
  );
  assert(
    shouldSyncAsCash(
      kiwibank({
        name: "Nathan's KiwiSaver",
        type: 'KIWISAVER',
        connection: { _id: 'c', name: 'Sharesies' },
        balance: { currency: 'NZD', current: 28000 },
      }),
    ) === false,
    'KIWISAVER not cash',
  );
  passed += 1;
}


{
  assert(mapAkahuAccountType('WALLET') === 'wallet', 'WALLET → wallet');
  assert(mapAkahuAccountType('LOAN') === 'loan', 'LOAN → loan');
  assert(mapAkahuAccountType('CREDITCARD') === 'credit', 'CREDITCARD → credit');
  assert(isLiquidCashAccountType('cheque') === true, 'cheque is liquid');
  assert(isLiquidCashAccountType('savings') === true, 'savings is liquid');
  assert(isLiquidCashAccountType('wallet') === true, 'wallet is liquid');
  assert(isLiquidCashAccountType('term_deposit') === true, 'term_deposit is liquid');
  assert(isLiquidCashAccountType('credit') === false, 'credit not liquid');
  assert(isLiquidCashAccountType('loan') === false, 'loan not liquid');
  assert(
    isLiquidCashAccountType('other', 'akahu:acc_x · Sharesies WALLET') === true,
    'legacy other+WALLET notes is liquid',
  );
  assert(isLiquidCashAccountType('other', 'manual note') === false, 'plain other not liquid');
  assert(LIQUID_CASH_ACCOUNT_TYPES.has('wallet'), 'wallet in liquid set');
  assert(LIABILITY_ACCOUNT_TYPES.has('credit'), 'credit in liability set');
  // Sharesies Spend negative still liquid (cheque)
  assert(isLiquidCashAccountType('cheque') === true, 'Spend cheque stays in cash total');
  passed += 1;
}


{
  // Sharesies Spend payment card — CHECKING with TRANSACTIONS (not INVESTMENT)
  const a: AkahuAccount = {
    _id: 'acc_spend',
    name: "Nathan's Spend",
    type: 'CHECKING',
    status: 'ACTIVE',
    connection: { _id: 'c', name: 'Sharesies' },
    balance: { currency: 'NZD', current: -2.9 },
    attributes: ['TRANSACTIONS'],
  };
  assert(shouldSyncAsCash(a) === true, 'Sharesies Spend CHECKING syncs as cash');
  assert(mapAkahuAccountType('CHECKING') === 'cheque', 'Spend CHECKING → cheque');
  assert(
    cashAccountDisplayName(a) === "Nathan's Spend",
    'Spend display name without formatted_account',
  );
  passed += 1;
}

{
  const base = {
    _id: 'trans_x',
    _account: 'acc_spend',
    date: '2026-10-01T12:00:00.000Z',
    description: 'UBER *EATS',
    amount: -48.81,
    type: 'EFTPOS',
    merchant: { name: 'Uber Eats' },
    meta: { card_suffix: '2324' },
  } as AkahuTransaction;
  assert(
    deriveCardName(base, "Nathan's Spend", 'Sharesies') === 'Sharesies Spend ····2324',
    'Spend card_suffix tags Sharesies Spend',
  );
  assert(
    deriveCardName(
      { ...base, meta: {} },
      "Nathan's Spend",
      'Sharesies',
    ) === 'Sharesies Spend · EFTPOS',
    'Spend EFTPOS without suffix',
  );
  assert(
    deriveCardName(
      { ...base, type: 'TRANSFER', amount: 45, description: 'Deposit', merchant: undefined, meta: {} },
      "Nathan's Spend",
      'Sharesies',
    ) === 'Sharesies Spend',
    'Spend transfer uses Sharesies Spend label',
  );
  assert(
    deriveCardName(base, 'Main · 38-9014-0109286-01', 'Kiwibank') === 'EFTPOS ····2324',
    'Kiwibank still uses type····suffix',
  );
  passed += 1;
}

console.log(`ok — ${passed} cash-sync checks passed (Kiwibank balance coerce)`);
