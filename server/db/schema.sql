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
  -- Charged bank account; NULL = not charged to one (e.g. crypto Visa debit card spend).
  account_id    TEXT REFERENCES bank_accounts(id) ON DELETE CASCADE,
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
  notes           TEXT,
  kind            TEXT NOT NULL DEFAULT 'manual'  -- manual (POST /snapshots) | auto (daily, on load)
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

-- Personal debts / creditors (Spending → I owe, Debts page).
-- kind: person | corporation (who is owed).
-- product_kind: credit_card | personal_loan | student_loan | car_loan | mortgage | bnpl.
-- is_loan is an explicit flag. interest_period is month, year, or NULL when interest does not recur.
-- Rates, payments, term, and interest paid stay NULL until the user enters them.
CREATE TABLE IF NOT EXISTS debt_people (
  id               TEXT PRIMARY KEY,
  user_id          TEXT,
  name             TEXT NOT NULL,
  kind             TEXT NOT NULL DEFAULT 'person',  -- person | corporation
  notes            TEXT,
  outstanding_nzd  REAL NOT NULL DEFAULT 0,
  created_at       TEXT NOT NULL,
  updated_at       TEXT NOT NULL,
  product_kind     TEXT,
  is_loan          INTEGER NOT NULL DEFAULT 0,
  interest_period  TEXT,  -- month | year | NULL
  interest_rate_percent REAL,  -- annual percent entered by the user
  minimum_payment_nzd REAL,
  actual_payment_nzd REAL,
  remaining_term_months INTEGER,
  interest_paid_nzd REAL,
  interest_posted_through TEXT,  -- YYYY-MM-DD cursor for scheduled interest
  interest_charged_nzd REAL NOT NULL DEFAULT 0
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
  dividend_event_id TEXT,
  -- Set when this row mirrors one invoice payment (KAN-71).
  invoice_payment_id TEXT,
  -- Set when this row mirrors one rental income entry (KAN-66).
  rental_entry_id TEXT
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
  -- 2FA (KAN-16): AES-256-GCM sealed TOTP secrets (server/auth/secretBox.ts), never plaintext.
  totp_secret_enc  TEXT,
  totp_pending_enc TEXT,              -- set up but not yet confirmed with a code
  totp_pending_at  TEXT,
  totp_enabled_at  TEXT,
  totp_last_step   INTEGER,           -- last accepted TOTP step (replay protection)
  created_at      TEXT NOT NULL,
  updated_at      TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS sessions (
  id           TEXT PRIMARY KEY,
  user_id      TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  token_hash   TEXT NOT NULL UNIQUE,
  expires_at   TEXT NOT NULL,
  created_at   TEXT NOT NULL,
  device_label TEXT,                  -- "Chrome on Windows" (coarse, from User-Agent)
  last_seen_at TEXT,                  -- updated at most every 10 min
  persistent   INTEGER NOT NULL DEFAULT 1, -- 0 = "keep me signed in" unticked (browser-session cookie)
  passkey_id   TEXT                       -- passkey that opened it (KAN-75); removing the passkey ends it
);

-- 2FA backup codes: SHA-256 of a high-entropy code, each usable once.
CREATE TABLE IF NOT EXISTS user_backup_codes (
  id         TEXT PRIMARY KEY,
  user_id    TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  code_hash  TEXT NOT NULL,
  used_at    TEXT,
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_backup_codes_user ON user_backup_codes(user_id);

-- Password accepted, second factor pending (short-lived, attempt-limited).
CREATE TABLE IF NOT EXISTS login_challenges (
  id          TEXT PRIMARY KEY,
  user_id     TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  token_hash  TEXT NOT NULL UNIQUE,
  persistent  INTEGER NOT NULL DEFAULT 1,
  attempts    INTEGER NOT NULL DEFAULT 0,
  created_at  TEXT NOT NULL,
  expires_at  TEXT NOT NULL
);

-- "Trust this device": skips the second factor on this browser until expiry.
CREATE TABLE IF NOT EXISTS trusted_devices (
  id           TEXT PRIMARY KEY,
  user_id      TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  token_hash   TEXT NOT NULL UNIQUE,
  label        TEXT,
  created_at   TEXT NOT NULL,
  last_used_at TEXT,
  expires_at   TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_trusted_devices_user ON trusted_devices(user_id);

-- Passkeys (KAN-75): WebAuthn credentials. public_key is the credential's COSE public key
-- (base64url); it is not a secret. credential_id is the authenticator's id (base64url).
CREATE TABLE IF NOT EXISTS user_passkeys (
  id            TEXT PRIMARY KEY,
  user_id       TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  credential_id TEXT NOT NULL UNIQUE,
  public_key    TEXT NOT NULL,
  counter       INTEGER NOT NULL DEFAULT 0,
  transports    TEXT,
  name          TEXT NOT NULL,
  backed_up     INTEGER NOT NULL DEFAULT 0,
  created_at    TEXT NOT NULL,
  last_used_at  TEXT
);
CREATE INDEX IF NOT EXISTS idx_user_passkeys_user ON user_passkeys(user_id);

-- Single-use WebAuthn challenges (5 min). user_id is set for registration; sign-in
-- challenges have none, because the passkey itself says whose it is.
CREATE TABLE IF NOT EXISTS webauthn_challenges (
  id          TEXT PRIMARY KEY,
  user_id     TEXT,
  purpose     TEXT NOT NULL,
  challenge   TEXT NOT NULL UNIQUE,
  persistent  INTEGER NOT NULL DEFAULT 1,
  created_at  TEXT NOT NULL,
  expires_at  TEXT NOT NULL
);

-- Sign-in audit log (KAN-75): sign-ins and passkey changes. Device label only, no IP.
CREATE TABLE IF NOT EXISTS auth_events (
  id           TEXT PRIMARY KEY,
  user_id      TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  kind         TEXT NOT NULL,
  method       TEXT,
  device_label TEXT,
  created_at   TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_auth_events_user ON auth_events(user_id, created_at);

-- Single sign-on links: one row per provider account (Google / Apple / Microsoft).
-- subject = the provider's stable user id ("sub"), never the email (emails change).
CREATE TABLE IF NOT EXISTS user_identities (
  id           TEXT PRIMARY KEY,
  user_id      TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  provider     TEXT NOT NULL,
  subject      TEXT NOT NULL,
  email        TEXT,
  created_at   TEXT NOT NULL,
  last_used_at TEXT,
  UNIQUE (provider, subject)
);
CREATE INDEX IF NOT EXISTS idx_user_identities_user ON user_identities(user_id);

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
  reinvested_amount    REAL, -- net cash reinvested in the payment currency; does not change holdings.shares
  notes                TEXT,
  created_at           TEXT NOT NULL,
  updated_at           TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_dividend_events_user_date
  ON dividend_events(user_id, payment_date);

-- On/off for one forecast payment this user can see. Not a dividend_events row and not income.
-- Absence means reinvest is off. Deleting the holding or the account removes only that user's rows.
CREATE TABLE IF NOT EXISTS dividend_forecast_reinvest (
  id           TEXT PRIMARY KEY,
  user_id      TEXT NOT NULL,
  holding_id   TEXT NOT NULL,
  payment_date TEXT NOT NULL,
  reinvested   INTEGER NOT NULL DEFAULT 0,
  created_at   TEXT NOT NULL,
  updated_at   TEXT NOT NULL
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_dividend_forecast_reinvest_user_holding_date
  ON dividend_forecast_reinvest(user_id, holding_id, payment_date);

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

-- Savings goals. target / current / deadline are stored. Weekly and monthly
-- saving, percent complete, and estimated completion are counted on read
-- (server/savings/model.ts). Amounts are NZD. deadline is YYYY-MM-DD or NULL.
-- current_amount_nzd is the user's figure for this goal. It is not a bank
-- balance and is not added to net worth.
CREATE TABLE IF NOT EXISTS savings_goals (
  id                  TEXT PRIMARY KEY,
  user_id             TEXT,
  name                TEXT NOT NULL,
  notes               TEXT,
  target_nzd          REAL NOT NULL,
  current_amount_nzd  REAL NOT NULL DEFAULT 0,
  deadline            TEXT,
  -- Bank account holding this saving: when set, amount saved = that account's balance.
  account_id          TEXT,
  created_at          TEXT NOT NULL,
  updated_at          TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_savings_goals_user ON savings_goals(user_id);

-- Donations ledger. Separate from transactions and from charity receipt files
-- (transactions.receipt_path under data/uploads/receipts/). A row may optionally
-- point at a transaction that already has a receipt. Amounts are NZD. date is
-- YYYY-MM-DD. Tax-year totals are counted on read (server/donations/model.ts).
-- No foreign key: sql.js does not keep PRAGMA foreign_keys from this script.
-- The trigger below clears the pointer when that transaction is deleted.
CREATE TABLE IF NOT EXISTS donations (
  id                      TEXT PRIMARY KEY,
  user_id                 TEXT,
  date                    TEXT NOT NULL,
  recipient               TEXT NOT NULL,
  amount_nzd              REAL NOT NULL,
  notes                   TEXT,
  evidence_url            TEXT,
  receipt_transaction_id  TEXT,
  created_at              TEXT NOT NULL,
  updated_at              TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_donations_user ON donations(user_id);
CREATE INDEX IF NOT EXISTS idx_donations_user_date ON donations(user_id, date);

CREATE TRIGGER IF NOT EXISTS donations_clear_receipt_link
AFTER DELETE ON transactions
FOR EACH ROW
BEGIN
  UPDATE donations
  SET receipt_transaction_id = NULL
  WHERE receipt_transaction_id = OLD.id;
END;
-- Saved pay calculations (KAN-70): piece rate, contract (schedular), share of catch.
-- inputs_json holds the calculator inputs; weekly figures are recomputed from them on
-- save (src/lib/outputPayCalc.ts). weekly_net_nzd feeds the budget, home snapshot and
-- projections as expected income. Amounts are NZD.
CREATE TABLE IF NOT EXISTS pay_sources (
  id               TEXT PRIMARY KEY,
  user_id          TEXT,
  name             TEXT NOT NULL,
  pay_type         TEXT NOT NULL,
  tax_year         INTEGER NOT NULL,
  inputs_json      TEXT NOT NULL,
  weekly_gross_nzd REAL NOT NULL,
  weekly_net_nzd   REAL NOT NULL,
  created_at       TEXT NOT NULL,
  updated_at       TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_pay_sources_user ON pay_sources(user_id);

-- Invoices (KAN-71). Business details, clients, invoices, lines, payments and send log,
-- all per user. Totals are recomputed from the lines on every save (src/lib/invoiceCalc.ts).
-- status stores draft | sent | void; partly paid / paid / overdue are counted on read.
-- business_json / client_* snapshot who the invoice was from and to when it was saved,
-- so later edits to settings or the client don't change an invoice already sent.
CREATE TABLE IF NOT EXISTS business_profiles (
  user_id        TEXT PRIMARY KEY,
  business_name  TEXT NOT NULL DEFAULT '',
  address        TEXT NOT NULL DEFAULT '',
  email          TEXT NOT NULL DEFAULT '',
  phone          TEXT NOT NULL DEFAULT '',
  bank_account   TEXT NOT NULL DEFAULT '',
  gst_registered INTEGER NOT NULL DEFAULT 0,
  gst_number     TEXT NOT NULL DEFAULT '',
  nzbn           TEXT NOT NULL DEFAULT '',
  invoice_prefix TEXT NOT NULL DEFAULT 'INV-',
  updated_at     TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS invoice_clients (
  id          TEXT PRIMARY KEY,
  user_id     TEXT,
  name        TEXT NOT NULL,
  email       TEXT NOT NULL DEFAULT '',
  address     TEXT NOT NULL DEFAULT '',
  reference   TEXT NOT NULL DEFAULT '',
  created_at  TEXT NOT NULL,
  updated_at  TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_invoice_clients_user ON invoice_clients(user_id);

CREATE TABLE IF NOT EXISTS invoices (
  id                   TEXT PRIMARY KEY,
  user_id              TEXT,
  number               TEXT NOT NULL,
  number_key           TEXT NOT NULL,
  status               TEXT NOT NULL DEFAULT 'draft',
  client_id            TEXT,
  client_name          TEXT NOT NULL DEFAULT '',
  client_email         TEXT NOT NULL DEFAULT '',
  client_address       TEXT NOT NULL DEFAULT '',
  client_reference     TEXT NOT NULL DEFAULT '',
  issue_date           TEXT NOT NULL,
  due_preset           TEXT NOT NULL DEFAULT 'days_14',
  due_date             TEXT NOT NULL,
  reference            TEXT NOT NULL DEFAULT '',
  gst_mode             TEXT NOT NULL DEFAULT 'none',
  withholding_rate_pct REAL,
  notes                TEXT NOT NULL DEFAULT '',
  payment_instructions TEXT NOT NULL DEFAULT '',
  business_json        TEXT NOT NULL DEFAULT '{}',
  subtotal_nzd         REAL NOT NULL DEFAULT 0,
  gst_nzd              REAL NOT NULL DEFAULT 0,
  total_nzd            REAL NOT NULL DEFAULT 0,
  withholding_nzd      REAL NOT NULL DEFAULT 0,
  amount_due_nzd       REAL NOT NULL DEFAULT 0,
  share_token          TEXT,
  sent_at              TEXT,
  voided_at            TEXT,
  created_at           TEXT NOT NULL,
  updated_at           TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_invoices_user ON invoices(user_id);
CREATE UNIQUE INDEX IF NOT EXISTS idx_invoices_user_number ON invoices(user_id, number_key);
CREATE UNIQUE INDEX IF NOT EXISTS idx_invoices_share_token ON invoices(share_token);

CREATE TABLE IF NOT EXISTS invoice_lines (
  id          TEXT PRIMARY KEY,
  user_id     TEXT,
  invoice_id  TEXT NOT NULL,
  position    INTEGER NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  quantity    REAL NOT NULL DEFAULT 0,
  unit        TEXT NOT NULL DEFAULT '',
  rate        REAL NOT NULL DEFAULT 0,
  line_total  REAL NOT NULL DEFAULT 0
);
CREATE INDEX IF NOT EXISTS idx_invoice_lines_invoice ON invoice_lines(invoice_id, position);
CREATE INDEX IF NOT EXISTS idx_invoice_lines_user ON invoice_lines(user_id);

CREATE TABLE IF NOT EXISTS invoice_payments (
  id               TEXT PRIMARY KEY,
  user_id          TEXT,
  invoice_id       TEXT NOT NULL,
  date             TEXT NOT NULL,
  amount_nzd       REAL NOT NULL,
  method           TEXT NOT NULL DEFAULT '',
  notes            TEXT NOT NULL DEFAULT '',
  income_record_id TEXT,
  created_at       TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_invoice_payments_invoice ON invoice_payments(invoice_id);
CREATE INDEX IF NOT EXISTS idx_invoice_payments_user ON invoice_payments(user_id);

-- Every send (invoice or reminder), successful or not. channel: resend (sent by the app,
-- the only channel the send rate limit counts) | email_app (user's own mail app) | share (share sheet).
CREATE TABLE IF NOT EXISTS invoice_sends (
  id          TEXT PRIMARY KEY,
  user_id     TEXT,
  invoice_id  TEXT NOT NULL,
  kind        TEXT NOT NULL,
  channel     TEXT NOT NULL DEFAULT 'resend',
  recipients  TEXT NOT NULL,
  subject     TEXT NOT NULL DEFAULT '',
  status      TEXT NOT NULL,
  provider_id TEXT,
  error       TEXT,
  sent_at     TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_invoice_sends_user_time ON invoice_sends(user_id, sent_at);
CREATE INDEX IF NOT EXISTS idx_invoice_sends_invoice ON invoice_sends(invoice_id);

-- Bills and subscriptions (KAN-26). Saved items (confirmed from detection or added by hand).
-- next_due is an anchor; reads roll it forward to the first due date on or after today.
-- merchant_key links a confirmed item to its transactions (src/lib/recurring.ts merchantKey).
CREATE TABLE IF NOT EXISTS recurring_items (
  id            TEXT PRIMARY KEY,
  user_id       TEXT,
  name          TEXT NOT NULL,
  merchant_key  TEXT,
  kind          TEXT NOT NULL DEFAULT 'bill',
  amount_nzd    REAL NOT NULL,
  cadence       TEXT NOT NULL,
  next_due      TEXT NOT NULL,
  category_id   TEXT,
  status        TEXT NOT NULL DEFAULT 'active',
  source        TEXT NOT NULL DEFAULT 'manual',
  notes         TEXT NOT NULL DEFAULT '',
  created_at    TEXT NOT NULL,
  updated_at    TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_recurring_items_user ON recurring_items(user_id);

-- Detected suggestions the user said are not bills; they are not suggested again.
CREATE TABLE IF NOT EXISTS recurring_dismissed (
  id            TEXT PRIMARY KEY,
  user_id       TEXT,
  merchant_key  TEXT NOT NULL,
  dismissed_at  TEXT NOT NULL
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_recurring_dismissed_user_key ON recurring_dismissed(user_id, merchant_key);

-- Warranties on things the user bought (KAN-61). transaction_id optionally links the
-- purchase; its receipt (if any) is shown from the transaction. receipt_path is the
-- warranty's own receipt / warranty card under data/uploads/warranties/.
CREATE TABLE IF NOT EXISTS warranties (
  id              TEXT PRIMARY KEY,
  user_id         TEXT,
  item_name       TEXT NOT NULL,
  retailer        TEXT NOT NULL DEFAULT '',
  price_nzd       REAL,
  starts_on       TEXT NOT NULL,
  ends_on         TEXT NOT NULL,
  transaction_id  TEXT,
  receipt_path    TEXT,
  notes           TEXT NOT NULL DEFAULT '',
  created_at      TEXT NOT NULL,
  updated_at      TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_warranties_user ON warranties(user_id, ends_on);

-- Rental properties and their income / expenses (KAN-66). amount_nzd is positive; kind
-- says which way. When add_to_money is set (and the date is in range) an income entry is
-- mirrored to income_records.rental_entry_id and an expense to a spending transaction
-- (transaction_id), so Budget, Income and Yearly count the net figures. An expense links
-- the matching bank debit when there is one (txn_owned = 0, never edited or deleted here);
-- otherwise it adds its own manual transaction (txn_owned = 1).
CREATE TABLE IF NOT EXISTS rental_properties (
  id          TEXT PRIMARY KEY,
  user_id     TEXT,
  name        TEXT NOT NULL,
  address     TEXT NOT NULL DEFAULT '',
  notes       TEXT NOT NULL DEFAULT '',
  created_at  TEXT NOT NULL,
  updated_at  TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_rental_properties_user ON rental_properties(user_id);

CREATE TABLE IF NOT EXISTS rental_entries (
  id              TEXT PRIMARY KEY,
  user_id         TEXT,
  property_id     TEXT NOT NULL,
  date            TEXT NOT NULL,
  kind            TEXT NOT NULL,              -- income | expense
  category        TEXT NOT NULL,
  amount_nzd      REAL NOT NULL,
  description     TEXT NOT NULL DEFAULT '',
  add_to_money    INTEGER NOT NULL DEFAULT 1,
  transaction_id  TEXT,                       -- expense mirror
  txn_owned       INTEGER NOT NULL DEFAULT 1,  -- 1 = transaction_id was added by this entry
  created_at      TEXT NOT NULL,
  updated_at      TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_rental_entries_user ON rental_entries(user_id, date);

-- Shopping lists (KAN-74). Per user. est_price_nzd is the price of one unit (× quantity for
-- the line). category_id links an item, or the whole list, to a budget category.
CREATE TABLE IF NOT EXISTS shopping_lists (
  id            TEXT PRIMARY KEY,
  user_id       TEXT,
  name          TEXT NOT NULL,
  category_id   TEXT,
  created_at    TEXT NOT NULL,
  updated_at    TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_shopping_lists_user ON shopping_lists(user_id);

CREATE TABLE IF NOT EXISTS shopping_items (
  id             TEXT PRIMARY KEY,
  user_id        TEXT,
  list_id        TEXT NOT NULL,
  name           TEXT NOT NULL,
  quantity       REAL NOT NULL DEFAULT 1,
  est_price_nzd  REAL,
  category_id    TEXT,
  ticked         INTEGER NOT NULL DEFAULT 0,
  product_key    TEXT,                       -- set when the user corrects the price match
  sort_order     INTEGER NOT NULL DEFAULT 0,
  created_at     TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_shopping_items_list ON shopping_items(list_id, sort_order);

-- Per-user shopping settings: opt-in to contribute prices, the stores to compare, and how
-- recent a price must be. stores_json: [{ "chain": "paknsave", "branch": "Royal Oak" }].
CREATE TABLE IF NOT EXISTS shopping_prefs (
  user_id           TEXT PRIMARY KEY,
  contribute_prices INTEGER NOT NULL DEFAULT 0,
  stores_json       TEXT NOT NULL DEFAULT '[]',
  window_days       INTEGER NOT NULL DEFAULT 60,
  updated_at        TEXT NOT NULL
);

-- Crowdsourced supermarket prices (KAN-74), shared by all users who opt in. No user_id:
-- contributor is a keyed pseudonym (HMAC with the server key) used only for rate limits,
-- outlier checks and removing a person's own prices. It is never returned by the API.
CREATE TABLE IF NOT EXISTS price_observations (
  id            TEXT PRIMARY KEY,
  product_key   TEXT NOT NULL,              -- normalised item name
  product_name  TEXT NOT NULL,              -- as typed, tidied
  chain         TEXT NOT NULL,              -- woolworths | paknsave | newworld | …
  branch_key    TEXT NOT NULL,              -- normalised branch name
  branch_name   TEXT NOT NULL,
  price_nzd     REAL NOT NULL,              -- one unit
  observed_on   TEXT NOT NULL,              -- YYYY-MM-DD (Pacific/Auckland)
  contributor   TEXT NOT NULL,
  created_at    TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_price_obs_lookup ON price_observations(product_key, chain, branch_key, observed_on);
CREATE INDEX IF NOT EXISTS idx_price_obs_contributor ON price_observations(contributor, created_at);

-- Plans (KAN-77). No row = free. Granted by the operator (npm run plan:set) until billing exists.
CREATE TABLE IF NOT EXISTS user_entitlements (
  user_id     TEXT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  plan        TEXT NOT NULL DEFAULT 'free',       -- free | plus | pro
  note        TEXT NOT NULL DEFAULT '',
  updated_at  TEXT NOT NULL
);

-- Households (KAN-77). A user belongs to at most one household. Roles: owner (one per
-- household), adult (edits shared items), viewer (read-only). Invites are single-use links
-- tied to an email address; only the token's hash is stored.
CREATE TABLE IF NOT EXISTS households (
  id          TEXT PRIMARY KEY,
  name        TEXT NOT NULL,
  owner_id    TEXT NOT NULL,
  created_at  TEXT NOT NULL,
  updated_at  TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS household_members (
  household_id  TEXT NOT NULL REFERENCES households(id) ON DELETE CASCADE,
  user_id       TEXT NOT NULL UNIQUE REFERENCES users(id) ON DELETE CASCADE,
  role          TEXT NOT NULL,                     -- owner | adult | viewer
  joined_at     TEXT NOT NULL,
  PRIMARY KEY (household_id, user_id)
);
CREATE TABLE IF NOT EXISTS household_invites (
  id            TEXT PRIMARY KEY,
  household_id  TEXT NOT NULL REFERENCES households(id) ON DELETE CASCADE,
  email         TEXT NOT NULL,
  role          TEXT NOT NULL,                     -- adult | viewer
  token_hash    TEXT NOT NULL UNIQUE,
  invited_by    TEXT NOT NULL,
  created_at    TEXT NOT NULL,
  expires_at    TEXT NOT NULL,
  accepted_at   TEXT,
  revoked_at    TEXT
);
CREATE INDEX IF NOT EXISTS idx_household_invites_household ON household_invites(household_id);
-- Who changed what in the household. actor_id may point to someone who has since left.
CREATE TABLE IF NOT EXISTS household_activity (
  id            TEXT PRIMARY KEY,
  household_id  TEXT NOT NULL REFERENCES households(id) ON DELETE CASCADE,
  actor_id      TEXT,
  actor_name    TEXT NOT NULL,
  action        TEXT NOT NULL,
  detail        TEXT NOT NULL DEFAULT '',
  created_at    TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_household_activity ON household_activity(household_id, created_at);
-- Items a member shares with their household (KAN-77 phase 2). Nothing moves: the item stays
-- in its owner's tables; this row only makes it visible (and, for budgets, goals and bills,
-- editable by adults). kind: budget (budget_categories.id) | bill (recurring_items.id) |
-- goal (savings_goals.id) | holding (holdings.id) | account (bank_accounts.id).
CREATE TABLE IF NOT EXISTS household_shares (
  household_id  TEXT NOT NULL REFERENCES households(id) ON DELETE CASCADE,
  owner_id      TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  kind          TEXT NOT NULL,
  item_id       TEXT NOT NULL,
  shared_at     TEXT NOT NULL,
  PRIMARY KEY (household_id, kind, item_id)
);
CREATE INDEX IF NOT EXISTS idx_household_shares_owner ON household_shares(owner_id);
-- Splits and settle-up (KAN-77 phase 3). A split divides one spend on a shared account
-- between members; the payer is owed everyone else's share. total_nzd is kept so balances stay
-- right even if the transaction is later deleted. Rows stay when someone leaves (their balance
-- is still shown), and go with the household.
CREATE TABLE IF NOT EXISTS household_splits (
  id              TEXT PRIMARY KEY,
  household_id    TEXT NOT NULL REFERENCES households(id) ON DELETE CASCADE,
  transaction_id  TEXT NOT NULL,
  payer_id        TEXT NOT NULL,
  method          TEXT NOT NULL,              -- equal | percent | amount
  total_nzd       REAL NOT NULL,
  description     TEXT NOT NULL DEFAULT '',
  txn_date        TEXT NOT NULL,
  created_by      TEXT NOT NULL,
  created_at      TEXT NOT NULL,
  updated_at      TEXT NOT NULL,
  UNIQUE (household_id, transaction_id)
);
CREATE TABLE IF NOT EXISTS household_split_shares (
  split_id    TEXT NOT NULL REFERENCES household_splits(id) ON DELETE CASCADE,
  member_id   TEXT NOT NULL,
  amount_nzd  REAL NOT NULL,
  input       REAL,                           -- the percent or amount typed, for editing
  PRIMARY KEY (split_id, member_id)
);
-- Money paid between members to settle up: from_id paid to_id.
CREATE TABLE IF NOT EXISTS household_settlements (
  id            TEXT PRIMARY KEY,
  household_id  TEXT NOT NULL REFERENCES households(id) ON DELETE CASCADE,
  from_id       TEXT NOT NULL,
  to_id         TEXT NOT NULL,
  amount_nzd    REAL NOT NULL,
  paid_on       TEXT NOT NULL,
  note          TEXT NOT NULL DEFAULT '',
  created_by    TEXT NOT NULL,
  created_at    TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_household_settlements ON household_settlements(household_id, paid_on);

-- Read-only crypto wallets: public address only. Never store seed phrases / private keys.
-- No balance column on purpose: balances come from chain providers at sync time
-- (balance is never stored as the source of truth here).
CREATE TABLE IF NOT EXISTS wallets (
  id              TEXT PRIMARY KEY,
  user_id         TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  name            TEXT NOT NULL,
  network         TEXT NOT NULL,              -- ethereum | polygon | base | arbitrum | bitcoin | solana
  address         TEXT NOT NULL,              -- normalised (EVM EIP-55 checksummed, bech32 lowercase)
  status          TEXT NOT NULL DEFAULT 'connected',  -- connected | syncing | error (sync job owns this)
  status_message  TEXT,
  last_synced     TEXT,
  next_sync_at    TEXT,                       -- scheduler: due time (backoff pushes it later)
  sync_failures   INTEGER NOT NULL DEFAULT 0, -- consecutive failures, drives backoff
  created_at      TEXT NOT NULL,
  updated_at      TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_wallets_user ON wallets(user_id);
CREATE UNIQUE INDEX IF NOT EXISTS idx_wallets_user_network_address ON wallets(user_id, network, address);

-- per-user indexes created in migrateSchema after user_id columns exist
