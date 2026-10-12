/**
 * KiwiSaver — Sharesies via Akahu + bank-held manual/CSV.
 * Prefer Akahu for Sharesies. Bank KS: manual form / CSV (IRD/Akahu bank KS not available).
 * Never scrape. Never store passwords. Never invent balances.
 */
import { Router } from 'express';
import type { AuthedRequest } from '../middleware/requireAuth.ts';
import { requireUserId } from '../lib/userScope.ts';
import { getDb, queryAll, queryOne, run, newId } from '../db/index.ts';
import { parseBankKiwisaverCsv } from '../../src/imports/bankKiwisaverCsv.ts';
import { normalizeLogoUrl } from '../../src/lib/holdingIcons.ts';

const router = Router();

router.use((req, res, next) => {
  const userId = requireUserId(req as AuthedRequest, res);
  if (!userId) return;
  (req as AuthedRequest & { scopeUserId: string }).scopeUserId = userId;
  next();
});
function uid(req: { scopeUserId?: string; user?: { id?: string } | null }): string {
  return (req as AuthedRequest & { scopeUserId?: string }).scopeUserId
    || (req as AuthedRequest).user?.id
    || '';
}


type FundMixRow = {
  fundName: string;
  allocationPct: number | null;
  balanceNzd: number | null;
  returnsNzd?: number | null;
  shares?: number | null;
  symbol?: string;
  logo?: string;
  fundId?: string;
  currency?: string;
};

function parseFundMix(raw: unknown): FundMixRow[] {
  try {
    const v = JSON.parse((raw as string) || '[]');
    if (!Array.isArray(v)) return [];
    return v.map((item) => {
      if (!item || typeof item !== 'object') return item as FundMixRow;
      const o = item as FundMixRow;
      const logo = typeof o.logo === 'string' ? normalizeLogoUrl(o.logo) : null;
      return logo ? { ...o, logo } : { ...o, logo: undefined };
    });
  } catch {
    return [];
  }
}

