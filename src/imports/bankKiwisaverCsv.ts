/**
 * Bank-held KiwiSaver snapshot CSV (manual — IRD/Akahu bank KS not available).
 * Docs: docs/IMPORT_FORMATS.md · docs/SHARESIES_KIWISAVER.md
 *
 * One row per scheme, or multiple rows per scheme when fund-mix columns are present.
 * Never invents balances; never accepts passwords.
 */

import type { ImportParseError, ImportResult, KiwiSaverHoldingSnapshot } from './types';

export type BankKiwiSaverCsvRow = {
  provider: string;
  schemeName: string | null;
  name: string;
  balanceNzd: number;
  amountInvestedNzd: number | null;
  returnsNzd: number | null;
  observedAt: string | null;
  notes: string | null;
  holdings: KiwiSaverHoldingSnapshot[];
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
  | 'provider'
  | 'schemeName'
  | 'name'
  | 'balance'
  | 'invested'
  | 'returns'
  | 'observedAt'
  | 'notes'
  | 'fundName'
  | 'fundAllocationPct'
  | 'fundBalance';

const ALIASES: Record<ColKey, string[]> = {
  provider: ['provider', 'bank', 'institution', 'schemeprovider', 'manager'],
  schemeName: ['schemename', 'scheme', 'fundscheme', 'product'],
  name: ['name', 'accountname', 'label', 'displayname'],
  balance: ['balancenzd', 'balance', 'currentbalance', 'value', 'valuenzd', 'total'],
  invested: [
    'amountinvestednzd',
    'amountinvested',
    'invested',
    'investednzd',
    'contributions',
    'cost',
    'costbasis',
    'costbasisnzd',
  ],
  returns: ['returnsnzd', 'returns', 'earnings', 'earningsnzd', 'gain', 'gainnzd'],
  observedAt: ['observedat', 'asof', 'date', 'asat', 'statementdate', 'balancedate'],
  notes: ['notes', 'note', 'comment', 'comments'],
  fundName: ['fundname', 'fund', 'holding', 'holdingname', 'investment'],
  fundAllocationPct: ['fundallocationpct', 'allocationpct', 'allocation', 'weight', 'weightpct', 'pct'],
  fundBalance: ['fundbalancenzd', 'fundbalance', 'fundvalue', 'holdingvalue', 'holdingbalancenzd'],
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

function cell(cells: string[], idx: number | undefined): string {
  if (idx == null || idx < 0 || idx >= cells.length) return '';
  return cells[idx]?.trim() ?? '';
}

function parseNum(raw: string): number | null {
  if (!raw) return null;
  const cleaned = raw.replace(/[$,\s]/g, '').replace(/^\((.+)\)$/, '-$1');
  const n = Number(cleaned);
  return Number.isFinite(n) ? n : null;
}

/** Parse NZ / ISO dates → YYYY-MM-DD (null if unparseable). */
export function parseBankKsDate(raw: string): string | null {
  const s = raw.trim();
  if (!s) return null;
  const iso = s.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (iso) return `${iso[1]}-${iso[2]}-${iso[3]}`;
  const dmy = s.match(/^(\d{1,2})[/.-](\d{1,2})[/.-](\d{4})/);
  if (dmy) {
    const dd = dmy[1].padStart(2, '0');
    const mm = dmy[2].padStart(2, '0');
    return `${dmy[3]}-${mm}-${dd}`;
  }
  return null;
}

function schemeKey(provider: string, schemeName: string | null, name: string): string {
  return `${provider.trim().toLowerCase()}|${(schemeName ?? name).trim().toLowerCase()}`;
}

/**
 * Parse bank-held KiwiSaver CSV into upsertable scheme snapshots.
 * Required: balance (+ provider or scheme_name or name).
 */
export function parseBankKiwisaverCsv(csvText: string): ImportResult<BankKiwiSaverCsvRow> {
  const errors: ImportParseError[] = [];
  const lines = csvText.split(/\r?\n/).filter((l) => l.trim().length > 0);
  if (lines.length < 2) {
    return {
      items: [],
      errors: [{ message: 'CSV needs a header row and at least one data row.' }],
      sourceLabel: 'bank_kiwisaver_csv',
    };
  }

  const headers = splitCsvLine(lines[0]);
  const cols = sniffColumns(headers);
  if (cols.balance == null) {
    return {
      items: [],
      errors: [
        {
          message:
            'Missing balance column. Use balance_nzd (aliases: balance, value, value_nzd, total).',
        },
      ],
      sourceLabel: 'bank_kiwisaver_csv',
      headers,
    };
  }
  if (cols.provider == null && cols.schemeName == null && cols.name == null) {
    return {
      items: [],
      errors: [
        {
          message:
            'Need a provider, scheme_name, or name column to identify the bank-held scheme.',
        },
      ],
      sourceLabel: 'bank_kiwisaver_csv',
      headers,
    };
  }

  const byKey = new Map<string, BankKiwiSaverCsvRow>();

  for (let i = 1; i < lines.length; i++) {
    const rowNum = i + 1;
    const cells = splitCsvLine(lines[i]);
    if (cells.every((c) => !c)) continue;

    const balance = parseNum(cell(cells, cols.balance));
    if (balance == null || balance < 0) {
      errors.push({ row: rowNum, message: 'Invalid or missing balance_nzd' });
      continue;
    }

    const providerRaw = cell(cells, cols.provider);
    const schemeRaw = cell(cells, cols.schemeName);
    const nameRaw = cell(cells, cols.name);
    const provider = providerRaw || schemeRaw || nameRaw || 'Bank';
    // Reject Sharesies rows here — that path is Akahu / Sharesies CSV stub.
    if (provider.trim().toLowerCase() === 'sharesies') {
      errors.push({
        row: rowNum,
        message: 'provider=sharesies belongs on the Sharesies/Akahu path, not bank CSV.',
      });
      continue;
    }

    const schemeName = schemeRaw || null;
    const name =
      nameRaw ||
      (schemeName ? `${provider} ${schemeName}` : `${provider} KiwiSaver`);
    const invested = parseNum(cell(cells, cols.invested));
    const returns = parseNum(cell(cells, cols.returns));
    const observedRaw = cell(cells, cols.observedAt);
    const observedAt = observedRaw ? parseBankKsDate(observedRaw) : null;
    if (observedRaw && !observedAt) {
      errors.push({ row: rowNum, message: `Unparseable date: ${observedRaw}` });
    }
    const notes = cell(cells, cols.notes) || null;

    const fundName = cell(cells, cols.fundName);
    const fundAlloc = parseNum(cell(cells, cols.fundAllocationPct));
    const fundBal = parseNum(cell(cells, cols.fundBalance));
    const holding: KiwiSaverHoldingSnapshot | null = fundName
      ? {
          name: fundName,
          valueNzd: fundBal ?? 0,
          weightPct: fundAlloc ?? undefined,
        }
      : null;

    const key = schemeKey(provider, schemeName, name);
    const existing = byKey.get(key);
    if (!existing) {
      byKey.set(key, {
        provider: provider.trim(),
        schemeName,
        name,
        balanceNzd: balance,
        amountInvestedNzd: invested,
        returnsNzd: returns,
        observedAt,
        notes,
        holdings: holding ? [holding] : [],
      });
    } else {
      // Later rows for same scheme: prefer non-null metrics; append fund mix.
      existing.balanceNzd = balance;
      if (invested != null) existing.amountInvestedNzd = invested;
      if (returns != null) existing.returnsNzd = returns;
      if (observedAt) existing.observedAt = observedAt;
      if (notes) existing.notes = notes;
      if (holding) existing.holdings.push(holding);
    }
  }

  return {
    items: [...byKey.values()],
    errors,
    sourceLabel: 'bank_kiwisaver_csv',
    headers,
  };
}
