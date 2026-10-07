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
dividend_events *──? holdings      (stock/ETF only; user_id on both)

holdings  (polymorphic by asset_class)
  ├── stock
  ├── crypto          (optional GMT token balance)
  ├── gomining_miner  (first-class digital miners)
  ├── art
  ├── metal
  ├── stone
  └── forex            (Revolut etc. foreign cash → NZD via Frankfurter)

kiwisaver_accounts  (Sharesies via Akahu + bank-held manual/CSV)
savings_goals          (target, current amount, optional deadline; progress counted on read)
donations               (date, recipient, NZD amount; optional evidence URL;
                         optional pointer to a transaction that already has a receipt.
                         Not a receipt file and not a transactions row.)
wallets             (read-only crypto wallets — public address only)
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
| `income_records` | Explicit inflows from **Add income**: cash (optional linked `transactions` credit on the chosen income category) or crypto (qty × live quote → NZD; merge/create holdings by ticker). Optional `category_id`. Date ≥ 2026-10-01. A paid dividend also inserts one row for that user (`dividend_event_id`), payee = the holding/company name, amount = net cash in NZD using the FX rate they recorded. Foreign payments with no rate are omitted. Updating or deleting the dividend updates or removes that user’s row only. |
| `payee_settings` | Category remembered for a payee this user has used (income description, transaction description/merchant, or dividend company). `category_id` must already belong to that user. Applied the next time that payee is used. |
| `income_plans` | **One planned NZD line per income category per month** (`year_month` + `category_id`). Compared to category-matched **received** on the Spending Income cards. |

**Received for a month** = `SUM(income_records in month)` **∪** inflows (`amount > 0`) on `transactions` whose `category_id` is an `is_income` category.

**Category match:** Each planned line (e.g. Salary, Mining) compares to received with the same `category_id` (from the income record or the tagged bank txn). Totals sum all categories.

**Dedupe (no double-count):** When Add income (cash + account) creates a credit, `income_records.transaction_id` points at that txn. The summary skips any income-category credit whose `id` is already linked from an income record, so the dollars appear once (via the record). Crypto records never create a bank txn; they still count fully. Akahu soft-merge keeps the same txn `id` when a placeholder matches — the link still holds, still one count. Leave `external_id` null on Add-income credits so soft-merge can attach the bank id later.

APIs: `GET /api/income?month=`, `GET /api/income/summary?month=` (`actualNzd`, `categories[]` with per-line planned/actual, `plans[]`), `PUT /api/income/plan` `{ yearMonth, categoryId, amountNzd }`.

## Dividends (personal record)

Table: `dividend_events`. One row per payment the signed-in user records against **their** stock or ETF holding (`holding_id` must match `holdings.user_id` and `asset_class = stock`). Company/ETF name and symbol are copied from that holding. Deleting that holding sets `holding_id` to null on that user's rows only; the recorded amounts stay. Another user's holdings are not readable or writable from this user's dividend routes. Deleting the account still deletes that user's `dividend_events`.

| Field | Notes |
|-------|--------|
| `shares_held`, `dividend_per_share` | Snapshot at payment. Gross = shares × dividend per share |
| `tax_withholding` | Deducted from gross |
| `imputation_credits` | NZ imputation credits. Recorded beside the cash figures; **not** subtracted from net |
| `net_dividend` | Gross − tax/withholding, in the payment currency |
| `payment_date` | `YYYY-MM-DD`. On or before today (Pacific/Auckland) counts as paid; later dates are upcoming amounts the user stated |
| `currency`, `fx_rate_to_nzd` | NZD stores rate `1`. Any other currency converts to NZD only when the user recorded a rate. A blank rate is left blank |
| `reinvested`, `reinvested_amount` | On/off and the net cash reinvested in the payment currency. Does not change `holdings.shares`. A recorded payment adds extra shares of the same holding in the forecast only when its date is after today, using a saved NZD quote or, if there is none, cost basis divided by shares owned. Paid reinvestment is already in the shares owned and does not add shares again. Forecast rows reinvest their gross cash (per share times projected shares; tax is not estimated). If neither price exists, the projected share count stays unchanged |

