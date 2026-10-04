-- NZD Portfolio Tracker — SQLite schema (sql.js)
-- Default currency: NZD. No bank passwords. Never invent valuations.

PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS meta (
  key   TEXT PRIMARY KEY,
  value TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS bank_accounts (
  id            TEXT PRIMARY KEY,
  user_id       TEXT,
  name          TEXT NOT NULL,
  institution   TEXT NOT NULL DEFAULT '',
  account_type  TEXT NOT NULL DEFAULT 'other',
  currency      TEXT NOT NULL DEFAULT 'NZD',
  balance       REAL NOT NULL DEFAULT 0,
  notes         TEXT,
  external_id   TEXT,
  created_at    TEXT NOT NULL,
  updated_at    TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS budget_categories (
  id          TEXT PRIMARY KEY,
  user_id     TEXT,
  -- Well-known key (cat-income, cat-debt, …); unique per user via migrateSchema index
  slug        TEXT,
  name        TEXT NOT NULL,
  parent_id   TEXT REFERENCES budget_categories(id),
  colour      TEXT,
  -- spending | income | transfer_out | transfer_in (only spending counts as Budget spend)
  type        TEXT NOT NULL DEFAULT 'spending',
  is_income   INTEGER NOT NULL DEFAULT 0,  -- 1 iff type = income (legacy / income APIs)
  sort_order  INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS transactions (
  id            TEXT PRIMARY KEY,
  user_id       TEXT,
  account_id    TEXT NOT NULL REFERENCES bank_accounts(id) ON DELETE CASCADE,
  date          TEXT NOT NULL,
  description   TEXT NOT NULL DEFAULT '',
  amount        REAL NOT NULL,
  kind          TEXT NOT NULL DEFAULT 'debit',
  category_id   TEXT REFERENCES budget_categories(id),
  currency      TEXT NOT NULL DEFAULT 'NZD',
  external_id   TEXT,
  created_at    TEXT NOT NULL,
  -- Spending / budgeting provenance
  card_name     TEXT,
  merchant      TEXT,
  source        TEXT NOT NULL DEFAULT 'manual',  -- akahu | bank | google_wallet | manual | csv
  -- Optional explicit BTC holding link (per-txn toggle; never auto from category)
  affects_btc         INTEGER NOT NULL DEFAULT 0,  -- 1 = Use BTC / Pays with BTC
  btc_holding_id      TEXT,   -- holdings.id (crypto BTC)
  btc_delta_applied   REAL,   -- signed BTC already applied (for idempotent reverse)
  btc_nzd_rate        REAL,   -- BTC/NZD rate used when applied
  btc_applied_at      TEXT,
  -- Charity / IR526 donation receipt (data/uploads/receipts/)
  receipt_path        TEXT
);

CREATE INDEX IF NOT EXISTS idx_transactions_account ON transactions(account_id);
CREATE INDEX IF NOT EXISTS idx_transactions_date ON transactions(date);
CREATE INDEX IF NOT EXISTS idx_transactions_category ON transactions(category_id);
-- idx_transactions_user_external / idx_transactions_user created in migrateSchema after user_id exists
-- idx_transactions_source created in migrateSchema after ALTER adds source on existing DBs

CREATE TABLE IF NOT EXISTS budgets (
  id            TEXT PRIMARY KEY,
  user_id       TEXT,
  category_id   TEXT NOT NULL REFERENCES budget_categories(id),
  period_start  TEXT NOT NULL,
  period_end    TEXT NOT NULL,
  amount_nzd    REAL NOT NULL,
  notes         TEXT
);

-- Monthly budget plans: one planned amount per category per calendar month
-- (period_start/end = first/last day of that month). Upserted via PUT /api/budgets/plan.
-- idx_budgets_user_category_period created in migrateSchema after user_id exists

-- Polymorphic holdings: asset_class discriminates subtype columns.
-- Classes: stock | crypto | gomining_miner | art | metal | stone | forex | real_estate | collectable
CREATE TABLE IF NOT EXISTS holdings (
  id              TEXT PRIMARY KEY,
  user_id         TEXT,
  asset_class     TEXT NOT NULL,
  name            TEXT NOT NULL,
  notes           TEXT,
  cost_basis_nzd  REAL,
  acquired_at     TEXT,
  created_at      TEXT NOT NULL,
  updated_at      TEXT NOT NULL,

  -- stock
  symbol          TEXT,
  shares          REAL,
  exchange        TEXT,
  -- provider logo (Akahu/Sharesies); icons only, never prices
  logo_url        TEXT,

  -- crypto (incl. optional GMT token balance)
  -- forex: asset = ISO currency (USD/EUR/GBP), amount = foreign units; source e.g. Revolut
  asset           TEXT,
  amount          REAL,

  -- gomining_miner (first-class digital miners — multiple rows OK)
  miner_name          TEXT,
  miner_external_id   TEXT,
  hashrate_ths        REAL,
  energy_efficiency_wth REAL,
  rarity              TEXT,
  level               INTEGER,
  estimated_value_nzd REAL,          -- NULL until manual or provider
  estimated_value_at  TEXT,
  estimated_value_source TEXT,

  -- art (fractional Masterworks-style or physical; manual valuation only)
  art_kind            TEXT,              -- fractional | physical
  ownership_pct       REAL,
  purchase_price_nzd  REAL,
  purchase_date       TEXT,
  last_valuation_nzd  REAL,
  last_valuation_at   TEXT,
  artwork_title       TEXT,
  artist              TEXT,

  -- metal
  metal           TEXT,
  metal_amount    REAL,
  metal_unit      TEXT,              -- g | oz_t

  -- stone (NEVER invent valuation_nzd)
  stone_type      TEXT,
  carat           REAL,
  clarity         TEXT,
  cut             TEXT,
  colour          TEXT,
  length_mm       REAL,
  width_mm        REAL,
  depth_mm        REAL,
  valuation_nzd   REAL,
  valuation_source TEXT,
  valuation_notes TEXT,

  -- real_estate (manual market value NZD; mortgage outstanding; optional local photo)
  property_value_nzd       REAL,   -- owned/market value NZD (manual)
  mortgage_outstanding_nzd REAL,   -- liability NZD (manual)
  photo_path               TEXT,   -- relative under data/uploads/

  -- collectable cards (MTG / Pokémon) — valuation from public APIs only
  card_game       TEXT,            -- mtg | pokemon
  card_set        TEXT,
  card_number     TEXT,
  card_finish     TEXT,            -- nonfoil | foil | holofoil | …
  card_api_id     TEXT,            -- Scryfall id or pokemontcg.io id
  card_image_url  TEXT,            -- remote image from API (not invented)

  -- Akahu / external sync provenance
  source          TEXT,
  external_id     TEXT
);

CREATE INDEX IF NOT EXISTS idx_holdings_class ON holdings(asset_class);

CREATE TABLE IF NOT EXISTS price_quotes (
  id          TEXT PRIMARY KEY,
  asset_key   TEXT NOT NULL UNIQUE,
  currency    TEXT NOT NULL DEFAULT 'NZD',
  price       REAL,
  status      TEXT NOT NULL DEFAULT 'unavailable',
  source      TEXT NOT NULL DEFAULT 'stub',
  as_of       TEXT NOT NULL,
  notes       TEXT
);

CREATE TABLE IF NOT EXISTS valuation_snapshots (
  id              TEXT PRIMARY KEY,
  user_id         TEXT,
  taken_at        TEXT NOT NULL,
  total_nzd       REAL NOT NULL,
  breakdown_json  TEXT NOT NULL DEFAULT '{}',
  notes           TEXT
);

CREATE TABLE IF NOT EXISTS app_settings (
  key   TEXT PRIMARY KEY,
  value TEXT NOT NULL
);


-- KiwiSaver (NZ) — read-only net-worth observe.
-- Sharesies via Akahu; bank-held via manual/CSV (IRD/Akahu bank KS not available).
-- Never store passwords. provider=sharesies for Akahu; otherwise bank label.
CREATE TABLE IF NOT EXISTS kiwisaver_accounts (
  id                  TEXT PRIMARY KEY,
  user_id             TEXT,
  name                TEXT NOT NULL,
  provider            TEXT NOT NULL DEFAULT 'sharesies',
  scheme_name         TEXT,
  balance_nzd         REAL NOT NULL DEFAULT 0,
  -- Akahu meta.breakdown.returns (NZD) when provider exposes it; NULL = unknown
  returns_nzd         REAL,
  -- Akahu account _id (e.g. akahu:acc_…)
  external_id         TEXT,
  -- Akahu meta.profile.pir when present
  pir                 REAL,
  fund_mix_json       TEXT NOT NULL DEFAULT '[]',
  observed_at         TEXT,
  connection_status   TEXT NOT NULL DEFAULT 'off',
  notes               TEXT,
  -- Activity probe: unavailable | empty | ok
  activity_status     TEXT,
  activity_note       TEXT,
  created_at          TEXT NOT NULL,
  updated_at          TEXT NOT NULL
);

-- Balance / returns points on Akahu sync or manual/CSV save (real values only; source=akahu|manual|csv).
-- One row per Auckland calendar day per account (upserted on sync).
CREATE TABLE IF NOT EXISTS kiwisaver_balance_history (
  id            TEXT PRIMARY KEY,
  account_id    TEXT NOT NULL REFERENCES kiwisaver_accounts(id) ON DELETE CASCADE,
  observed_at   TEXT NOT NULL,
  balance_nzd   REAL NOT NULL,
  returns_nzd   REAL,
  source        TEXT NOT NULL DEFAULT 'akahu',
  UNIQUE(account_id, observed_at)
);

CREATE INDEX IF NOT EXISTS idx_ks_balance_history_account
  ON kiwisaver_balance_history(account_id, observed_at);

-- Recent activity from Akahu account transactions when TRANSACTIONS attribute exists.
-- Sharesies KiwiSaver currently returns attributes=[] and 0 txns — table stays empty.
CREATE TABLE IF NOT EXISTS kiwisaver_activity (
  id            TEXT PRIMARY KEY,
  account_id    TEXT NOT NULL REFERENCES kiwisaver_accounts(id) ON DELETE CASCADE,
  external_id   TEXT,
  date          TEXT NOT NULL,
  description   TEXT NOT NULL DEFAULT '',
  amount_nzd    REAL NOT NULL,
  txn_type      TEXT,
  source        TEXT NOT NULL DEFAULT 'akahu',
  created_at    TEXT NOT NULL
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_ks_activity_external
  ON kiwisaver_activity(external_id) WHERE external_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_ks_activity_account_date
  ON kiwisaver_activity(account_id, date DESC);

-- Personal debts / creditors Nathan owes (Spending → I owe)
-- kind: person | corporation (company). Same outstanding + repayments for both.
CREATE TABLE IF NOT EXISTS debt_people (
  id               TEXT PRIMARY KEY,
  user_id          TEXT,
  name             TEXT NOT NULL,
  kind             TEXT NOT NULL DEFAULT 'person',  -- person | corporation
  notes            TEXT,
  outstanding_nzd  REAL NOT NULL DEFAULT 0,
  created_at       TEXT NOT NULL,
  updated_at       TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS debt_repayments (
  id               TEXT PRIMARY KEY,
  person_id        TEXT NOT NULL REFERENCES debt_people(id) ON DELETE CASCADE,
  amount_nzd       REAL NOT NULL,
  date             TEXT NOT NULL,
  notes            TEXT,
  transaction_id   TEXT REFERENCES transactions(id) ON DELETE SET NULL,
  created_at       TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_debt_repayments_person ON debt_repayments(person_id);
CREATE INDEX IF NOT EXISTS idx_debt_repayments_date ON debt_repayments(date);

-- Income records (Spending → Income): cash deposits or crypto inflows (NZD).
-- Crypto rows may also merge/increase a holdings row by ticker.
-- Optional transaction_id links an Add-income cash credit (cat-income) for dedupe vs bank sync.
CREATE TABLE IF NOT EXISTS income_records (
  id               TEXT PRIMARY KEY,
  user_id          TEXT,
  date             TEXT NOT NULL,
  amount_nzd       REAL NOT NULL,
  kind             TEXT NOT NULL DEFAULT 'cash',  -- cash | crypto
  description      TEXT NOT NULL DEFAULT '',
  account_id       TEXT REFERENCES bank_accounts(id) ON DELETE SET NULL,
  category_id      TEXT REFERENCES budget_categories(id),  -- income cat (salary/mining/…)
  crypto_asset     TEXT,
  crypto_amount    REAL,
  holding_id       TEXT,
  transaction_id   TEXT REFERENCES transactions(id) ON DELETE SET NULL,
  notes            TEXT,
  created_at       TEXT NOT NULL,
  -- Set when this row mirrors one paid dividend. One income row per dividend per user.
  dividend_event_id TEXT
);

CREATE INDEX IF NOT EXISTS idx_income_records_date ON income_records(date);
CREATE INDEX IF NOT EXISTS idx_income_records_kind ON income_records(kind);
-- idx_income_records_category created in migrateSchema after category_id exists on older DBs

-- Planned income: one line per income category per calendar month (YYYY-MM).
-- Received = income_records ∪ unlinked is_income transaction inflows, matched by category_id
-- (linked Add-income txns deduped via income_records.transaction_id — see routes/income.ts).
-- Older DBs may still have year_month UNIQUE without category_id — migrateSchema rebuilds.
CREATE TABLE IF NOT EXISTS income_plans (
  id           TEXT PRIMARY KEY,
  user_id      TEXT,
  year_month   TEXT NOT NULL,
  category_id  TEXT NOT NULL REFERENCES budget_categories(id),
  amount_nzd   REAL NOT NULL,
  notes        TEXT,
  created_at   TEXT NOT NULL,
  updated_at   TEXT NOT NULL
);
-- idx_income_plans_month_cat created in migrateSchema after category_id exists

-- Local email/password accounts (per-user finance rows via user_id; first user owns legacy data)
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
);

CREATE TABLE IF NOT EXISTS sessions (
  id          TEXT PRIMARY KEY,
  user_id     TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  token_hash  TEXT NOT NULL UNIQUE,
  expires_at  TEXT NOT NULL,
  created_at  TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_sessions_user ON sessions(user_id);
CREATE INDEX IF NOT EXISTS idx_sessions_expires ON sessions(expires_at);

-- Per-user Akahu OAuth access tokens (Full App). Never expose to the browser.
CREATE TABLE IF NOT EXISTS akahu_connections (
  id                 TEXT PRIMARY KEY,
  user_id            TEXT NOT NULL UNIQUE REFERENCES users(id) ON DELETE CASCADE,
  access_token       TEXT NOT NULL,
  scope              TEXT,
  institutions_json  TEXT,
  connected_at       TEXT NOT NULL,
  updated_at         TEXT NOT NULL,
  last_sync_at       TEXT
);
CREATE INDEX IF NOT EXISTS idx_akahu_connections_user ON akahu_connections(user_id);

-- Economic cycle (country macro data, not per-user). Phase is calculated, never assigned by hand.
-- published_at_precision: release | period_end. provider_kind: live | sample.
CREATE TABLE IF NOT EXISTS economic_indicators (
  id                      TEXT PRIMARY KEY,
  country                 TEXT NOT NULL,
  indicator_type          TEXT NOT NULL,
  value                   REAL NOT NULL,
  unit                    TEXT NOT NULL,
  period                  TEXT NOT NULL,
  period_start            TEXT,
  period_end              TEXT,
  previous_value          REAL,
  previous_period         TEXT,
  source                  TEXT NOT NULL,
  source_url              TEXT,
  published_at            TEXT NOT NULL,
  published_at_precision  TEXT NOT NULL DEFAULT 'period_end',
  retrieved_at            TEXT NOT NULL,
  provider_id             TEXT NOT NULL,
  provider_kind           TEXT NOT NULL,
  frequency               TEXT NOT NULL,
  series_id               TEXT,
  notes                   TEXT,
  UNIQUE (country, indicator_type, period, provider_id)
);

CREATE INDEX IF NOT EXISTS idx_econ_ind_country
  ON economic_indicators(country, provider_id, indicator_type, period_end);

CREATE TABLE IF NOT EXISTS economic_cycle_assessments (
  id              TEXT PRIMARY KEY,
  country         TEXT NOT NULL,
  phase           TEXT NOT NULL,
  score           REAL NOT NULL,
  confidence      REAL NOT NULL,
  calculated_at   TEXT NOT NULL,
  as_of_period    TEXT,
  previous_phase  TEXT,
  momentum        TEXT NOT NULL,
  provider_id     TEXT NOT NULL,
  provider_kind   TEXT NOT NULL,
  is_current      INTEGER NOT NULL DEFAULT 0,
  coverage_note   TEXT
);

CREATE INDEX IF NOT EXISTS idx_econ_assess_country
  ON economic_cycle_assessments(country, provider_id, is_current);

CREATE TABLE IF NOT EXISTS economic_indicator_scores (
  id              TEXT PRIMARY KEY,
  assessment_id   TEXT NOT NULL REFERENCES economic_cycle_assessments(id) ON DELETE CASCADE,
  indicator_type  TEXT NOT NULL,
  score           REAL NOT NULL,
  direction       TEXT NOT NULL,
  contribution    REAL NOT NULL,
  UNIQUE (assessment_id, indicator_type)
);

CREATE TABLE IF NOT EXISTS economic_fetch_log (
  provider_id  TEXT NOT NULL,
  country      TEXT NOT NULL,
  fetched_at   TEXT NOT NULL,
  ok           INTEGER NOT NULL,
  note         TEXT,
  PRIMARY KEY (provider_id, country)
);

-- Dividend events recorded by the signed-in user against their own stock/ETF holding.
-- Amounts and FX rates are whatever the user entered. Imputation credits are not cash.
-- fx_rate_to_nzd is NULL when the user did not record a rate (NZD rows store 1).
-- holding_id is cleared when that user's holding is deleted. The payment row stays.
-- Yield ignores rows with no current holding. Account deletion removes the user's rows.
CREATE TABLE IF NOT EXISTS dividend_events (
  id                   TEXT PRIMARY KEY,
  user_id              TEXT NOT NULL,
  holding_id           TEXT,
  company_name         TEXT NOT NULL,
  symbol               TEXT,
  shares_held          REAL NOT NULL,
  dividend_per_share   REAL NOT NULL,
  gross_dividend       REAL NOT NULL,
  tax_withholding      REAL NOT NULL DEFAULT 0,
  imputation_credits   REAL NOT NULL DEFAULT 0,
  net_dividend         REAL NOT NULL,
  payment_date         TEXT NOT NULL,
  currency             TEXT NOT NULL DEFAULT 'NZD',
  fx_rate_to_nzd       REAL,
  reinvested           INTEGER NOT NULL DEFAULT 0,
  reinvested_amount    REAL,
  notes                TEXT,
  created_at           TEXT NOT NULL,
  updated_at           TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_dividend_events_user_date
  ON dividend_events(user_id, payment_date);

-- Category remembered for a payee this user has used (income description, transaction
-- description/merchant, or dividend company). Category must already exist for that user.
CREATE TABLE IF NOT EXISTS payee_settings (
  id           TEXT PRIMARY KEY,
  user_id      TEXT NOT NULL,
  name         TEXT NOT NULL,
  name_key     TEXT NOT NULL,
  category_id  TEXT,
  created_at   TEXT NOT NULL,
  updated_at   TEXT NOT NULL
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_payee_settings_user_key
  ON payee_settings(user_id, name_key);

-- per-user indexes created in migrateSchema after user_id columns exist