function finiteOrNull(v: unknown): number | null {
  if (v == null || v === '') return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

/**
 * amountInvested = balance − returns when both real.
 * If caller supplies amountInvested without returns, derive returns = balance − invested.
 */
function resolveReturnsAndInvested(
  balanceNzd: number,
  returnsIn: number | null,
  investedIn: number | null,
): { returnsNzd: number | null; amountInvestedNzd: number | null; returnPct: number | null } {
  let returnsNzd = returnsIn;
  if (returnsNzd == null && investedIn != null && Number.isFinite(balanceNzd)) {
    returnsNzd = Math.round((balanceNzd - investedIn) * 100) / 100;
  }
  const amountInvestedNzd =
    returnsNzd != null && Number.isFinite(balanceNzd)
      ? Math.round((balanceNzd - returnsNzd) * 100) / 100
      : investedIn != null && Number.isFinite(investedIn)
        ? investedIn
        : null;
  const returnPct =
    amountInvestedNzd != null && amountInvestedNzd > 0 && returnsNzd != null
      ? Math.round((returnsNzd / amountInvestedNzd) * 10000) / 100
      : null;
  return { returnsNzd, amountInvestedNzd, returnPct };
}

function normaliseFundMix(raw: unknown): FundMixRow[] {
  if (!Array.isArray(raw)) return [];
  const out: FundMixRow[] = [];
  for (const item of raw) {
    if (!item || typeof item !== 'object') continue;
    const o = item as Record<string, unknown>;
    const fundName = String(o.fundName ?? o.name ?? '').trim();
    if (!fundName) continue;
    out.push({
      fundName,
      allocationPct: finiteOrNull(o.allocationPct ?? o.weightPct),
      balanceNzd: finiteOrNull(o.balanceNzd ?? o.valueNzd),
      returnsNzd: finiteOrNull(o.returnsNzd),
      shares: finiteOrNull(o.shares ?? o.units),
      symbol: typeof o.symbol === 'string' ? o.symbol : undefined,
      logo: typeof o.logo === 'string' ? (normalizeLogoUrl(o.logo) ?? undefined) : undefined,
      fundId: typeof o.fundId === 'string' ? o.fundId : undefined,
      currency: typeof o.currency === 'string' ? o.currency : undefined,
    });
  }
  return out;
}

function dataSourceOf(r: Record<string, unknown>): {
  dataSource: 'akahu' | 'manual' | 'csv' | 'other';
  dataSourceLabel: string;
} {
  const status = String(r.connection_status ?? '');
  const ext = r.external_id != null ? String(r.external_id) : '';
  const provider = String(r.provider ?? '').toLowerCase();
  if (status === 'akahu' || ext.startsWith('akahu:')) {
    return { dataSource: 'akahu', dataSourceLabel: 'Akahu (Sharesies)' };
  }
  if (status === 'csv_import') {
    if (provider === 'sharesies') {
      return { dataSource: 'csv', dataSourceLabel: 'Manual (Sharesies CSV stub)' };
    }
    return { dataSource: 'csv', dataSourceLabel: 'Manual (CSV)' };
  }
  if (status === 'manual') {
    return { dataSource: 'manual', dataSourceLabel: 'Manual' };
  }
  if (status === 'official_pending') {
    return { dataSource: 'other', dataSourceLabel: 'Observe pending (not Akahu)' };
  }
  return { dataSource: 'other', dataSourceLabel: status || 'other' };
}

function mapKs(r: Record<string, unknown>) {
  const fundMix = parseFundMix(r.fund_mix_json);
  const balanceNzd = Number(r.balance_nzd ?? 0);
  const returnsStored = finiteOrNull(r.returns_nzd);
  const { amountInvestedNzd, returnPct, returnsNzd } = resolveReturnsAndInvested(
    balanceNzd,
    returnsStored,
    null,
  );
  const portfolioSumNzd = fundMix.reduce(
    (s, f) => s + (f.balanceNzd != null && Number.isFinite(f.balanceNzd) ? f.balanceNzd : 0),
    0,
  );
  const residualNzd =
    fundMix.length > 0 ? Math.round((balanceNzd - portfolioSumNzd) * 100) / 100 : null;
  const { dataSource, dataSourceLabel } = dataSourceOf(r);
  const provider = String(r.provider ?? 'sharesies');
  const isAkahuSharesies = dataSource === 'akahu' || provider.toLowerCase() === 'sharesies';

  return {
    id: r.id,
    name: r.name,
    provider,
    schemeName: r.scheme_name,
    balanceNzd,
    returnsNzd,
    amountInvestedNzd,
    returnPct,
    governmentContributionNzd: null as number | null,
    governmentContributionStatus: 'unavailable' as const,
    governmentContributionNote: isAkahuSharesies
      ? 'Akahu Sharesies KiwiSaver does not expose government contribution as a separate field. Check Sharesies statements / IRD for official figures.'
      : 'Government contribution is not tracked for manual/CSV bank-held KiwiSaver. Check your provider statements / IRD for official figures.',
    pir: finiteOrNull(r.pir),
    fundMix,
    portfolioSumNzd: fundMix.length ? portfolioSumNzd : null,
    residualNzd:
      residualNzd != null && Math.abs(residualNzd) >= 0.01 ? residualNzd : null,
    residualNote:
      residualNzd != null && Math.abs(residualNzd) >= 0.01
        ? dataSource === 'akahu'
          ? 'Account balance minus sum of Akahu portfolio holdings — not labelled by Akahu (may be cash / unlisted base fund / incomplete mix).'
          : 'Account balance minus sum of fund-mix rows — gap may be cash or incomplete mix.'
        : null,
    observedAt: r.observed_at,
    connectionStatus: r.connection_status,
    dataSource,
    dataSourceLabel,
    notes: r.notes,
    activityStatus: (r.activity_status as string | null) ?? null,
    activityNote: (r.activity_note as string | null) ?? null,
    externalId: r.external_id ?? null,
    createdAt: r.created_at,
    updatedAt: r.updated_at,
  };
}

function upsertHistoryPoint(
  db: Awaited<ReturnType<typeof getDb>>,
  accountId: string,
  day: string,
  balance: number,
  returnsNzd: number | null,
  source: string,
) {
  const hist = queryOne(
    db,
    `SELECT id, source FROM kiwisaver_balance_history WHERE account_id=? AND observed_at=?`,
    [accountId, day],
  );
  if (hist) {
    // Don't overwrite an Akahu point with a weaker manual/csv source on the same day
    // unless the new source is also akahu or the existing was manual/csv.
    const existingSource = String(hist.source ?? '');
    if (existingSource === 'akahu' && source !== 'akahu') {
      return;
    }
    run(
      db,
      `UPDATE kiwisaver_balance_history SET balance_nzd=?, returns_nzd=?, source=? WHERE id=?`,
      [balance, returnsNzd, source, hist.id],
    );
  } else {
    run(
      db,
      `INSERT INTO kiwisaver_balance_history
        (id, account_id, observed_at, balance_nzd, returns_nzd, source)
       VALUES (?,?,?,?,?,?)`,
      [newId('ksh'), accountId, day, balance, returnsNzd, source],
    );
  }
}

function findManualByProviderScheme(
  db: Awaited<ReturnType<typeof getDb>>,
  provider: string,
  schemeName: string | null,
  userId: string,
) {
  const rows = queryAll(
    db,
    `SELECT * FROM kiwisaver_accounts
     WHERE user_id = ?
       AND lower(provider)=lower(?)
       AND (external_id IS NULL OR external_id NOT LIKE 'akahu:%')
       AND connection_status IN ('manual','csv_import','off')`,
    [userId, provider],
  );
  const schemeKey = (schemeName ?? '').trim().toLowerCase();
  if (!schemeKey) {
    return rows.find((r) => !r.scheme_name) ?? rows[0] ?? null;
  }
  return (
    rows.find((r) => String(r.scheme_name ?? '').trim().toLowerCase() === schemeKey) ?? null
  );
}

router.get('/', async (req, res) => {
  const db = await getDb();
  const rows = queryAll(db, 'SELECT * FROM kiwisaver_accounts WHERE user_id = ? ORDER BY name', [uid(req)]);
  res.json(rows.map(mapKs));
});

/**
 * Balance history points recorded on Akahu sync / manual / CSV save.
 * Valuation snapshots are net-worth class totals and are not merged in:
 * a stale snapshot must not appear as, or cover, a real KiwiSaver point.
 * Days with no sync or save are absent.
 */
router.get('/history', async (req, res) => {
  const db = await getDb();
  const accountId =
    typeof req.query.accountId === 'string' && req.query.accountId
      ? req.query.accountId
      : null;
  let account = accountId
    ? queryOne(db, 'SELECT * FROM kiwisaver_accounts WHERE id=? AND user_id=?', [accountId, uid(req)])
    : queryOne(db, `SELECT * FROM kiwisaver_accounts WHERE user_id = ? AND provider='sharesies' LIMIT 1`, [uid(req)]);
  if (!account) {
    account = queryOne(db, `SELECT * FROM kiwisaver_accounts WHERE user_id = ? ORDER BY updated_at DESC LIMIT 1`, [uid(req)]);
  }
  if (!account) {
    return res.json({
      status: 'unavailable',
      message: 'No KiwiSaver account yet — sync via Akahu or add a bank-held scheme (manual/CSV).',
      source: 'local',
      points: [],
      accountId: null,
    });
  }
  const points = queryAll(
    db,
    `SELECT observed_at, balance_nzd, returns_nzd, source
     FROM kiwisaver_balance_history
     WHERE account_id=?
     ORDER BY observed_at ASC`,
    [account.id],
  ).map((p) => ({
    at: String(p.observed_at),
    balanceNzd: Number(p.balance_nzd),
    returnsNzd: finiteOrNull(p.returns_nzd),
    source: String(p.source ?? 'akahu'),
  }));

  const ds = dataSourceOf(account);
  res.json({
    status: points.length ? 'ok' : 'empty',
    message: points.length
      ? null
      : 'No balance history points yet. History builds from Akahu syncs and manual/CSV saves (no invented timeseries).',
    source: ds.dataSource === 'akahu' ? 'akahu_sync_local' : 'manual_local',
    accountId: account.id,
    points,
  });
});

/** Recent activity from Akahu KS ledger when available. */
router.get('/activity', async (req, res) => {
  const db = await getDb();
  const limit = Math.min(
    50,
    Math.max(1, Number(req.query.limit) || 20),
  );
  const accountId =
    typeof req.query.accountId === 'string' && req.query.accountId
      ? req.query.accountId
      : null;
  const account = accountId
    ? queryOne(db, 'SELECT * FROM kiwisaver_accounts WHERE id=? AND user_id=?', [accountId, uid(req)])
    : queryOne(db, `SELECT * FROM kiwisaver_accounts WHERE user_id = ? AND provider='sharesies' LIMIT 1`, [uid(req)]);
  if (!account) {
    return res.json({
      status: 'unavailable',
      message: 'No KiwiSaver account yet.',
      items: [],
      governmentContributionNzd: null,
      governmentContributionStatus: 'unavailable',
    });
  }
  const items = queryAll(
    db,
    `SELECT id, date, description, amount_nzd, txn_type, source, external_id
     FROM kiwisaver_activity
     WHERE account_id=?
     ORDER BY date DESC
     LIMIT ?`,
    [account.id, limit],
  ).map((r) => ({
    id: r.id,
    date: r.date,
    description: r.description,
    amountNzd: Number(r.amount_nzd),
    txnType: r.txn_type,
    source: r.source,
    externalId: r.external_id,
  }));

  const status =
    (account.activity_status as string) ||
    (items.length ? 'ok' : 'unavailable');

  res.json({
    status,
    message:
      (account.activity_note as string) ||
      (items.length
        ? null
        : 'No KiwiSaver ledger activity. Government contribution unavailable.'),
    items,
    governmentContributionNzd: null,
    governmentContributionStatus: 'unavailable',
    governmentContributionNote:
      'Not tracked as a separate field for Akahu Sharesies or manual bank-held KiwiSaver.',
  });
});

router.post('/', async (req, res) => {
  const db = await getDb();
  const b = req.body ?? {};
  const id = newId('ks');
  const now = new Date().toISOString();
  const fundMix = normaliseFundMix(b.fundMix);
  const balance = Number(b.balanceNzd ?? 0);
  if (!Number.isFinite(balance) || balance < 0) {
    return res.status(400).json({ error: 'balanceNzd must be a non-negative number' });
  }
  const providerRaw = typeof b.provider === 'string' ? b.provider.trim() : '';
  const provider = providerRaw || 'sharesies';
  const isManualBank = provider.toLowerCase() !== 'sharesies';
  const { returnsNzd } = resolveReturnsAndInvested(
    balance,
    b.returnsNzd !== undefined ? finiteOrNull(b.returnsNzd) : null,
    b.amountInvestedNzd !== undefined ? finiteOrNull(b.amountInvestedNzd) : null,
  );
  const connectionStatus =
    b.connectionStatus ?? (isManualBank ? 'manual' : 'off');
  const observedAt = typeof b.observedAt === 'string' && b.observedAt ? b.observedAt : now;
  const pir = b.pir !== undefined ? finiteOrNull(b.pir) : null;
  const name =
    b.name ??
    (isManualBank
      ? `${provider}${b.schemeName ? ` ${b.schemeName}` : ''} KiwiSaver`
      : 'Sharesies KiwiSaver');

  run(
    db,
    `INSERT INTO kiwisaver_accounts
      (id, user_id, name, provider, scheme_name, balance_nzd, returns_nzd, pir, fund_mix_json, observed_at,
       connection_status, notes, created_at, updated_at)
     VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
    [
      id,
      uid(req),
      name,
      provider,
      b.schemeName ?? null,
      balance,
      returnsNzd,
      pir,
      JSON.stringify(fundMix),
      observedAt,
      connectionStatus,
      b.notes ??
        (isManualBank
          ? 'Manual bank-held KiwiSaver (IRD/Akahu bank KS not available).'
          : null),
      now,
      now,
    ],
  );
  upsertHistoryPoint(
    db,
    id,
    observedAt.slice(0, 10),
    balance,
    returnsNzd,
    isManualBank ? 'manual' : 'manual',
  );
  res.status(201).json(mapKs(queryOne(db, 'SELECT * FROM kiwisaver_accounts WHERE id=? AND user_id=?', [id, uid(req)])!));
});

router.patch('/:id', async (req, res) => {
  const db = await getDb();
  const existing = queryOne(db, 'SELECT * FROM kiwisaver_accounts WHERE id=? AND user_id=?', [req.params.id, uid(req)]);
  if (!existing) return res.status(404).json({ error: 'Not found' });
  const b = req.body ?? {};
  const now = new Date().toISOString();
  const fundMix =
    b.fundMix !== undefined
      ? JSON.stringify(normaliseFundMix(b.fundMix))
      : existing.fund_mix_json;
  const balance =
    b.balanceNzd !== undefined ? Number(b.balanceNzd) : Number(existing.balance_nzd);
  if (!Number.isFinite(balance) || balance < 0) {
    return res.status(400).json({ error: 'balanceNzd must be a non-negative number' });
  }

  const isAkahu =
    String(existing.connection_status) === 'akahu' ||
    String(existing.external_id ?? '').startsWith('akahu:');

  // Do not let manual edits rebrand an Akahu Sharesies row's provider/external link.
  const provider =
    isAkahu
      ? existing.provider
      : b.provider !== undefined
        ? String(b.provider).trim() || existing.provider
        : existing.provider;

  // Prefer explicit returns; else derive from amountInvested; else keep stored returns.
  const returnsIn =
    b.returnsNzd !== undefined
      ? finiteOrNull(b.returnsNzd)
      : b.amountInvestedNzd !== undefined
        ? null
        : finiteOrNull(existing.returns_nzd);
  const investedIn =
    b.amountInvestedNzd !== undefined ? finiteOrNull(b.amountInvestedNzd) : null;
  const { returnsNzd: returnsFinal } = resolveReturnsAndInvested(
    balance,
    returnsIn,
    investedIn,
  );

  const pir =
    b.pir !== undefined ? finiteOrNull(b.pir) : finiteOrNull(existing.pir);

  let connectionStatus = b.connectionStatus ?? existing.connection_status;
  if (!isAkahu && b.balanceNzd !== undefined && connectionStatus === 'off') {
    connectionStatus = 'manual';
  }

  const observedAt = b.observedAt ?? now;
  run(
    db,
    `UPDATE kiwisaver_accounts SET
      name=?, provider=?, scheme_name=?, balance_nzd=?, returns_nzd=?, pir=?, fund_mix_json=?, observed_at=?,
      connection_status=?, notes=?, updated_at=?
     WHERE id=?`,
    [
      b.name ?? existing.name,
      provider,
      b.schemeName !== undefined ? b.schemeName : existing.scheme_name,
      balance,
      returnsFinal,
      pir,
      fundMix,
      observedAt,
      connectionStatus,
      b.notes !== undefined ? b.notes : existing.notes,
      now,
      req.params.id,
    ],
  );

  const histSource =
    String(connectionStatus) === 'csv_import' ? 'csv' : 'manual';
  // Record history for manual/CSV saves. Do not clobber Akahu same-day points
  // (upsertHistoryPoint refuses manual/csv over akahu).
  if (!isAkahu) {
    upsertHistoryPoint(
      db,
      String(req.params.id),
      String(observedAt).slice(0, 10),
      balance,
      returnsFinal,
      histSource,
    );
  }

  res.json(mapKs(queryOne(db, 'SELECT * FROM kiwisaver_accounts WHERE id=? AND user_id=?', [req.params.id, uid(req)])!));
});

router.delete('/:id', async (req, res) => {
  const db = await getDb();
  const existing = queryOne(db, 'SELECT * FROM kiwisaver_accounts WHERE id=? AND user_id=?', [req.params.id, uid(req)]);
  if (!existing) return res.status(404).json({ error: 'Not found' });
  const isAkahu =
    String(existing.connection_status) === 'akahu' ||
    String(existing.external_id ?? '').startsWith('akahu:');
  if (isAkahu) {
    return res.status(400).json({
      error:
        'Cannot delete an Akahu-synced Sharesies KiwiSaver account from here. Disconnect/sync from Settings if needed.',
    });
  }
  run(db, 'DELETE FROM kiwisaver_balance_history WHERE account_id=?', [req.params.id]);
  run(db, 'DELETE FROM kiwisaver_activity WHERE account_id=?', [req.params.id]);
  run(db, 'DELETE FROM kiwisaver_accounts WHERE id=? AND user_id=?', [req.params.id, uid(req)]);
  res.json({ ok: true, id: req.params.id });
});

/**
 * Stub Sharesies CSV/export import.
 * Does not scrape; does not accept passwords.
 * Parses nothing real yet — documents the intended path.
 */
router.post('/import-sharesies-csv', async (req, res) => {
  const db = await getDb();
  const { csvText, filename } = req.body ?? {};
  if (!csvText || typeof csvText !== 'string') {
    return res.status(400).json({
      ok: false,
      message: 'Provide csvText from an official Sharesies export. Never paste passwords.',
      rowsParsed: 0,
      accountId: null,
    });
  }

  const lines = csvText.split(/\r?\n/).filter((l: string) => l.trim().length > 0);
  const now = new Date().toISOString();

  let account = queryOne(db, `SELECT * FROM kiwisaver_accounts WHERE user_id = ? AND provider='sharesies' LIMIT 1`, [uid(req)]);
  if (!account) {
    const id = newId('ks');
    run(
      db,
      `INSERT INTO kiwisaver_accounts
        (id, user_id, name, provider, scheme_name, balance_nzd, fund_mix_json, observed_at, connection_status, notes, created_at, updated_at)
       VALUES (?,?,?,?,?,?,?,?,?,?,?,?)`,
      [id, uid(req), 'Sharesies KiwiSaver', 'sharesies', null, 0, '[]', null, 'csv_import', 'Awaiting CSV mapping', now, now],
    );
    account = queryOne(db, 'SELECT * FROM kiwisaver_accounts WHERE id=? AND user_id=?', [id, uid(req)]);
  } else {
    run(
      db,
      `UPDATE kiwisaver_accounts SET connection_status='csv_import', notes=?, updated_at=? WHERE id=?`,
      [
        `CSV stub received: ${filename ?? 'upload'} (${lines.length} lines). Official column mapping not implemented yet.`,
        now,
        account.id,
      ],
    );
    account = queryOne(db, 'SELECT * FROM kiwisaver_accounts WHERE id=? AND user_id=?', [account.id, uid(req)]);
  }

  res.json({
    ok: true,
    message:
      'Sharesies CSV import stubbed. Live connect awaits official export/API path. No balances invented from unparsed CSV. No passwords stored.',
    rowsParsed: Math.max(0, lines.length - 1),
    accountId: account!.id,
    connectionStatus: 'csv_import',
  });
});

/**
 * Bank-held KiwiSaver CSV import (manual path).
 * IRD/Akahu bank KS not available — user exports/types balances from bank statements.
 * Upserts by provider + scheme_name. Never touches Akahu Sharesies rows.
 */
router.post('/import-bank-csv', async (req, res) => {
  const db = await getDb();
  const { csvText, filename } = req.body ?? {};
  if (!csvText || typeof csvText !== 'string' || !csvText.trim()) {
    return res.status(400).json({
      ok: false,
      message:
        'Provide csvText for bank-held KiwiSaver. Columns: provider, scheme_name, balance_nzd (required); optional amount_invested_nzd, returns_nzd, observed_at, notes, fund_name, fund_allocation_pct, fund_balance_nzd. Never paste passwords.',
      rowsParsed: 0,
      upserted: 0,
      accountIds: [],
      errors: [],
    });
  }

  const parsed = parseBankKiwisaverCsv(csvText);
  if (!parsed.items.length) {
    return res.status(400).json({
      ok: false,
      message: parsed.errors[0]?.message ?? 'No valid bank KiwiSaver rows parsed.',
      rowsParsed: 0,
      upserted: 0,
      accountIds: [],
      errors: parsed.errors,
      headers: parsed.headers,
    });
  }

  const now = new Date().toISOString();
  const accountIds: string[] = [];
  let upserted = 0;

  for (const row of parsed.items) {
    const fundMix = row.holdings.map((h) => ({
      fundName: h.name,
      allocationPct: h.weightPct ?? null,
      balanceNzd: h.valueNzd ?? null,
      symbol: h.symbol,
      currency: h.currency,
    }));
    const { returnsNzd } = resolveReturnsAndInvested(
      row.balanceNzd,
      row.returnsNzd,
      row.amountInvestedNzd,
    );
    const observedAt = row.observedAt ? `${row.observedAt}T12:00:00.000Z` : now;
    const notes =
      row.notes ??
      `Manual bank-held CSV${filename ? `: ${filename}` : ''} (IRD/Akahu bank KS not available).`;

    const existing = findManualByProviderScheme(db, row.provider, row.schemeName, uid(req));
    if (existing) {
      run(
        db,
        `UPDATE kiwisaver_accounts SET
          name=?, scheme_name=?, balance_nzd=?, returns_nzd=?, fund_mix_json=?, observed_at=?,
          connection_status='csv_import', notes=?, updated_at=?
         WHERE id=?`,
        [
          row.name,
          row.schemeName,
          row.balanceNzd,
          returnsNzd,
          JSON.stringify(fundMix),
          observedAt,
          notes,
          now,
          existing.id,
        ],
      );
      upsertHistoryPoint(
        db,
        String(existing.id),
        observedAt.slice(0, 10),
        row.balanceNzd,
        returnsNzd,
        'csv',
      );
      accountIds.push(String(existing.id));
    } else {
      const id = newId('ks');
      run(
        db,
        `INSERT INTO kiwisaver_accounts
          (id, user_id, name, provider, scheme_name, balance_nzd, returns_nzd, fund_mix_json, observed_at,
           connection_status, notes, created_at, updated_at)
         VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)`,
        [
          id,
          uid(req),
          row.name,
          row.provider,
          row.schemeName,
          row.balanceNzd,
          returnsNzd,
          JSON.stringify(fundMix),
          observedAt,
          'csv_import',
          notes,
          now,
          now,
        ],
      );
      upsertHistoryPoint(db, id, observedAt.slice(0, 10), row.balanceNzd, returnsNzd, 'csv');
      accountIds.push(id);
    }
    upserted += 1;
  }

  res.json({
    ok: true,
    message: `Imported ${upserted} bank-held KiwiSaver scheme(s) from CSV (manual — not Akahu).`,
    rowsParsed: parsed.items.length,
    upserted,
    accountIds,
    errors: parsed.errors,
    filename: filename ?? null,
  });
});

/** Toggle / set observe connection stub (no credentials). Sharesies path only. */
router.post('/connection', async (req, res) => {
  const db = await getDb();
  const { enabled, accountId } = req.body ?? {};
  const now = new Date().toISOString();
  let account = accountId
    ? queryOne(db, 'SELECT * FROM kiwisaver_accounts WHERE id=? AND user_id=?', [accountId, uid(req)])
    : queryOne(db, `SELECT * FROM kiwisaver_accounts WHERE user_id = ? AND provider='sharesies' LIMIT 1`, [uid(req)]);

  if (!account) {
    const id = newId('ks');
    run(
      db,
      `INSERT INTO kiwisaver_accounts
        (id, user_id, name, provider, scheme_name, balance_nzd, fund_mix_json, observed_at, connection_status, notes, created_at, updated_at)
       VALUES (?,?,?,?,?,?,?,?,?,?,?,?)`,
      [
        id,
        uid(req),
        'Sharesies KiwiSaver',
        'sharesies',
        null,
        0,
        '[]',
        null,
        enabled ? 'official_pending' : 'off',
        enabled
          ? 'Observe enabled — awaiting official Sharesies path (export/API). Not scraping.'
          : null,
        now,
        now,
      ],
    );
    account = queryOne(db, 'SELECT * FROM kiwisaver_accounts WHERE id=? AND user_id=?', [id, uid(req)]);
  } else {
    const status = enabled ? 'official_pending' : 'off';
    run(
      db,
      `UPDATE kiwisaver_accounts SET connection_status=?, notes=?, updated_at=? WHERE id=?`,
      [
        status,
        enabled
          ? 'Observe enabled — awaiting official Sharesies path (export/API). Not scraping. Never store passwords.'
          : account.notes,
        now,
        account.id,
      ],
    );
    account = queryOne(db, 'SELECT * FROM kiwisaver_accounts WHERE id=? AND user_id=?', [account.id, uid(req)]);
  }

  res.json(mapKs(account!));
});

export default router;
