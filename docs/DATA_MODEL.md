# Data model

Local-first NZD portfolio + budgeting tracker for Nathan McCormick (NZ, Pacific/Auckland).

Persistence: SQLite via **sql.js** (WASM), file at `data/portfolio.db`. Schema: `server/db/schema.sql`. Types: `src/types/index.ts`.

**Rules:** never store bank/Sharesies passwords; never invent live prices, GoMining marketplace values, or stone valuations.

## Entity relationship (overview)

```
bank_accounts 1──* transactions *──? budget_categories
budget_categories 1──* budgets
income_records ?──? transactions   (optional link; cat-income credits also feed received)
income_plans                       (planned NZD per YYYY-MM)

holdings  (polymorphic by asset_class)
  ├── stock
  ├── crypto          (optional GMT token balance)
  ├── gomining_miner  (first-class digital miners)
  ├── art
  ├── metal
  ├── stone
  └── forex            (Revolut etc. foreign cash → NZD via Frankfurter)

kiwisaver_accounts  (Sharesies via Akahu + bank-held manual/CSV)
price_quotes        (cache; stub providers write status=stubbed)
valuation_snapshots (net-worth history)
app_settings / meta
```

## Bank accounts & transactions

| Entity | Purpose |
|--------|---------|
| `bank_accounts` | Cash / credit / etc. Balances in account currency (default NZD). **No passwords.** |
| `transactions` | Imported or manual. Signed `amount`; optional `category_id`, `external_id` for dedupe. `source`: `akahu` \| `bank` \| `google_wallet` \| `manual` \| `csv`. Optional explicit **Use BTC** (`affects_btc`) adjusts a BTC crypto holding via live BTC/NZD quote — never auto from category; stores `btc_holding_id` + `btc_delta_applied` for idempotent reverse. |
| `budget_categories` | Categories with `type`: `spending` \| `income` \| `transfer_out` \| `transfer_in` (seeded). Only **spending** counts toward Budget spend charts; **transfer_in** is never income; **transfer_out** is never spend. `is_income` stays 1 iff `type=income`. Charity remains a spending category. |
| `budgets` | Period amount (NZD) per category. Seeded categories include **Debt** (`cat-debt`) and **Charity** (`cat-charity`). Charity txns may store `receipt_path` (IR526) under `data/uploads/receipts/` and link amounts into PAYE charity donation credits. |
| `debt_people` | People Nathan owes: `name`, optional `notes`, `outstanding_nzd`. Sum of outstanding is a **liability** on Dashboard / net worth (`assets − debt`). |
| `debt_repayments` | Repayments toward a person (`amount_nzd`, `date` ≥ 2026-10-01, optional `transaction_id`). Reduces outstanding. Unlinked repayments count toward Debt on spend charts; Yearly report shows live outstanding + year repayment history (never invents). Snapshots store `debt` in breakdown_json. |

## Portfolio holdings (`holdings`)

Single table, discriminated by `asset_class`:

| Class | Key fields |
|-------|------------|
| `stock` | `symbol`, `shares` (fractional), `exchange`, `cost_basis_nzd` (total paid NZD; manual re-add of same ticker merges qty + sums cost) |
| `crypto` | `asset` (e.g. BTC, **GMT**), `amount`, `cost_basis_nzd` (total paid NZD; manual re-add of same ticker merges amount + sums cost) — live via CoinGecko |
| `gomining_miner` | **First-class GoMining digital miners** (multiple rows). See below. |
| `art` | Fractional or physical (`art_kind`); `ownership_pct`, purchase, manual `last_valuation_nzd`; physical may use `photo_path`. **No Masterworks API** — see [ART.md](./ART.md) |
| `metal` | `metal`, `metal_amount`, `metal_unit` (`g` \| `oz_t`), cost basis; market value from `price_quotes` when Metals.Dev spot exists |
| `stone` | type, carat, clarity/cut/colour, dims; `valuation_nzd` **null until verified** |
| `forex` | Foreign cash outside NZ bank (e.g. Revolut). `asset` = ISO currency (USD/EUR/GBP), `amount` = foreign units, optional `cost_basis_nzd`, `source` (Revolut…). Market NZD via Frankfurter (`FX:USD` quotes) — **never invent rates** |

### GoMining digital miners (`gomining_miner`)

