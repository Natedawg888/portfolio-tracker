/**
 * Generic spend / Google Wallet CSV import (post–Takeout conversion or manual export).
 * Docs: docs/GOOGLE_PAY_WALLET.md, docs/IMPORT_FORMATS.md
 * No official Google Pay personal transaction API — file import only.
 *
 * Expected columns (flexible aliases):
 *   date / transactionTime / Date
 *   description / merchant / Merchant / counterparty
 *   amount / Amount
 *   card_name / cardName / paymentInstrument / Card / instrument
 *   optional: currency, external_id / id, status
 */
import type { CurrencyCode, TransactionKind } from '../types';
import type { ImportParseError, ImportResult } from './types';

export type WalletCsvRow = {
  date: string; // YYYY-MM-DD
  description: string;
  amount: number; // signed; negative = outflow
  kind: TransactionKind;
  cardName: string | null;
  currency: CurrencyCode;
  externalId: string | null;
  accountId: string;
};

function splitCsvLine(line: string): string[] {
  const out: string[] = [];
  let cur = '';
  let inQuotes = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (inQuotes) {
      if (ch === '"') {
        if (line[i + 1] === '"') {
          cur += '"';
          i += 1;
        } else {
          inQuotes = false;
        }
      } else {
        cur += ch;
      }
    } else if (ch === '"') {
      inQuotes = true;
    } else if (ch === ',') {
      out.push(cur);
      cur = '';
    } else {
      cur += ch;
    }
  }
  out.push(cur);
  return out.map((c) => c.trim());
}

function normHeader(h: string): string {
  return h.trim().toLowerCase().replace(/[\s_-]+/g, '');
}

type ColKey =
  | 'date'
  | 'description'
  | 'amount'
  | 'cardName'
  | 'currency'
  | 'externalId'
  | 'status'
  | 'debit'
  | 'credit';

const ALIASES: Record<ColKey, string[]> = {
  date: ['date', 'transactiontime', 'transactiondate', 'datetime', 'posted', 'postedat'],
  description: [
    'description',
    'merchant',
    'merchantname',
    'counterparty',
    'payee',
    'memo',
    'particulars',
    'name',
  ],
  amount: ['amount', 'value', 'nzd', 'transactionamount'],
  cardName: [
    'cardname',
    'card',
    'paymentinstrument',
    'instrument',
    'paymentmethod',
    'walletcard',
    'last4',
  ],
  currency: ['currency', 'ccy', 'curr'],
  externalId: ['externalid', 'id', 'transactionid', 'txid', 'fitid'],
  status: ['status', 'state'],
  debit: ['debit', 'withdrawal', 'out'],
  credit: ['credit', 'deposit', 'in'],
};

function sniffColumns(headers: string[]): Partial<Record<ColKey, number>> {
  const map: Partial<Record<ColKey, number>> = {};
  const normalized = headers.map(normHeader);
  for (const [key, aliases] of Object.entries(ALIASES) as Array<[ColKey, string[]]>) {
    const idx = normalized.findIndex((h) => aliases.includes(h));
    if (idx >= 0) map[key] = idx;
  }
  return map;
}

/** Parse NZ / ISO / US-ish dates → YYYY-MM-DD (null if unparseable). */
export function parseFlexibleDate(raw: string): string | null {
  const s = raw.trim();
  if (!s) return null;
  // ISO date or datetime
  const iso = s.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (iso) return `${iso[1]}-${iso[2]}-${iso[3]}`;
  // DD/MM/YYYY or D/M/YYYY (NZ)
  const dmy = s.match(/^(\d{1,2})[/.-](\d{1,2})[/.-](\d{4})/);
  if (dmy) {
    const d = dmy[1].padStart(2, '0');
    const m = dmy[2].padStart(2, '0');
    const y = dmy[3];
    return `${y}-${m}-${d}`;
  }
  // Fallback: Date parse then Auckland calendar day
  const t = Date.parse(s);
  if (!Number.isNaN(t)) {
    const parts = new Intl.DateTimeFormat('en-CA', {
      timeZone: 'Pacific/Auckland',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    }).formatToParts(new Date(t));
    const y = parts.find((p) => p.type === 'year')?.value;
    const m = parts.find((p) => p.type === 'month')?.value;
    const d = parts.find((p) => p.type === 'day')?.value;
    if (y && m && d) return `${y}-${m}-${d}`;
  }
  return null;
}

function parseAmount(raw: string): number | null {
  let s = raw.trim();
  if (!s) return null;
  // (12.34) → -12.34
  if (/^\(.*\)$/.test(s)) s = `-${s.slice(1, -1)}`;
  s = s.replace(/[^0-9.+-]/g, '');
  if (!s || s === '-' || s === '+') return null;
  const n = Number(s);
  return Number.isFinite(n) ? n : null;
}

export function parseWalletCsv(csvText: string, accountId: string): ImportResult<WalletCsvRow> {
  const errors: ImportParseError[] = [];
  const lines = csvText.split(/\r?\n/).filter((l) => l.trim().length > 0);
  if (lines.length === 0) {
    return { items: [], errors: [{ message: 'Empty CSV' }], sourceLabel: 'wallet_csv' };
  }

  const headers = splitCsvLine(lines[0]);
  const cols = sniffColumns(headers);
  if (cols.date == null) {
    errors.push({ message: 'Missing date column (aliases: date, transactionTime, Date)' });
  }
  if (cols.amount == null && cols.debit == null && cols.credit == null) {
    errors.push({ message: 'Missing amount column (aliases: amount, Amount, or debit/credit)' });
  }
  if (errors.length) {
    return { items: [], errors, sourceLabel: 'wallet_csv', headers };
  }

  const items: WalletCsvRow[] = [];
  for (let i = 1; i < lines.length; i++) {
    const cells = splitCsvLine(lines[i]);
    const rowNum = i + 1;

    const statusRaw = cols.status != null ? (cells[cols.status] ?? '') : '';
    if (statusRaw && /fail|cancel|declin|pending|void/i.test(statusRaw)) {
      continue;
    }

    const dateRaw = cells[cols.date!] ?? '';
    const date = parseFlexibleDate(dateRaw);
    if (!date) {
      errors.push({ row: rowNum, message: `Unparseable date: ${dateRaw}` });
      continue;
    }

    let amount: number | null = null;
    if (cols.amount != null) {
      amount = parseAmount(cells[cols.amount] ?? '');
    } else {
      const deb = cols.debit != null ? parseAmount(cells[cols.debit] ?? '') : null;
      const cred = cols.credit != null ? parseAmount(cells[cols.credit] ?? '') : null;
      if (deb != null && deb !== 0) amount = -Math.abs(deb);
      else if (cred != null && cred !== 0) amount = Math.abs(cred);
    }
    if (amount == null) {
      errors.push({ row: rowNum, message: 'Missing/invalid amount' });
      continue;
    }

    const descIdx = cols.description;
    const description =
      (descIdx != null ? (cells[descIdx] ?? '').trim() : '') || '(wallet import)';

    const cardName =
      cols.cardName != null ? (cells[cols.cardName] ?? '').trim() || null : null;

    let currency: CurrencyCode = 'NZD';
    if (cols.currency != null) {
      const c = (cells[cols.currency] ?? '').trim().toUpperCase();
      if (c === 'NZD' || c === 'USD' || c === 'AUD' || c === 'EUR' || c === 'GBP') {
        currency = c;
      }
    }

    const externalId =
      cols.externalId != null ? (cells[cols.externalId] ?? '').trim() || null : null;

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
  }

  return { items, errors, sourceLabel: 'wallet_csv', headers };
}