Dashboard totals (monthly, annual, year income, growth, yield, forecast, upcoming, history) are computed from these rows. Growth compares the same dates in each year: 1 January through the same month and day when the selected year is still open (29 February compares with 28 February), or the full calendar year when that year is already complete. Payments outside the window stay in the annual totals. No missing months are filled in. `growth.previousThrough` and `growth.currentThrough` are the inclusive ends of those windows. Yield uses a saved `price_quotes` row with `status = ok` when one exists, otherwise the holding’s recorded cost basis, and is omitted when that value is missing. Rows with a null or unknown `holding_id` are left out of yield and do not block yield on holdings that remain. The forecast repeats the user’s last 12 months, sums upcoming rows they entered, and lists predicted payments for the next 12 months from published dividend history. Predicted amounts use a projected share count that starts at the shares owned. Only a recorded payment dated after today, or a forecast row with reinvest on, adds shares for later predicted payments. An upcoming payment the user already entered is not repeated; later predicted payments for that holding can still appear. Forecast reinvestment uses gross cash because tax is not estimated. They are not saved as `dividend_events` or `income_records`. It is not a market forecast and it is not financial advice. The dividend cards are on the Portfolio page only. A paid row with an NZD amount (NZD, or another currency with an FX rate the user recorded) is also one Budgeting income row for that user. The payee is the holding or company name. `GET/POST /api/dividends`, `PATCH/DELETE /api/dividends/:id`. Reinvest toggle for a recorded payment: `PATCH /api/dividends/:id/reinvest` `{ reinvested: boolean }` (sets `reinvested_amount` to the net dividend when on). Reinvest toggle for a forecast row: `PUT /api/dividends/forecast-reinvest` `{ holdingId, paymentDate, reinvested }` stored in `dividend_forecast_reinvest` for that user only. Both responses include `ownedShares` (unchanged) and that holding’s `detected` rows (`id` is `holdingId:paymentDate`, `projectedShares`, `reinvestment.status` of `off`, `applied`, or `unavailable`). Payee categories: `GET/PUT /api/payees`.

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

Employee contribution **rate** (not a dollar amount) is stored per user at `users.preferences_json.kiwiSaverEmployeeRatePct`. When none is saved, the PAYE page offers **3.5%** (the statutory minimum from 1 April 2026). The calculator multiplies the gross pay the user enters by that rate. `GET/PUT /api/settings/kiwisaver-employee-rate`.

## Savings goals

Table: `savings_goals`. One row per goal for the signed-in user. Amounts are **NZD**. Dates are calendar dates. `asOf` on each response is **today in Pacific/Auckland**.

`current_amount_nzd` is the figure the user entered for this goal. It is **not** a bank balance and is **not** added to net worth (that money may already sit on an account).

| Stored | API field | Notes |
|--------|-----------|--------|
| `name` | `name` | Required |
| `target_nzd` | `targetNzd` | Goal amount, NZD. Must be greater than 0 after rounding to cents |
| `current_amount_nzd` | `currentAmountNzd` | Saved so far, NZD. Defaults to 0. Must be ≥ 0 |
| `deadline` | `deadline` | `YYYY-MM-DD`, or null when no date is set |
| `notes` | `notes` | Optional |

Progress is **not stored**. It is counted on every read from `targetNzd`, `currentAmountNzd`, and `deadline`. No interest and no separate savings rate are assumed, because neither is stored.

Let `remaining = max(0, target − current)` in NZD, rounded to cents. A week is 7 days. A mean month is `365.25 / 12` days (30.4375). `daysRemaining` is the whole calendar days from `asOf` to `deadline` (negative when the deadline is already past, null when no deadline is set).

