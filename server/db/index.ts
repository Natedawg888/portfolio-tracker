/**
 * Local SQLite via sql.js (WASM) — no native compile, data on disk under data/.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import initSqlJs, { type Database, type SqlJsStatic } from 'sql.js';
import { countFinanceRows, existingDataClaimAllowed, startupOwnerId } from '../lib/dataClaim.ts';
import { logger } from '../lib/logger.ts';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '../..');
/** Override with DATABASE_PATH (absolute or relative to cwd). Default ./data/portfolio.db */
const DB_PATH = process.env.DATABASE_PATH
  ? path.resolve(process.env.DATABASE_PATH)
  : path.join(ROOT, 'data', 'portfolio.db');
const DATA_DIR = path.dirname(DB_PATH);
const SCHEMA_PATH = path.join(__dirname, 'schema.sql');

let SQL: SqlJsStatic | null = null;
let db: Database | null = null;

function ensureDataDir() {
  if (!fs.existsSync(DATA_DIR)) {
    fs.mkdirSync(DATA_DIR, { recursive: true });
  }
}

/** A save slower than this logs slow_db_persist (every write rewrites the whole file). */
const SLOW_PERSIST_MS = 50;

export function persist() {
  if (!db) return;
  const started = performance.now();
  try {
    persistNow(db);
  } finally {
    const ms = Math.round(performance.now() - started);
    if (ms >= SLOW_PERSIST_MS) logger.warn('slow_db_persist', { ms });
  }
}

function persistNow(database: Database) {
  ensureDataDir();
  const data = database.export();
  const tmp = `${DB_PATH}.tmp`;
  fs.writeFileSync(tmp, Buffer.from(data));
  try {
    fs.renameSync(tmp, DB_PATH);
  } catch (err) {
    // OneDrive/Windows often EPERM on replace-via-rename; fall back to copy+unlink.
    const code = err && typeof err === 'object' && 'code' in err ? String((err as { code?: string }).code) : '';
    if (code === 'EPERM' || code === 'EEXIST' || code === 'EACCES') {
      fs.copyFileSync(tmp, DB_PATH);
      try {
        fs.unlinkSync(tmp);
      } catch {
        /* ignore leftover tmp */
      }
      return;
    }
    throw err;
  }
}


/**
 * Existing databases have transactions.account_id NOT NULL. Spend on a crypto Visa debit
 * card (Nexo, GoMining…) isn't charged to a bank account, so the column becomes nullable.
 * SQLite can't drop NOT NULL in place: rebuild from the live CREATE statement (keeps every
 * migrated column), copy rows, swap, and recreate the indexes.
 */
function migrateNullableTransactionAccount(database: Database) {
  const cols = database.exec('PRAGMA table_info(transactions)')[0];
  if (!cols) return;
  const nameIdx = cols.columns.indexOf('name');
  const notNullIdx = cols.columns.indexOf('notnull');
  const accountCol = cols.values.find((r) => r[nameIdx] === 'account_id');
  if (!accountCol || Number(accountCol[notNullIdx]) !== 1) return;

  const createSql = String(
    database.exec(`SELECT sql FROM sqlite_master WHERE type = 'table' AND name = 'transactions'`)[0].values[0][0],
  );
  const relaxed = createSql
    .replace(/CREATE TABLE\s+(IF NOT EXISTS\s+)?"?transactions"?/i, 'CREATE TABLE transactions_nullable_acct')
    .replace(/(account_id\s+TEXT)\s+NOT NULL/i, '$1');
  if (relaxed === createSql || /account_id\s+TEXT\s+NOT NULL/i.test(relaxed)) {
    throw new Error('transactions migration: could not relax account_id NOT NULL');
  }
  const indexSql = (database.exec(
    `SELECT sql FROM sqlite_master WHERE type = 'index' AND tbl_name = 'transactions' AND sql IS NOT NULL`,
  )[0]?.values ?? []).map((r) => String(r[0]));

  database.run('BEGIN');
  try {
    database.run(relaxed);
    database.run('INSERT INTO transactions_nullable_acct SELECT * FROM transactions');
    database.run('DROP TABLE transactions');
    database.run('ALTER TABLE transactions_nullable_acct RENAME TO transactions');
    for (const sql of indexSql) database.run(sql);
    database.run('COMMIT');
  } catch (err) {
    database.run('ROLLBACK');
    throw err;
  }
}

/**
 * Existing databases were created with cost_basis_nzd NOT NULL DEFAULT 0. Rebuild that table once
 * so a blank cost basis can be stored as SQL NULL. Same approach as the transactions rebuild above:
 * the live CREATE statement keeps every migrated column (user_id, card, art, mining…), every row is
 * copied, and the indexes are recreated. A fixed column list here used to drop later columns.
 */