[GoMining](https://gomining.com/) hashrate / NFT-style miners — track **each miner**, not only GMT token.

| Field | Notes |
|-------|--------|
| `miner_name` | Identifier / nickname |
| `miner_external_id` | Optional platform id |
| `hashrate_ths` | TH/s, fractional OK |
| `energy_efficiency_wth` | Optional W/TH from GoMining app |
| `rarity` | e.g. Common, Rare |
| `level` | Miner level |
| `cost_basis_nzd` | What you paid |
| `acquired_at` | Purchase date |
| `estimated_value_nzd` | Manual, **primary generative** (`gomining`), or **extrapolated from live 12/15** (`gomining_extrapolated`) — **null if unknown** |
| `estimated_value_source` | `manual` \| `gomining` \| `stub` |

**Earnings estimate** (UI): hashrate + EE + optional network params (`app_settings`: `gominingBtcUsd`, `gominingNetworkHashrateEhs`, …). Periods: day / week / month / year. See [GOMINING.md](./GOMINING.md).

**Discount:** `app_settings.gominingDiscountPct` — reduces maintenance in the earnings model only (not secondary NZD value).

GMT token balance (if any) can be a separate `crypto` row with `asset = 'GMT'`.

Valuation refresh: `POST /api/holdings/:id/refresh-value` or `POST /api/holdings/refresh-gomining-values` → public generative marketplace (does not invent prices).

## Income (planned vs received)

| Entity | Purpose |
|--------|---------|
| `budget_categories` (`type=income` / `is_income=1`) | Income categories: **Income**, **Salary**, **Mining**, **Dividends & interest**, **Other income** (seeded). Used for plans, Add income, and tagging bank inflows. **Transfer in** categories are excluded (not income). |
| `income_records` | Explicit inflows from **Add income**: cash (optional linked `transactions` credit on the chosen income category) or crypto (qty × live quote → NZD; merge/create holdings by ticker). Optional `category_id`. Date ≥ 2026-10-01. |
| `income_plans` | **One planned NZD line per income category per month** (`year_month` + `category_id`). Compared to category-matched **received** on the Spending Income cards. |

**Received for a month** = `SUM(income_records in month)` **∪** inflows (`amount > 0`) on `transactions` whose `category_id` is an `is_income` category.

**Category match:** Each planned line (e.g. Salary, Mining) compares to received with the same `category_id` (from the income record or the tagged bank txn). Totals sum all categories.

**Dedupe (no double-count):** When Add income (cash + account) creates a credit, `income_records.transaction_id` points at that txn. The summary skips any income-category credit whose `id` is already linked from an income record, so the dollars appear once (via the record). Crypto records never create a bank txn; they still count fully. Akahu soft-merge keeps the same txn `id` when a placeholder matches — the link still holds, still one count. Leave `external_id` null on Add-income credits so soft-merge can attach the bank id later.

APIs: `GET /api/income?month=`, `GET /api/income/summary?month=` (`actualNzd`, `categories[]` with per-line planned/actual, `plans[]`), `PUT /api/income/plan` `{ yearMonth, categoryId, amountNzd }`.

## KiwiSaver (NZ)

Table: `kiwisaver_accounts` (+ `kiwisaver_balance_history`).

| Field | Notes |
|-------|--------|
| `provider` | `sharesies` for Akahu path; otherwise bank label (ANZ, Westpac, …) for manual/CSV |
| `scheme_name` | Optional scheme / fund product name |
| `balance_nzd` | Observed balance |
| `returns_nzd` | Akahu returns or manual/CSV; amount invested derived as balance − returns |
| `fund_mix_json` | `[{ fundName, allocationPct, balanceNzd }]` |
| `observed_at` | Last observe time |
| `connection_status` | `off` \| `csv_import` \| `official_pending` \| `akahu` \| `manual` |
| `external_id` | `akahu:…` when synced via Akahu |

**Read-only** for net worth — not trading. **Never scrape. Never store passwords.**

- **Sharesies:** Akahu sync (`connection_status=akahu`). `POST /api/kiwisaver/import-sharesies-csv` remains a stub.
- **Bank-held:** IRD/Akahu bank KS not available → KiwiSaver tab **manual form** + `POST /api/kiwisaver/import-bank-csv`. Honest UI labels: Manual / Manual (CSV) vs Akahu (Sharesies). History point on each save.

## Quotes & snapshots

| Entity | Purpose |
|--------|---------|
| `price_quotes` | Cache by `asset_key` (`STOCK:…`, `CRYPTO:…`, `GOMINING:miner:…`, `METAL:…`, `STONE:…`, `FX:USD`). `price` may be null; `status` reflects stub/unavailable. |
| `valuation_snapshots` | Point-in-time net-worth history. |

### Quote providers

| Provider | Asset keys | Behaviour |
|----------|------------|-----------|
| Kraken | `CRYPTO:*` | Stub for generic; crypto spot uses CoinGecko path |
| Frankfurter | `FX:*` | Live FX→NZD for forex holdings (ECB daily); USD fallback BTC FX ratio |
| Metal spot (Metals.Dev) | `METAL:*:oz_t` | Live NZD/oz t when `METALS_API_KEY` set; else unavailable |
| GoMining | `GOMINING:*` | Primary generative USD/TH × BTC FX → NZD (stub if API down) |
| Equity | `STOCK:*` | Yahoo Finance live × Frankfurter/BTC FX → NZD |
| Stone comps | `STONE:*` | `not_applicable` until search comps |

## Net-worth buckets

Cash + stocks (cost) + crypto (cost) + **GoMining miners** (est. value or cost) + art + **metals** (spot NZD when quotes exist, else cost) + stones (**known only**) + **forex** (Frankfurter → NZD) + **KiwiSaver** (Sharesies Akahu + bank-held manual/CSV).

Timezone for display: **Pacific/Auckland**. Currency default: **NZD**.


See also: [METALS.md](./METALS.md), [GOMINING.md](./GOMINING.md), [SHARESIES_KIWISAVER.md](./SHARESIES_KIWISAVER.md), [IMPORT_FORMATS.md](./IMPORT_FORMATS.md).