| Response field | Formula |
|----------------|---------|
| `remainingNzd` | `max(0, round(targetNzd − currentAmountNzd))` |
| `percentComplete` | `currentAmountNzd / targetNzd × 100`, rounded to 2 decimals. **A percent, not a fraction** (25 means 25%). May exceed 100 |
| `requiredWeeklySavingNzd` | See below. NZD per week |
| `requiredMonthlySavingNzd` | See below. NZD per month, using the 30.4375-day month |
| `estimatedCompletion` | `YYYY-MM-DD` or null. See below |
| `daysRemaining` | `deadline − asOf` in whole days, or null |
| `currency` | Always `NZD` |
| `timezone` | Always `Pacific/Auckland` |

**Required weekly and monthly saving**

- `remaining` is 0: both are **0**. The goal is already met.
- No deadline, or `daysRemaining < 0`: both are **null**. A past date cannot define a future weekly or monthly amount, and no other pace is stored.
- `daysRemaining` is 0: both **equal `remaining`**. The gap is due today, so it is not spread across a later week or month.
- `daysRemaining > 0`:
  - weekly = `remaining × 7 / daysRemaining`
  - monthly = `remaining × (365.25 / 12) / daysRemaining`
  - each rounded to the nearest cent.

A 365-day deadline is a little longer than 12 mean months, so a goal of 12000 NZD due in 365 days needs **1000.68 NZD per month**, not 1000.

**Estimated completion**

- `remaining` is 0: **`asOf`**. The goal is already met. The day it was first reached is not stored.
- Deadline is today or later, and a gap is still open: **the deadline**. That is the date the required weekly or monthly amount finishes the goal.
- Otherwise **null**. A missed deadline does not invent a later date, and a goal with no deadline has no completion date.

Worked example, counted on 2026-10-05, target 10000, current 2500, deadline 2027-04-05 (182 days):

- `remainingNzd` 7500
- `percentComplete` 25
- `requiredWeeklySavingNzd` 288.46
- `requiredMonthlySavingNzd` 1254.29
- `estimatedCompletion` `2027-04-05`

`GET/POST /api/savings-goals`, `GET/PATCH/DELETE /api/savings-goals/:id`. Session cookie, same as the rest of `/api`. Another user's id is `404`. Deleting the account deletes that user's `savings_goals` only.

## Donations ledger

Table: `donations`. One row per gift for the signed-in user. Amounts are **NZD**. Dates are calendar dates. This ledger is **not** a receipt and it is **not** a `transactions` row. Charity receipt files stay on `transactions.receipt_path` under `data/uploads/receipts/`.

| Stored | API field | Notes |
|--------|-----------|--------|
| `date` | `date` | `YYYY-MM-DD`. Required |
| `recipient` | `recipient` | Charity or other recipient. Required |
| `amount_nzd` | `amountNzd` | NZD, greater than 0 after rounding to cents |
| `notes` | `notes` | Optional |
| `evidence_url` | `evidenceUrl` | Optional `http` or `https` link to supporting evidence. Not a stored file |
| `receipt_transaction_id` | `receiptTransactionId` | Optional. A transaction **this user** already attached a receipt to. Null clears it |

`receiptPath` and `receiptUrl` are read from that transaction. They are not copied into `donations`. Deleting the transaction clears the pointer and leaves the donation. Deleting the donation leaves the transaction and its receipt file.

The NZ tax year is counted on read. It runs from **1 April through 31 March** and is labelled by the year it ends. The 2027 tax year is `2026-04-01` through `2027-03-31`. A date in April–December belongs to the tax year ending the next 31 March. A date in January–March belongs to the tax year ending that 31 March.

`GET /api/donations/summary` totals the signed-in user's donations. `?taxYear=2027` selects that year; omitting it selects the tax year that contains today in Pacific/Auckland.

| Response field | Formula |
|----------------|---------|
| `totalAmountNzd` | Sum of `amountNzd` for donations in the tax year, in cents |
| `eligibleAmountNzd` | Sum of those donations whose `amountNzd` is **at least 5**. Gifts under $5 are not added together to reach $5 |
| `belowMinimumAmountNzd` | Sum of donations under $5 |
| `estimatedTaxCreditNzd` | `eligibleAmountNzd / 3`, rounded to the nearest cent. **An estimate** (`estimateLabel` is `"estimate"`) |