function migrateNullableHoldingCost(database: Database) {
  const cols = database.exec('PRAGMA table_info(holdings)')[0];
  if (!cols) return;
  const nameIdx = cols.columns.indexOf('name');
  const notNullIdx = cols.columns.indexOf('notnull');
  const costCol = cols.values.find((r) => r[nameIdx] === 'cost_basis_nzd');
  if (!costCol || Number(costCol[notNullIdx]) !== 1) return;

  const createSql = String(
    database.exec(`SELECT sql FROM sqlite_master WHERE type = 'table' AND name = 'holdings'`)[0].values[0][0],
  );
  const relaxed = createSql
    .replace(/CREATE TABLE\s+(IF NOT EXISTS\s+)?"?holdings"?/i, 'CREATE TABLE holdings_nullable_cost')
    .replace(/(cost_basis_nzd\s+REAL)\s+NOT NULL(\s+DEFAULT\s+0)?/i, '$1');
  if (relaxed === createSql || /cost_basis_nzd\s+REAL\s+NOT NULL/i.test(relaxed)) {
    throw new Error('holdings migration: could not relax cost_basis_nzd NOT NULL');
  }
  const indexSql = (database.exec(
    `SELECT sql FROM sqlite_master WHERE type = 'index' AND tbl_name = 'holdings' AND sql IS NOT NULL`,
  )[0]?.values ?? []).map((r) => String(r[0]));

  database.run('BEGIN');
  try {
    database.run(relaxed);
    database.run('INSERT INTO holdings_nullable_cost SELECT * FROM holdings');
    database.run('DROP TABLE holdings');
    database.run('ALTER TABLE holdings_nullable_cost RENAME TO holdings');
    for (const sql of indexSql) database.run(sql);
    database.run('COMMIT');
  } catch (err) {
    database.run('ROLLBACK');
    throw err;
  }
}

function tableColumns(database: Database, table: string): Set<string> {
  const stmt = database.prepare(`PRAGMA table_info(${table})`);
  const cols = new Set<string>();
  while (stmt.step()) {
    const row = stmt.getAsObject() as { name?: string };
    if (row.name) cols.add(row.name);
  }
  stmt.free();
  return cols;
}

/**
 * Crypto mining type and provider (KAN-85). Runs after the table rebuilds above so the columns
 * can't be dropped by them. Every miner saved before this was a GoMining cloud miner; the backfill
 * only touches miners with no type, so it is safe on every boot.
 */
function migrateMiningTag(database: Database) {
  const cols = tableColumns(database, 'holdings');
  if (!cols.has('mining_type')) database.run('ALTER TABLE holdings ADD COLUMN mining_type TEXT');
  if (!cols.has('mining_provider')) database.run('ALTER TABLE holdings ADD COLUMN mining_provider TEXT');
  database.run(
    `UPDATE holdings SET mining_type = 'cloud', mining_provider = COALESCE(mining_provider, 'gomining')
     WHERE asset_class = 'gomining_miner' AND mining_type IS NULL`,
  );
}

/**
 * Business page (KAN-84). Adds business_id to invoices, clients, transactions and income, and the
 * client fields the Clients page uses. Anyone with invoice details, invoices or clients gets a
 * default business made from their invoice details (Settings → Business), and their existing
 * invoices and clients are attached to it, so nothing is lost or left without a business.
 */
export function migrateBusinesses(database: Database) {
  // Commodities (KAN-81) can be produce a business holds, like honey or wool.
  for (const table of ['invoices', 'invoice_clients', 'transactions', 'income_records', 'commodities']) {
    const cols = tableColumns(database, table);
    if (cols.size > 0 && !cols.has('business_id')) database.run(`ALTER TABLE ${table} ADD COLUMN business_id TEXT`);
  }
  const bizCols = tableColumns(database, 'businesses');
  if (bizCols.size > 0 && !bizCols.has('archived_at')) database.run('ALTER TABLE businesses ADD COLUMN archived_at TEXT');
  const clientCols = tableColumns(database, 'invoice_clients');
  for (const [col, type] of [
    ['contact_person', "TEXT NOT NULL DEFAULT ''"],
    ['phone', "TEXT NOT NULL DEFAULT ''"],
    ['notes', "TEXT NOT NULL DEFAULT ''"],
    ['status', "TEXT NOT NULL DEFAULT 'active'"],
  ] as const) {
    if (clientCols.size > 0 && !clientCols.has(col)) database.run(`ALTER TABLE invoice_clients ADD COLUMN ${col} ${type}`);
  }
  database.run(`CREATE INDEX IF NOT EXISTS idx_transactions_user_business ON transactions(user_id, business_id) WHERE business_id IS NOT NULL`);
  database.run(`CREATE INDEX IF NOT EXISTS idx_income_records_user_business ON income_records(user_id, business_id) WHERE business_id IS NOT NULL`);

  const read = (sql: string, params: unknown[] = []) => {
    const stmt = database.prepare(sql);
    stmt.bind(params as never[]);
    const rows: Record<string, unknown>[] = [];
    while (stmt.step()) rows.push(stmt.getAsObject());
    stmt.free();
    return rows;
  };
  const owners = read(
    `SELECT user_id FROM business_profiles WHERE user_id IS NOT NULL
     UNION SELECT user_id FROM invoices WHERE user_id IS NOT NULL
     UNION SELECT user_id FROM invoice_clients WHERE user_id IS NOT NULL`,
  ).map((r) => String(r.user_id)).filter(Boolean);
  for (const userId of owners) {
    let def = read(`SELECT id FROM businesses WHERE user_id = ? ORDER BY is_default DESC, created_at LIMIT 1`, [userId])[0]?.id as string | undefined;
    if (!def) {
      const p = read(`SELECT * FROM business_profiles WHERE user_id = ?`, [userId])[0];
      const u = read(`SELECT * FROM users WHERE id = ?`, [userId])[0];
      const accountName =
        String(u?.display_name ?? '').trim() || [u?.first_name, u?.last_name].filter((x) => x && String(x).trim()).join(' ');
      const now = new Date().toISOString();
      def = newId('biz');
      database.run(
        `INSERT INTO businesses (id, user_id, name, type, nzbn, gst_registered, gst_number, email, address, phone, bank_account,
           invoice_prefix, is_default, created_at, updated_at)
         VALUES (?,?,?, 'sole_trader', ?,?,?,?,?,?,?,?, 1, ?, ?)`,
        [
          def, userId, String(p?.business_name ?? '').trim() || accountName,
          String(p?.nzbn ?? ''), Number(p?.gst_registered ?? 0) === 1 ? 1 : 0, String(p?.gst_number ?? ''),
          String(p?.email ?? u?.email ?? ''), String(p?.address ?? ''), String(p?.phone ?? ''), String(p?.bank_account ?? ''),
          String(p?.invoice_prefix ?? '') || 'INV-', now, now,
        ],
      );
    }
    database.run(`UPDATE invoices SET business_id = ? WHERE user_id = ? AND business_id IS NULL`, [def, userId]);
    database.run(`UPDATE invoice_clients SET business_id = ? WHERE user_id = ? AND business_id IS NULL`, [def, userId]);
    // Invoice payments recorded in Income belong to the invoice's business.
    database.run(
      `UPDATE income_records SET business_id = (
         SELECT i.business_id FROM invoice_payments p JOIN invoices i ON i.id = p.invoice_id AND i.user_id = p.user_id
         WHERE p.id = income_records.invoice_payment_id)
       WHERE user_id = ? AND invoice_payment_id IS NOT NULL AND business_id IS NULL`,
      [userId],
    );
  }
}

