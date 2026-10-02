/**
 * Best-effort Google Takeout Google Pay / Wallet JSON → WalletCsvRow-like items.
 * Docs: docs/GOOGLE_PAY_WALLET.md
 * Official export: https://takeout.google.com — no third-party history API.
 *
 * Field names below are PROVISIONAL (cited from third-party Takeout walkthroughs).
 * Do not treat as locked schema — inspect a real Takeout sample before relying on them.
 * Known provisional keys: transactionTime, amount, currency, paymentInstrument, status,
 * plus merchant / counterparty / description variants.
 */
import type { CurrencyCode, TransactionKind } from '../types';
import type { ImportParseError, ImportResult } from './types';
import { parseFlexibleDate, type WalletCsvRow } from './walletCsv';

type Loose = Record<string, unknown>;

function asString(v: unknown): string | null {
  if (v == null) return null;
  if (typeof v === 'string') return v;
  if (typeof v === 'number' || typeof v === 'boolean') return String(v);
  return null;
}

function asNumber(v: unknown): number | null {
  if (typeof v === 'number' && Number.isFinite(v)) return v;
  if (typeof v === 'string') {
    const n = Number(v.replace(/[^0-9.+-]/g, ''));
    return Number.isFinite(n) ? n : null;
  }
  if (v && typeof v === 'object' && 'amount' in (v as Loose)) {
    return asNumber((v as Loose).amount);
  }
  return null;
}

function pick(obj: Loose, keys: string[]): unknown {
  for (const k of keys) {
    if (k in obj && obj[k] != null && obj[k] !== '') return obj[k];
  }
  // case-insensitive
  const lower = Object.fromEntries(
    Object.entries(obj).map(([k, v]) => [k.toLowerCase(), v]),
  );
  for (const k of keys) {
    const hit = lower[k.toLowerCase()];
    if (hit != null && hit !== '') return hit;
  }
  return undefined;
}

function walkArrays(root: unknown): Loose[] {
  if (Array.isArray(root)) {
    return root.filter((x) => x && typeof x === 'object') as Loose[];
  }
  if (root && typeof root === 'object') {
    const o = root as Loose;
    // Common Takeout wrappers
    for (const key of ['transactions', 'Wallet transactions', 'Google Pay', 'items', 'Activity']) {
      if (Array.isArray(o[key])) return walkArrays(o[key]);
    }
    // Single object that looks like a txn
    if (pick(o, ['transactionTime', 'amount', 'date'])) return [o];
  }
  return [];
}

export function parseGooglePayTakeoutJson(
  jsonText: string,
  accountId: string,
): ImportResult<WalletCsvRow> {
  const errors: ImportParseError[] = [];
  let root: unknown;
  try {
    root = JSON.parse(jsonText);
  } catch {
    return {
      items: [],
      errors: [{ message: 'Invalid JSON' }],
      sourceLabel: 'google_pay_takeout',
    };
  }

  const rows = walkArrays(root);
  if (rows.length === 0) {
    return {
      items: [],
      errors: [
        {
          message:
            'No transaction-like array found. Confirm Takeout product (Google Pay / Wallet) and inspect sample field names — see docs/GOOGLE_PAY_WALLET.md.',
        },
      ],
      sourceLabel: 'google_pay_takeout',
    };
  }

  const items: WalletCsvRow[] = [];
  rows.forEach((row, i) => {
    const status = asString(pick(row, ['status', 'state']));
    if (status && /fail|cancel|declin|pending|void/i.test(status)) return;

    const timeRaw = asString(
      pick(row, ['transactionTime', 'transaction_time', 'date', 'time', 'timestamp']),
    );
    if (!timeRaw) {
      errors.push({ row: i + 1, message: 'Missing transactionTime/date' });
      return;
    }
    const date = parseFlexibleDate(timeRaw);
    if (!date) {
      errors.push({ row: i + 1, message: `Unparseable date: ${timeRaw}` });
      return;
    }

    const amountRaw = pick(row, ['amount', 'transactionAmount', 'value']);
    let amount = asNumber(amountRaw);
    // Nested { units, currencyCode } style (provisional)
    if (amount == null && amountRaw && typeof amountRaw === 'object') {
      const a = amountRaw as Loose;
      amount = asNumber(a.units ?? a.amount ?? a.value);
      if (amount != null && asString(a.nanos)) {
        /* ignore nanos for v1 */
      }
    }
    if (amount == null) {
      errors.push({ row: i + 1, message: 'Missing amount' });
      return;
    }

    const description =
      asString(
        pick(row, [
          'merchant',
          'merchantName',
          'counterparty',
          'description',
          'title',
          'name',
        ]),
      ) || '(takeout import)';

    const instrument = pick(row, [
      'paymentInstrument',
      'payment_instrument',
      'card',
      'cardName',
      'instrument',
    ]);
    let cardName: string | null = null;
    if (typeof instrument === 'string') cardName = instrument.trim() || null;
    else if (instrument && typeof instrument === 'object') {
      const inst = instrument as Loose;
      cardName =
        asString(pick(inst, ['name', 'displayName', 'label', 'last4', 'lastDigits'])) ?? null;
      const last4 = asString(pick(inst, ['last4', 'lastDigits', 'suffix']));
      if (cardName && last4 && !cardName.includes(last4)) {
        cardName = `${cardName} ····${last4}`;
      } else if (!cardName && last4) {
        cardName = `Card ····${last4}`;
      }
    }

    let currency: CurrencyCode = 'NZD';
    const ccy = asString(pick(row, ['currency', 'currencyCode', 'ccy']))?.toUpperCase();
    if (ccy === 'NZD' || ccy === 'USD' || ccy === 'AUD' || ccy === 'EUR' || ccy === 'GBP') {
      currency = ccy;
    }
    if (amountRaw && typeof amountRaw === 'object') {
      const nested = asString(
        pick(amountRaw as Loose, ['currency', 'currencyCode']),
      )?.toUpperCase();
      if (nested === 'NZD' || nested === 'USD' || nested === 'AUD' || nested === 'EUR' || nested === 'GBP') {
        currency = nested;
      }
    }

    const externalId = asString(pick(row, ['id', 'transactionId', 'externalId', '_id']));
    const kind: TransactionKind = amount < 0 ? 'debit' : amount > 0 ? 'credit' : 'debit';

    items.push({
      date,
      description,
      amount,
      kind,
      cardName,
      currency,
      externalId,
      accountId,
    });
  });

  return { items, errors, sourceLabel: 'google_pay_takeout' };
}