The one-third is taken **once** on the summed eligible amount. Two gifts of $5 are $10 eligible, and the estimate is **3.33 NZD**, not 1.67 + 1.67.

This is the standard IRD donation tax credit: **33.33 cents per dollar** of donations of $5 or more, claimed after year-end (IR526) with receipts. IRD also caps the credit at **one third of taxable income**. Taxable income is not stored here, so `incomeCapApplied` is **false** and the cap is not applied. Payroll giving is already credited each pay and is not part of this estimate. Approved-donee status is not checked, and the estimate does not require `evidenceUrl` or `receiptTransactionId`. The full wording is returned as `estimateNote`.

`GET/POST /api/donations`, `GET /api/donations/summary`, `GET/PATCH/DELETE /api/donations/:id`. Session cookie `pt_sid`, same gate as the rest of `/api`. Another user's id is `404`. Deleting the account deletes that user's `donations` only.
## Crypto wallets (`wallets`)

Read-only, per-user (`user_id`) public wallet addresses. **Never** stores seed phrases, private keys or passwords, and has **no balance column** — balances come from chain providers at sync time, never stored as source of truth.

| Field | Notes |
|-------|-------|
| `name` | ≤ 80 chars; defaults to "<Network> wallet" |
| `network` | `ethereum` \| `polygon` \| `base` \| `arbitrum` \| `bitcoin` \| `solana` |
| `address` | Validated + normalised per network (see below). Unique per `(user_id, network, address)` |
| `status` / `status_message` | `connected` \| `syncing` \| `error` — owned by the sync job; reset to `connected` when the address changes |
| `last_synced` | ISO timestamp set by the sync job; null until first sync (cleared when the address changes) |

**Address validation** (`server/lib/walletAddress.ts`): EVM — `0x` + 40 hex, mixed case must match EIP-55 (stored checksummed); Bitcoin mainnet — base58check P2PKH/P2SH or bech32 (v0) / bech32m (v1+, taproot), stored lowercase; Solana — base58 decoding to 32 bytes.

**Secret rejection:** `address` and `name` are checked first for BIP39-style phrases (any language; in `name` only an exact 12/15/18/21/24 single-case word list counts, so descriptive names pass), 64-hex keys, WIF, `xprv`/`Zprv`-family keys, and Solana secret keys (base58 seed+pubkey pair verified via Ed25519, or a JSON byte array). Rejected with `400 { code: "SECRET_REJECTED" }` and a "never share this" message; the input is never echoed, logged or stored.

APIs: `GET /api/wallets`, `GET /api/wallets/:id`, `POST /api/wallets` `{ network, address, name? }`, `PATCH /api/wallets/:id` `{ name?, network?, address? }`, `DELETE /api/wallets/:id`. Error codes: `INVALID_NETWORK`, `INVALID_ADDRESS`, `INVALID_NAME`, `SECRET_REJECTED`, `CUSTODIAL_ADDRESS`, `DUPLICATE_WALLET` (409). Tests: `npm run test:wallets`.

**Custodial denylist** (KAN-69, `server/lib/custodialDenylist.ts`): add and address edits reject known exchange / custodian hot wallets (`CUSTODIAL_ADDRESS`, message names the custodian and points to a manual crypto holding), since a pooled wallet's balance isn't the user's. The list is data, not code: `server/lib/custodialAddresses.json`, regenerated by `npm run denylist:update` from Binance's published proof-of-reserves addresses plus hand-checked entries in `custodialAddresses.manual.json` (review the diff, then commit). Entries are keyed by address family, so one EVM entry covers Ethereum, Polygon, Base and Arbitrum; every entry must pass the same validators as Add Wallet or loading fails. Addresses only. Per-user deposit addresses (Nexo, GoMining, exchanges) can't be listed: Add Wallet asks "Where is this crypto?" first and sends "An exchange or app" to the manual crypto form, and a synced wallet holding nothing shows a dismissible warning (Keep wallet is remembered per browser).