/** Runtime migration for existing sql.js DBs (CREATE TABLE IF NOT EXISTS won't add columns). */
function migrateSchema(database: Database) {
  const cols = tableColumns(database, 'holdings');
  if (!cols.has('source')) {
    database.run('ALTER TABLE holdings ADD COLUMN source TEXT');
  }
  if (!cols.has('external_id')) {
    database.run('ALTER TABLE holdings ADD COLUMN external_id TEXT');
  }
  // idx_holdings_user_external created after user_id migration below


  const bankCols = tableColumns(database, 'bank_accounts');
  if (!bankCols.has('external_id')) {
    database.run('ALTER TABLE bank_accounts ADD COLUMN external_id TEXT');
  }
  // Backfill external_id from notes token "akahu:acc_…" before unique index
  const bankStmt = database.prepare(
    `SELECT id, notes, external_id FROM bank_accounts WHERE notes LIKE 'akahu:%'`,
  );
  const bankFixes: Array<{ id: string; ext: string }> = [];
  while (bankStmt.step()) {
    const row = bankStmt.getAsObject() as { id?: string; notes?: string; external_id?: string | null };
    if (!row.id) continue;
    if (row.external_id && /^akahu:acc_/i.test(row.external_id)) continue;
    const m = (row.notes ?? '').match(/akahu:acc_[a-z0-9]+/i);
    if (m) bankFixes.push({ id: row.id, ext: m[0] });
  }
  bankStmt.free();
  for (const f of bankFixes) {
    database.run(`UPDATE bank_accounts SET external_id = ? WHERE id = ?`, [f.ext, f.id]);
  }
  // idx_bank_accounts_user_external created after user_id migration below


  // Spending transactions: card_name / source / merchant (CREATE IF NOT EXISTS won't alter)
  const txnCols = tableColumns(database, 'transactions');
  if (!txnCols.has('card_name')) {
    database.run('ALTER TABLE transactions ADD COLUMN card_name TEXT');
  }
  if (!txnCols.has('merchant')) {
    database.run('ALTER TABLE transactions ADD COLUMN merchant TEXT');
  }
  if (!txnCols.has('source')) {
    database.run(`ALTER TABLE transactions ADD COLUMN source TEXT NOT NULL DEFAULT 'manual'`);
  }
  // idx_transactions_user_external created after user_id migration below

  database.run(
    `CREATE INDEX IF NOT EXISTS idx_transactions_source ON transactions(source)`,
  );

  // Per-txn BTC holding link (explicit toggle only — no category auto-link)
  const txnCols2 = tableColumns(database, 'transactions');
  if (!txnCols2.has('affects_btc')) {
    database.run(`ALTER TABLE transactions ADD COLUMN affects_btc INTEGER NOT NULL DEFAULT 0`);
  }
  if (!txnCols2.has('btc_holding_id')) {
    database.run('ALTER TABLE transactions ADD COLUMN btc_holding_id TEXT');
  }
  if (!txnCols2.has('btc_delta_applied')) {
    database.run('ALTER TABLE transactions ADD COLUMN btc_delta_applied REAL');
  }
  if (!txnCols2.has('btc_nzd_rate')) {
    database.run('ALTER TABLE transactions ADD COLUMN btc_nzd_rate REAL');
  }
  if (!txnCols2.has('btc_applied_at')) {
    database.run('ALTER TABLE transactions ADD COLUMN btc_applied_at TEXT');
  }
  if (!txnCols2.has('receipt_path')) {
    database.run('ALTER TABLE transactions ADD COLUMN receipt_path TEXT');
  }

  // Debt creditors: person | corporation (existing rows default to person)
  const debtCols = tableColumns(database, 'debt_people');
  if (debtCols.size > 0 && !debtCols.has('kind')) {
    database.run(`ALTER TABLE debt_people ADD COLUMN kind TEXT NOT NULL DEFAULT 'person'`);
  }
  const debtScheduleCols = tableColumns(database, 'debt_people');
  if (debtScheduleCols.size > 0) {
    const debtSchedule: Array<[string, string]> = [
      ['product_kind', 'TEXT'],
      ['is_loan', 'INTEGER NOT NULL DEFAULT 0'],
      ['interest_period', 'TEXT'],
      ['interest_rate_percent', 'REAL'],
      ['minimum_payment_nzd', 'REAL'],
      ['actual_payment_nzd', 'REAL'],
      ['remaining_term_months', 'INTEGER'],
      ['interest_paid_nzd', 'REAL'],
      ['interest_posted_through', 'TEXT'],
      ['interest_charged_nzd', 'REAL NOT NULL DEFAULT 0'],
    ];
    for (const [col, typ] of debtSchedule) {
      if (!debtScheduleCols.has(col)) {
        database.run(`ALTER TABLE debt_people ADD COLUMN ${col} ${typ}`);
      }
    }
  }

  // Monthly budget plans: unique per category + calendar-month period
  // idx_budgets_user_category_period created after user_id migration below


  // Income plans: migrate legacy one-lump-per-month → per income category
  const planCols = tableColumns(database, 'income_plans');
  if (planCols.size > 0 && !planCols.has('category_id')) {
    database.run(`
      CREATE TABLE income_plans_new (
        id TEXT PRIMARY KEY,
        year_month TEXT NOT NULL,
        category_id TEXT NOT NULL,
        amount_nzd REAL NOT NULL,
        notes TEXT,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      )`);
    database.run(`
      INSERT INTO income_plans_new (id, year_month, category_id, amount_nzd, notes, created_at, updated_at)
      SELECT id, year_month, 'cat-income', amount_nzd, notes, created_at, updated_at
      FROM income_plans`);
    database.run('DROP TABLE income_plans');
    database.run('ALTER TABLE income_plans_new RENAME TO income_plans');
  }
  // idx_income_plans_user_month_cat created after user_id migration below


  const incRecCols = tableColumns(database, 'income_records');
  if (incRecCols.size > 0 && !incRecCols.has('category_id')) {
    database.run('ALTER TABLE income_records ADD COLUMN category_id TEXT');
    database.run(
      `UPDATE income_records SET category_id = 'cat-income' WHERE category_id IS NULL`,
    );
  }
  // Crypto Add-income defaults to Mining when still on generic Income.
  database.run(
    `UPDATE income_records
     SET category_id = 'cat-income-mining'
     WHERE kind = 'crypto'
       AND (category_id IS NULL OR category_id = 'cat-income')`,
  );
  // Real estate + collectables (ALTER for existing sql.js DBs)
  const holdCols2 = tableColumns(database, 'holdings');
  const reCollectCols: Array<[string, string]> = [
    ['property_value_nzd', 'REAL'],
    ['mortgage_outstanding_nzd', 'REAL'],
    ['photo_path', 'TEXT'],
    ['card_game', 'TEXT'],
    ['card_set', 'TEXT'],
    ['card_number', 'TEXT'],
    ['card_finish', 'TEXT'],
    ['card_api_id', 'TEXT'],
    ['card_image_url', 'TEXT'],
    // MTG colour identity: "W,U" or "" (colourless). Null = unknown.
    ['card_colours', 'TEXT'],
    // Card rarity: common|uncommon|rare|mythic (plus special/bonus).
    ['card_rarity', 'TEXT'],
    // Art: fractional | physical (manual valuation only — no Masterworks API)
    ['art_kind', 'TEXT'],
    // Akahu / Sharesies instrument logo (icons only)
    ['logo_url', 'TEXT'],
  ];
  for (const [col, typ] of reCollectCols) {
    if (!holdCols2.has(col)) {
      database.run(`ALTER TABLE holdings ADD COLUMN ${col} ${typ}`);
    }
  }

  database.run(
    `CREATE INDEX IF NOT EXISTS idx_income_records_category ON income_records(category_id)`,
  );
  const incRecColsNow = tableColumns(database, 'income_records');
  if (incRecColsNow.size > 0 && !incRecColsNow.has('dividend_event_id')) {
    database.run('ALTER TABLE income_records ADD COLUMN dividend_event_id TEXT');
  }
  // SQLite treats NULL as distinct, so manual income rows (null dividend id) stay unlimited.
  database.run(
    `CREATE UNIQUE INDEX IF NOT EXISTS idx_income_records_user_dividend
     ON income_records(user_id, dividend_event_id)`,
  );

  // KiwiSaver: returns / external_id / pir / activity probe + history tables
  const ksCols = tableColumns(database, 'kiwisaver_accounts');
  if (ksCols.size > 0) {
    const ksAlters: Array<[string, string]> = [
      ['returns_nzd', 'REAL'],
      ['external_id', 'TEXT'],
      ['pir', 'REAL'],
      ['activity_status', 'TEXT'],
      ['activity_note', 'TEXT'],
    ];
    for (const [col, typ] of ksAlters) {
      if (!ksCols.has(col)) {
        database.run(`ALTER TABLE kiwisaver_accounts ADD COLUMN ${col} ${typ}`);
      }
    }
  }
  database.run(
    `CREATE TABLE IF NOT EXISTS kiwisaver_balance_history (
      id            TEXT PRIMARY KEY,
      account_id    TEXT NOT NULL REFERENCES kiwisaver_accounts(id) ON DELETE CASCADE,
      observed_at   TEXT NOT NULL,
      balance_nzd   REAL NOT NULL,
      returns_nzd   REAL,
      source        TEXT NOT NULL DEFAULT 'akahu',
      UNIQUE(account_id, observed_at)
    )`,
  );
  database.run(
    `CREATE INDEX IF NOT EXISTS idx_ks_balance_history_account
     ON kiwisaver_balance_history(account_id, observed_at)`,
  );
  database.run(
    `CREATE TABLE IF NOT EXISTS kiwisaver_activity (
      id            TEXT PRIMARY KEY,
      account_id    TEXT NOT NULL REFERENCES kiwisaver_accounts(id) ON DELETE CASCADE,
      external_id   TEXT,
      date          TEXT NOT NULL,
      description   TEXT NOT NULL DEFAULT '',
      amount_nzd    REAL NOT NULL,
      txn_type      TEXT,
      source        TEXT NOT NULL DEFAULT 'akahu',
      created_at    TEXT NOT NULL
    )`,
  );
  database.run(
    `CREATE UNIQUE INDEX IF NOT EXISTS idx_ks_activity_external
     ON kiwisaver_activity(external_id) WHERE external_id IS NOT NULL`,
  );
  database.run(
    `CREATE INDEX IF NOT EXISTS idx_ks_activity_account_date
     ON kiwisaver_activity(account_id, date DESC)`,
  );

  // Category type: spending | income | transfer_out | transfer_in
  // Only spending counts as Budget spend; only income counts as Income received.
  const catCols = tableColumns(database, 'budget_categories');
  if (catCols.size > 0 && !catCols.has('type')) {
    database.run(`ALTER TABLE budget_categories ADD COLUMN type TEXT NOT NULL DEFAULT 'spending'`);
    database.run(`UPDATE budget_categories SET type = 'income' WHERE is_income = 1`);
    // Investments move money to portfolio — not lifestyle spend
    database.run(`UPDATE budget_categories SET type = 'transfer_out' WHERE id = 'cat-investments'`);
  }
  // Keep is_income in sync with type (income APIs still filter is_income = 1)
  database.run(`UPDATE budget_categories SET is_income = CASE WHEN type = 'income' THEN 1 ELSE 0 END`);
  // Ensure transfer_in never counts as income even if mistagged
  database.run(
    `UPDATE budget_categories SET is_income = 0 WHERE type IN ('transfer_in', 'transfer_out', 'spending')`,
  );

  // Auth: users + sessions (CREATE IF NOT EXISTS for existing sql.js DBs)
  database.run(`
    CREATE TABLE IF NOT EXISTS users (
      id              TEXT PRIMARY KEY,
      email           TEXT NOT NULL UNIQUE,
      password_hash   TEXT NOT NULL,
      first_name      TEXT,
      last_name       TEXT,
      display_name    TEXT,
      avatar_url      TEXT,
      preferences_json TEXT,
      created_at      TEXT NOT NULL,
      updated_at      TEXT NOT NULL
    )
  `);
  database.run(`
    CREATE TABLE IF NOT EXISTS sessions (
      id          TEXT PRIMARY KEY,
      user_id     TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      token_hash  TEXT NOT NULL UNIQUE,
      expires_at  TEXT NOT NULL,
      created_at  TEXT NOT NULL
    )
  `);
  database.run(`CREATE INDEX IF NOT EXISTS idx_sessions_user ON sessions(user_id)`);
  database.run(`CREATE INDEX IF NOT EXISTS idx_sessions_expires ON sessions(expires_at)`);

  // Per-user UI preferences (asset-class toggles from signup / settings)
  const userCols = tableColumns(database, 'users');
  if (!userCols.has('preferences_json')) {
    database.run('ALTER TABLE users ADD COLUMN preferences_json TEXT');
  }
  if (!userCols.has('display_name')) {
    database.run('ALTER TABLE users ADD COLUMN display_name TEXT');
  }
  if (!userCols.has('avatar_url')) {
    database.run('ALTER TABLE users ADD COLUMN avatar_url TEXT');
  }
  if (!userCols.has('first_name')) {
    database.run('ALTER TABLE users ADD COLUMN first_name TEXT');
  }
  if (!userCols.has('last_name')) {
    database.run('ALTER TABLE users ADD COLUMN last_name TEXT');
  }

  // Per-user Akahu OAuth tokens (Full App Connect flow)
  database.run(`
    CREATE TABLE IF NOT EXISTS akahu_connections (
      id                 TEXT PRIMARY KEY,
      user_id            TEXT NOT NULL UNIQUE REFERENCES users(id) ON DELETE CASCADE,
      access_token       TEXT NOT NULL,
      scope              TEXT,
      institutions_json  TEXT,
      connected_at       TEXT NOT NULL,
      updated_at         TEXT NOT NULL,
      last_sync_at       TEXT
    )
  `);
  database.run(
    `CREATE INDEX IF NOT EXISTS idx_akahu_connections_user ON akahu_connections(user_id)`,
  );

  // Daily net-worth snapshots: 'auto' rows are written on dashboard load, one per Auckland day.
  const snapshotCols = tableColumns(database, 'valuation_snapshots');
  if (snapshotCols.size > 0 && !snapshotCols.has('kind')) {
    database.run(`ALTER TABLE valuation_snapshots ADD COLUMN kind TEXT NOT NULL DEFAULT 'manual'`);
  }

  // Wallet sync scheduling (KAN-41) — wallets table predates these columns.
  const walletCols = tableColumns(database, 'wallets');
  if (walletCols.size > 0 && !walletCols.has('next_sync_at')) {
    database.run('ALTER TABLE wallets ADD COLUMN next_sync_at TEXT');
  }
  if (walletCols.size > 0 && !walletCols.has('sync_failures')) {
    database.run('ALTER TABLE wallets ADD COLUMN sync_failures INTEGER NOT NULL DEFAULT 0');
  }

  // Invoice send channel (KAN-71): sends made outside the app are logged too.
  const sendCols = tableColumns(database, 'invoice_sends');
  if (sendCols.size > 0 && !sendCols.has('channel')) {
    database.run("ALTER TABLE invoice_sends ADD COLUMN channel TEXT NOT NULL DEFAULT 'resend'");
  }

  // Invoice payments mirrored into income (KAN-71).
  const incomeCols = tableColumns(database, 'income_records');
  if (incomeCols.size > 0 && !incomeCols.has('invoice_payment_id')) {
    database.run('ALTER TABLE income_records ADD COLUMN invoice_payment_id TEXT');
  }
  // Rental expenses linked to a bank debit instead of their own transaction (KAN-66).
  const rentalCols = tableColumns(database, 'rental_entries');
  if (rentalCols.size > 0 && !rentalCols.has('txn_owned')) {
    database.run('ALTER TABLE rental_entries ADD COLUMN txn_owned INTEGER NOT NULL DEFAULT 1');
  }
  // Rooms (KAN-83): rent per room and expenses shared across rooms.
  if (rentalCols.size > 0 && !rentalCols.has('room_id')) database.run('ALTER TABLE rental_entries ADD COLUMN room_id TEXT');
  if (rentalCols.size > 0 && !rentalCols.has('shared')) database.run('ALTER TABLE rental_entries ADD COLUMN shared INTEGER NOT NULL DEFAULT 0');
  const propertyCols = tableColumns(database, 'rental_properties');
  if (propertyCols.size > 0 && !propertyCols.has('let_type')) database.run("ALTER TABLE rental_properties ADD COLUMN let_type TEXT NOT NULL DEFAULT 'whole'");
  if (propertyCols.size > 0 && !propertyCols.has('own_home')) database.run('ALTER TABLE rental_properties ADD COLUMN own_home INTEGER NOT NULL DEFAULT 0');
  // Purchase and sale for the bright-line check (KAN-93).
  for (const [col, type] of [['purchase_date', 'TEXT'], ['purchase_price', 'REAL'], ['sale_agreement_date', 'TEXT'], ['sale_price', 'REAL'], ['sale_costs', 'REAL']]) {
    if (propertyCols.size > 0 && !propertyCols.has(col)) database.run(`ALTER TABLE rental_properties ADD COLUMN ${col} ${type}`);
  }
  // Rental income entries mirrored into income (KAN-66).
  if (incomeCols.size > 0 && !incomeCols.has('rental_entry_id')) {
    database.run('ALTER TABLE income_records ADD COLUMN rental_entry_id TEXT');
  }
  // Vehicle odometer and depreciation (KAN-65 follow-up).
  const vehicleCols = tableColumns(database, 'vehicles');
  if (vehicleCols.size > 0) {
    for (const [col, type] of [
      ['odometer', 'REAL'],
      ['odometer_unit', "TEXT NOT NULL DEFAULT 'km'"],
      ['odometer_on', 'TEXT'],
      ['odometer_at_purchase', 'REAL'],
      ['depreciation_pct', 'REAL'],
    ] as const) {
      if (!vehicleCols.has(col)) database.run(`ALTER TABLE vehicles ADD COLUMN ${col} ${type}`);
    }
  }
  // Employee contracts (business employees predate these columns).
  const employeeCols = tableColumns(database, 'business_employees');
  if (employeeCols.size > 0) {
    for (const [col, type] of [['contract_path', 'TEXT'], ['contract_name', "TEXT NOT NULL DEFAULT ''"], ['contract_at', 'TEXT']] as const) {
      if (!employeeCols.has(col)) database.run(`ALTER TABLE business_employees ADD COLUMN ${col} ${type}`);
    }
  }
  // Payslip net pay mirrored into income (KAN-78).
  if (incomeCols.size > 0 && !incomeCols.has('payslip_id')) {
    database.run('ALTER TABLE income_records ADD COLUMN payslip_id TEXT');
  }
  // Bond coupons mirrored into income (KAN-80).
  if (incomeCols.size > 0 && !incomeCols.has('bond_coupon_ref')) {
    database.run('ALTER TABLE income_records ADD COLUMN bond_coupon_ref TEXT');
  }

  // Business page (KAN-84): invoices, clients, transactions and income belong to a business.
  migrateBusinesses(database);

  // Savings goal → savings account link (KAN-20).
  const goalCols = tableColumns(database, 'savings_goals');
  if (goalCols.size > 0 && !goalCols.has('account_id')) {
    database.run('ALTER TABLE savings_goals ADD COLUMN account_id TEXT');
  }

  // 2FA + session devices (KAN-16) — users / sessions predate these columns.
  const totpUserCols = tableColumns(database, 'users');
  for (const [col, type] of [
    ['totp_secret_enc', 'TEXT'],
    ['totp_pending_enc', 'TEXT'],
    ['totp_pending_at', 'TEXT'],
    ['totp_enabled_at', 'TEXT'],
    ['totp_last_step', 'INTEGER'],
  ] as const) {
    if (totpUserCols.size > 0 && !totpUserCols.has(col)) database.run(`ALTER TABLE users ADD COLUMN ${col} ${type}`);
  }
  const sessionCols = tableColumns(database, 'sessions');
  for (const [col, type] of [
    ['device_label', 'TEXT'],
    ['last_seen_at', 'TEXT'],
    ['persistent', 'INTEGER NOT NULL DEFAULT 1'],
    ['passkey_id', 'TEXT'],
    // The trusted device this browser holds, so Settings → Security shows them as one device.
    ['trusted_device_id', 'TEXT'],
  ] as const) {
    if (sessionCols.size > 0 && !sessionCols.has(col)) database.run(`ALTER TABLE sessions ADD COLUMN ${col} ${type}`);
  }
  // Sign-in log detail (security page redesign): provider, passkey, session, "it was me".
  const authEventCols = tableColumns(database, 'auth_events');
  for (const col of ['provider', 'passkey_id', 'session_id', 'acknowledged_at'] as const) {
    if (authEventCols.size > 0 && !authEventCols.has(col)) database.run(`ALTER TABLE auth_events ADD COLUMN ${col} TEXT`);
  }
  const challengeCols = tableColumns(database, 'login_challenges');
  if (challengeCols.size > 0 && !challengeCols.has('provider')) database.run('ALTER TABLE login_challenges ADD COLUMN provider TEXT');

  // Per-user finance isolation: user_id on scoped tables.
  // First user (data_owner_user_id) keeps existing rows; later users start empty.
  const scopedTables: Array<{ table: string; index?: string }> = [
    { table: 'holdings', index: 'idx_holdings_user' },
    { table: 'bank_accounts', index: 'idx_bank_accounts_user' },
    { table: 'transactions', index: 'idx_transactions_user' },
    { table: 'kiwisaver_accounts', index: 'idx_ks_accounts_user' },
    { table: 'debt_people', index: 'idx_debt_people_user' },
    { table: 'income_records', index: 'idx_income_records_user' },
    { table: 'income_plans', index: 'idx_income_plans_user' },
    { table: 'dividend_events', index: 'idx_dividend_events_user' },
    { table: 'dividend_forecast_reinvest', index: 'idx_dividend_forecast_reinvest_user' },
    { table: 'budgets', index: 'idx_budgets_user' },
    { table: 'valuation_snapshots', index: 'idx_valuation_snapshots_user' },
    { table: 'budget_categories', index: 'idx_budget_categories_user' },
    { table: 'payee_settings', index: 'idx_payee_settings_user' },
    { table: 'savings_goals', index: 'idx_savings_goals_user' },
    { table: 'donations', index: 'idx_donations_user' },
    { table: 'pay_sources', index: 'idx_pay_sources_user' },
  ];
  for (const { table, index } of scopedTables) {
    const cols = tableColumns(database, table);
    if (cols.size === 0) continue;
    if (!cols.has('user_id')) {
      database.run(`ALTER TABLE ${table} ADD COLUMN user_id TEXT`);
    }
    if (index) {
      database.run(`CREATE INDEX IF NOT EXISTS ${index} ON ${table}(user_id)`);
    }
  }

  // Backfill unscoped rows only to an already recorded data owner, or to the
  // earliest user when the database has no finance rows (or the bootstrap flag).
  const ownerRow = database.prepare(
    `SELECT value FROM meta WHERE key = 'data_owner_user_id'`,
  );
  let ownerId: string | null = null;
  if (ownerRow.step()) {
    const o = ownerRow.getAsObject() as { value?: string };
    ownerId = o.value?.trim() || null;
  }
  ownerRow.free();
  if (!ownerId) {
    const u = database.prepare(`SELECT id FROM users ORDER BY created_at ASC LIMIT 1`);
    let earliest: string | null = null;
    if (u.step()) {
      const row = u.getAsObject() as { id?: string };
      earliest = row.id ?? null;
    }
    u.free();
    const next = startupOwnerId({
      earliestUserId: earliest,
      financeRowCount: countFinanceRows(database),
      claimAllowed: existingDataClaimAllowed(),
    });
    if (next) {
      ownerId = next;
      database.run(
        `INSERT OR REPLACE INTO meta (key, value) VALUES ('data_owner_user_id', ?)`,
        [ownerId],
      );
    }
  }
  if (ownerId) {
    for (const { table } of scopedTables) {
      const cols = tableColumns(database, table);
      if (!cols.has('user_id')) continue;
      database.run(
        `UPDATE ${table} SET user_id = ? WHERE user_id IS NULL OR user_id = ''`,
        [ownerId],
      );
    }
  }

  // budget_categories.slug for well-known seeds (cat-debt, cat-income, …)
  {
    const catCols = tableColumns(database, 'budget_categories');
    if (catCols.size > 0 && !catCols.has('slug')) {
      database.run(`ALTER TABLE budget_categories ADD COLUMN slug TEXT`);
    }
    database.run(
      `UPDATE budget_categories SET slug = id WHERE slug IS NULL OR slug = ''`,
    );
    database.run(
      `CREATE UNIQUE INDEX IF NOT EXISTS idx_budget_categories_user_slug
       ON budget_categories(user_id, slug) WHERE slug IS NOT NULL AND user_id IS NOT NULL`,
    );
  }

  // Rebuild external_id uniqueness to be per-user (drop global unique indexes)
  database.run(`DROP INDEX IF EXISTS idx_holdings_external_id`);
  database.run(`DROP INDEX IF EXISTS idx_bank_accounts_external_id`);
  database.run(`DROP INDEX IF EXISTS idx_transactions_external_id`);
  database.run(
    `CREATE UNIQUE INDEX IF NOT EXISTS idx_holdings_user_external
     ON holdings(user_id, external_id) WHERE external_id IS NOT NULL`,
  );
  database.run(
    `CREATE UNIQUE INDEX IF NOT EXISTS idx_bank_accounts_user_external
     ON bank_accounts(user_id, external_id) WHERE external_id IS NOT NULL`,
  );
  database.run(
    `CREATE UNIQUE INDEX IF NOT EXISTS idx_transactions_user_external
     ON transactions(user_id, external_id) WHERE external_id IS NOT NULL`,
  );
  database.run(`DROP INDEX IF EXISTS idx_budgets_category_period`);
  database.run(
    `CREATE UNIQUE INDEX IF NOT EXISTS idx_budgets_user_category_period
     ON budgets(user_id, category_id, period_start, period_end)`,
  );
  database.run(`DROP INDEX IF EXISTS idx_income_plans_month_cat`);
  database.run(
    `CREATE UNIQUE INDEX IF NOT EXISTS idx_income_plans_user_month_cat
     ON income_plans(user_id, year_month, category_id)`,
  );
  // KiwiSaver activity external ids are account-scoped; keep global unique on activity
  // but KS accounts themselves are user-scoped via user_id column.

}