### Wallet sync (`server/chain/sync.ts`)

A scheduler (started with the API; `WALLET_SYNC_DISABLED=1` turns it off) checks every minute for due wallets (`next_sync_at` null or past, up to 10 per pass, one at a time) and syncs each through the chain service. Success → `status=connected`, `status_message` null, `last_synced` = fetch time, `sync_failures` 0, next sync after `WALLET_SYNC_INTERVAL_MIN` (default 30). Failure → `status=error` with a user-safe, redacted `status_message`; provider errors back off exponentially (2 min doubling, ±20% jitter, max 6 h, never shorter than `Retry-After`); unsupported / misconfigured networks retry after 6 h. A provider rate limit also opens a per-network window: other wallets on that network are deferred (not counted as failures). Calls to one network are spaced by `WALLET_SYNC_MIN_GAP_MS` (default 1500). Rows stuck in `syncing` > 10 min (restart) are picked up again; results are discarded if the wallet's address changed mid-sync. New wallets (and address edits) sync once in the background immediately. Balances are never persisted — fresh ones prime the 60 s valuation cache.

`POST /api/wallets/:id/sync` (Sync now): 200 `{ synced, wallet }` when it ran (an error status explains a failed sync); 429 `SYNC_COOLDOWN` within 30 s of the last sync, or `RATE_LIMITED` during a provider window, with `Retry-After`.

### Chain providers (`server/chain/`)

Balances and transactions come from chain adapters, never from the `wallets` table. Portfolio / sync code calls only `fetchWalletBalances` / `fetchWalletTransactions` (`server/chain/service.ts`); it looks up the registered `ChainProvider` whose `supports(network)` is true and passes it the resolved endpoint. Adding a network = `WALLET_NETWORKS` entry + `NETWORK_CHAIN_INFO` (native asset, EVM chain id) + public default URL + an adapter that supports it — no aggregation change. Adapters register in `server/chain/index.ts` (KAN-35 Bitcoin, KAN-36/37 EVM, KAN-38 Solana).

Amounts are smallest-unit integer strings (`amountRaw`) + `decimals`; `formatUnits` converts without float rounding.

Endpoints come from env (`CHAIN_<NETWORK>_RPC_URL`, optional `CHAIN_<NETWORK>_API_KEY`), https only (http for loopback), falling back to public keyless endpoints. Keys stay server-side: requests refuse redirects, every failure is a `ChainProviderError` (`unsupported_network`, `not_configured`, `rate_limited` + `retryAfterSec`, `timeout`, `upstream_error`, `network_error`) whose message passes through `redactChainSecrets`, and the only client view is `GET /api/wallets/networks` (labels, native symbol, `syncable` / `configured` booleans — no URLs or hosts). Tests: `npm run test:chain`.

**Bitcoin adapter** (`server/chain/bitcoin.ts`, provider `bitcoin-esplora`): Esplora REST (`CHAIN_BITCOIN_RPC_URL`, default blockstream.info; mempool.space or a self-hosted Esplora also work). Balance is **confirmed only** (`chain_stats` funded − spent). History is newest-first: unconfirmed txs on the first page only, then confirmed txs; the cursor is the last confirmed txid. Each tx is from the wallet's view — `in` (amount received), `out` (amount that left, excluding change and the fee; fee in `feeRaw` when the wallet funded every input), `self` (amount 0, fee only); coinjoin-style partial funding reports the net change with `feeRaw` null. xpub watching (stretch) is not implemented. `CHAIN_LIVE=1 npm run test:chain` adds checks against the public endpoint.

**NZD valuation** (`server/chain/valuation.ts`): live chain balances × the crypto quote engine (`server/quotes/crypto.ts` — CoinGecko NZD, else CoinGecko/Coinbase/Kraken USD × USD→NZD FX; 10-min memory cache, `price_quotes` persistence, last-good reuse ≤ 24 h; never invented). Each item returns `status` (`priced` \| `stale` \| `unpriced`), `priceNzd`, `valueNzd` (cents), `pricedAt` (when the unit price was observed) and `priceSource`. Prices older than 30 min are still used but flagged `stale`. **Totals only include priced/stale items** and report `complete: false` when a non-zero holding is unpriced or a wallet fetch failed (that wallet is returned with its error code and excluded). Tokens (ERC-20/SPL) stay unpriced until KAN-39 maps contracts → assets, so spam tokens can't inflate totals. Balances are cached in memory for 60 s only — never persisted. APIs: `GET /api/wallets/valuation` (per wallet + combined `totalNzd`, `complete`, `pricedAt`, `failedWallets`), `GET /api/wallets/:id/valuation`. Balances are read from what the sync job last fetched (memory cache up to 35 min); a network inside a provider rate-limit window is never fetched on page load.

**Net worth** (KAN-42, `server/lib/netWorth.ts`): `cryptoNzd` = manual crypto holdings (`cryptoHoldingsNzd`) + wallets (`cryptoWalletsNzd`, null with no wallets), so wallets count toward Total Assets, Net Worth, the allocation charts, Portfolio's total, snapshots (one `wallet:<id>` crypto line each) and projections. Wallets are valued with the same sync-cached balances × crypto quotes as `/api/wallets/valuation`; a wallet that can't be valued is left out (`cryptoWalletsFailed`, `cryptoWalletsComplete: false`) and tokens stay unpriced, so spam tokens add 0. `cryptoPctOfNetWorth` (1 dp) is null with no crypto or when net worth ≤ 0; the Dashboard Crypto card shows it with the wallet count. Manual lines and wallets for the same coins would double count — Portfolio says so when both exist. Tests: `npm run test:net-worth-crypto`.

**Portfolio → Crypto** shows each wallet as a card in the crypto holding-card grid, titled by its short address (full address on hover) with name · network, holdings, NZD value, unit price, last synced, status/error, Sync now and Remove; the section header shows the **Wallets total** (wallet values only) and notes wallets that couldn't be valued.

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
| Metal spot | `METAL:*:oz_t` | Live NZD/oz t from gold-api.com, or Metals.Dev when `METALS_API_KEY` is set |
| GoMining | `GOMINING:*` | Primary generative USD/TH × BTC FX → NZD (stub if API down) |
| Equity | `STOCK:*` | Yahoo Finance live × Frankfurter/BTC FX → NZD |
| Stone comps | `STONE:*` | `not_applicable` until search comps |

## Net-worth buckets

Cash + stocks (cost) + crypto (cost) + **GoMining miners** (est. value or cost) + art + **metals** (spot NZD when quotes exist, else cost) + stones (**known only**) + **forex** (Frankfurter → NZD) + **KiwiSaver** (Sharesies Akahu + bank-held manual/CSV).

Timezone for display: **Pacific/Auckland**. Currency default: **NZD**.

## Forward projections

`GET /api/projections` projects the signed-in user's net worth and savings. Same session cookie as the rest of `/api`. Signed out: `401` `{ error: "Authentication required", code: "UNAUTHORIZED" }`. Every read is filtered by `user_id`.

Query parameters (all optional):

| Param | Default | Bounds |
|-------|---------|--------|
| `months` | 12 | whole number 1–360. 12, 60, and 120 are one, five, and ten years |
| `savingWindowMonths` | 3 | whole number 1–24 |
| `annualReturnPercent` | 0 | number from -50 to 50. `5` means 5% a year |
| `monthlySavingNzd` | observed, or null | number from -10000000 to 10000000, rounded to cents |

Out of range is `400` `{ error }`. Amounts in the body are **NZD**, rounded to cents. Dates are **YYYY-MM-DD** in **Pacific/Auckland**. Month 0 is today. Later points are the same calendar day, clamped to the last day of the month (31 January → 28 February, or 29 in a leap year). `points` has `months + 1` entries.