function seedDefaults(database: Database) {
  const now = new Date().toISOString();
  database.run(
    `INSERT OR IGNORE INTO meta (key, value) VALUES ('schema_version', '1'), ('created_at', ?)`,
    [now],
  );
  database.run(
    `INSERT OR IGNORE INTO app_settings (key, value) VALUES
      ('defaultCurrency', 'NZD'),
      ('timezone', 'Pacific/Auckland'),
      ('locale', 'en-NZ'),
      ('gominingDiscountPct', '0'),
      ('gominingBtcUsd', ''),
      ('gominingNetworkHashrateEhs', ''),
      ('gominingDailyBtcIssuance', ''),
      ('gominingKwhCostUsd', '')`,
  );

  // [id, name, type, sort] — type: spending | income | transfer_out | transfer_in
  const categories: Array<[string, string, string, number]> = [
    ['cat-income', 'Income', 'income', 0],
    ['cat-income-salary', 'Salary', 'income', 1],
    ['cat-income-mining', 'Mining', 'income', 2],
    ['cat-income-dividends', 'Dividends & interest', 'income', 3],
    ['cat-income-other', 'Other income', 'income', 4],
    ['cat-housing', 'Housing', 'spending', 10],
    ['cat-food', 'Food & groceries', 'spending', 20],
    ['cat-eating-out', 'Eating out', 'spending', 25],
    ['cat-transport', 'Transport', 'spending', 30],
    ['cat-utilities', 'Utilities', 'spending', 40],
    ['cat-health', 'Health', 'spending', 50],
    ['cat-entertainment', 'Entertainment', 'spending', 60],
    ['cat-subscriptions', 'Subscriptions', 'spending', 70],
    ['cat-investments', 'Investments', 'transfer_out', 80],
    ['cat-debt', 'Debt', 'spending', 85],
    ['cat-charity', 'Charity', 'spending', 87],
    ['cat-other', 'Other', 'spending', 90],
    ['cat-transfer-out', 'Transfer out', 'transfer_out', 95],
    ['cat-transfer-in', 'Transfer in', 'transfer_in', 96],
  ];
  // Global seed rows (user_id NULL) only when the table has no categories yet.
  // First signup claims them; later users get per-user copies via seedCategoriesForUser.
  const countStmt = database.prepare(`SELECT COUNT(*) AS c FROM budget_categories`);
  let catCount = 0;
  if (countStmt.step()) {
    catCount = Number((countStmt.getAsObject() as { c?: number }).c ?? 0);
  }
  countStmt.free();
  if (catCount === 0) {
    for (const [id, name, type, sort] of categories) {
      const isIncome = type === 'income' ? 1 : 0;
      database.run(
        `INSERT OR IGNORE INTO budget_categories (id, user_id, slug, name, parent_id, colour, type, is_income, sort_order)
         VALUES (?, NULL, ?, ?, NULL, NULL, ?, ?, ?)`,
        [id, id, name, type, isIncome, sort],
      );
    }
  }
  // Existing DBs: ensure Investments / transfer seeds have correct type (any matching slug/id)
  database.run(
    `UPDATE budget_categories SET type = 'transfer_out', is_income = 0
     WHERE id = 'cat-investments' OR slug = 'cat-investments'`,
  );
  database.run(
    `UPDATE budget_categories SET type = 'transfer_out', is_income = 0
     WHERE id = 'cat-transfer-out' OR slug = 'cat-transfer-out'`,
  );
  database.run(
    `UPDATE budget_categories SET type = 'transfer_in', is_income = 0
     WHERE id = 'cat-transfer-in' OR slug = 'cat-transfer-in'`,
  );
  database.run(
    `UPDATE budget_categories SET slug = id WHERE slug IS NULL OR slug = ''`,
  );
}