The starting balances come from the same net-worth computation as `GET /api/net-worth` (`server/lib/netWorth.ts`). Debt steps use `advanceDebtOneMonth` in `server/debts/model.ts`, which is the month inside `projectPayoff`.

**Compounding assets** are the known asset total minus signed bank-account liabilities (credit and loan). That includes cash, holdings at the value net worth already uses, gross property value, and the KiwiSaver balance. Those balances compound together. Bank liabilities and property mortgages stay at the recorded amount because the account and the holding do not store a rate or a payment.

**Each month, in order:**

1. `compoundingAssets = round(compoundingAssets × (1 + annualReturnPercent / 100 / 12))`
2. Add `monthlySavingNzd` when that amount is known.
3. Add the observed KiwiSaver contribution when activity rows exist.
4. For each debt that can be stepped: add scheduled interest, then subtract `actualPaymentNzd`. Monthly interest is `balance × rate / 100 / 12` at the start of every projected month. Yearly interest is `balance × rate / 100` on projected months 1, 13, 25, and so on. A payment that covers the balance clears it. A debt with no saved payment, or with recurring interest but no usable rate, is held. A payment that does not cover interest is still stepped, so the balance can rise; `paysDown` is false.

**Net worth** at each point:

`compoundingAssets + bankLiabilities − debtOutstanding − propertyMortgage`

**Monthly saving** when `monthlySavingNzd` is omitted:

`(income − spending) / savingWindowMonths`

over the complete calendar months before today. Income and spending match the home snapshot (`income_records` plus unlinked income-category credits, minus spending-category outflows and unlinked debt repayments). A month with no rows counts as zero in the divisor. If every month in the window is empty, `monthlySavingNzd.value` is **null** and `savings.points` is **null**. No amount is filled in, and that null saving is not added to assets.

Debt repayments are already inside spending. The projection does not subtract the payment from assets a second time when the debt balance falls.

**KiwiSaver.** The balance is inside compounding assets, so it grows at the same assumed return. `kiwisaver_activity` amounts in the window are averaged over the window length and added on top each month. If there are no rows, the contribution is **null**. `users.preferences_json.kiwiSaverEmployeeRatePct` is a percent and is not turned into dollars.

**Dividends.** Cash already recorded as income is inside the saving figure. No future dividend amount is added.

**Savings goals** are not an input. They are targets, not a cashflow history.

**Inflation** is not applied. `assumptions.inflationPercent.value` is null.

`assumptions.*.source` is `user_data`, `default`, or `query`. `default` on the annual return means 0% because no rate was supplied and none is taken from prices. `query` means the caller passed `annualReturnPercent` or `monthlySavingNzd`. The response `note` says this is an educational projection, not a price forecast.

`npm run test:projections`.

## Economic cycle (country macro, not per-user)

Educational phase classification for New Zealand. These tables have no `user_id`. The phase is calculated from indicators; it is not stored as a manual setting.

| Entity | Purpose |
|--------|---------|
| `economic_indicators` | One observation per country, indicator, period, and provider. Includes value, previous value, source, source URL, published date, period, and retrieved date. |
| `economic_cycle_assessments` | Calculated phase, score, confidence, momentum, and previous phase for a quarter. `is_current` marks the latest quarter. |
| `economic_indicator_scores` | Per-indicator score, direction, and contribution for the current assessment. |
| `economic_fetch_log` | Last fetch time and outcome for a provider and country, so a cached extract is not described as a fresh download. |

The default provider reads public Stats NZ and OECD extracts. `ECONOMY_PROVIDER=sample` switches to a labelled fixture that is not presented as official current data. Scoring weights live in `server/economy/weights.ts`. See [APPROACH.md](../APPROACH.md).

See also: [METALS.md](./METALS.md), [GOMINING.md](./GOMINING.md), [SHARESIES_KIWISAVER.md](./SHARESIES_KIWISAVER.md), [IMPORT_FORMATS.md](./IMPORT_FORMATS.md).