export async function getDb(): Promise<Database> {
  if (db) return db;
  ensureDataDir();
  SQL = await initSqlJs({
    locateFile: (file) =>
      path.join(ROOT, 'node_modules/sql.js/dist', file),
  });
  if (fs.existsSync(DB_PATH)) {
    const buf = fs.readFileSync(DB_PATH);
    db = new SQL.Database(buf);
  } else {
    db = new SQL.Database();
  }
  const schema = fs.readFileSync(SCHEMA_PATH, 'utf8');
  db.exec(schema);
  migrateSchema(db);
  migrateNullableHoldingCost(db);
  migrateNullableTransactionAccount(db);
  migrateMiningTag(db);
  seedDefaults(db);
  persist();
  return db;
}

export function queryAll<T extends Record<string, unknown>>(
  database: Database,
  sql: string,
  params: unknown[] = [],
): T[] {
  const stmt = database.prepare(sql);
  stmt.bind(params as never[]);
  const rows: T[] = [];
  while (stmt.step()) {
    rows.push(stmt.getAsObject() as T);
  }
  stmt.free();
  return rows;
}

export function queryOne<T extends Record<string, unknown>>(
  database: Database,
  sql: string,
  params: unknown[] = [],
): T | null {
  const rows = queryAll<T>(database, sql, params);
  return rows[0] ?? null;
}

export function run(
  database: Database,
  sql: string,
  params: unknown[] = [],
): void {
  database.run(sql, params as never[]);
  persist();
}

export function newId(prefix: string): string {
  return `${prefix}_${crypto.randomUUID().replace(/-/g, '').slice(0, 12)}`;
}

export { DB_PATH, DATA_DIR };
