# Portfolio Tracker (NZD)

Local-first budgeting + portfolio tracker for **Nathan McCormick** (New Zealand, **Pacific/Auckland**).

Default currency **NZD**. Local email/password auth (httpOnly session cookie). Data stays on disk under `data/portfolio.db`. See `docs/AUTH.md`.

## Quick start

```bash
cd /workspace/portfolio-tracker
npm install
npm run dev
```

- Web UI: http://127.0.0.1:3000  
- API: http://127.0.0.1:8787 (proxied as `/api` from Vite)

Other scripts:

| Script | Purpose |
|--------|---------|
| `npm run dev:web` | Vite only |
| `npm run dev:api` | Express + sql.js API only |
| `npm run build` | Typecheck + production build |
| `npm run db:init` | Ensure empty DB/schema + seed categories |

## Hosted deploy (Week 2)

**Railway** (Docker) — see **[docs/DEPLOY.md](./docs/DEPLOY.md)** for volume, secrets, HTTPS cookies, and SQLite backup/restore (`npm run db:backup` / `db:restore`).

Production: `npm run build && npm run start` (serves `dist/` + API; `HOST=0.0.0.0`, Secure cookies when `COOKIE_SECURE=true`).

## Stack

- **Vite + React + TypeScript** frontend  
- **Express** local API  
- **sql.js** (WASM SQLite) — no native `better-sqlite3` build required  
- **react-router-dom** for views  

## Project layout

```
/workspace/portfolio-tracker
├── README.md
├── docs/DATA_MODEL.md          # entities & relationships
├── docs/PAYE_RATES.md          # IRD rate sources for /paye
├── data/portfolio.db           # created on first API start
├── server/
│   ├── index.ts                # API entry (:8787)
│   ├── db/schema.sql           # persistence schema
│   ├── db/index.ts             # sql.js init + seed
│   ├── quotes/providers.ts     # stub QuoteProviders
│   └── routes/                 # holdings, accounts, budgets, kiwisaver, summary
├── src/
│   ├── types/index.ts          # shared domain types
│   ├── api/client.ts
│   ├── components/Layout.tsx
│   ├── pages/                  # Dashboard, Spending, Portfolio, KiwiSaver, ValueSearch
│   ├── App.tsx
│   └── main.tsx
└── package.json
```

## What’s implemented vs stubbed

### Implemented

- App scaffold: net-worth dashboard, spending, portfolio, KiwiSaver, **PAYE calculator**, value-search shells  
- SQLite schema + empty DB seed (budget categories, NZD settings)  
- CRUD-ish API for holdings (incl. **GoMining digital miners**), accounts, budgets, KiwiSaver  
- Manual stock/crypto add **merges** into an existing non-Akahu holding with the same ticker (add shares/amount; weighted total cost basis NZD)  
- Manual GoMining miner form (hashrate TH/s, rarity, level, cost, optional est. value)  
- Net-worth aggregation (cost basis / manual estimates)  
- KiwiSaver: Sharesies via Akahu + bank-held manual form/CSV (honest Manual vs Akahu labels)  
- **Akahu sync** for Sharesies/Hatch stocks, Sharesies crypto, KiwiSaver fund mix  
- **Equity live quotes** (Yahoo Finance × Frankfurter/BTC FX → NZD) for Value Search + manual Portfolio stocks  
- Docs: this README + `docs/DATA_MODEL.md`
- **Economic cycle** (educational): calculated phase for New Zealand (default) or the United States, from public Stats NZ, Census, and OECD extracts, with indicator cards, housing activity, and historical asset-class context. `npm run test:economy`
- **Dividends** (personal record, not advice): payments on your own stock/ETF holdings, with NZD totals, yield, and a forecast taken only from amounts you entered. Shown under Portfolio and Budget. `npm run test:dividends`
- **Savings goals** (API): a name, NZD target, current amount, and optional deadline. Required weekly and monthly saving, percent complete, and estimated completion are counted from those figures. Not added to net worth. `npm run test:savings-goals`
- **Donations ledger** (API): date, recipient, NZD amount, notes, and an optional evidence link. Kept separate from charity receipt files. A donation may point at a transaction that already has a receipt. Tax-year totals (1 April–31 March) include an estimated donation tax credit of one third of gifts of $5 or more, without the taxable-income cap. `npm run test:donations`
- **Projections** (API): `GET /api/projections` extends the signed-in user's net worth and observed monthly saving (income minus spending) over a chosen number of months. Assets compound at a supplied annual return, or at a labelled 0% when none is supplied. Debts step with their saved rate and payment. Missing cashflow stays null. `npm run test:projections`
- **Portfolio news**: headlines for the signed-in user's holdings (Google News) plus BBC world and politics. Public RSS, so no API key. Shown as **News** in the nav, next to Portfolio. `npm run test:news`

### Stubbed (clear interfaces — never invent prices)

- Kraken provider stub for generic asset keys (crypto spot uses CoinGecko → Coinbase → Kraken public APIs)  
- GoMining marketplace refresh (primary generative + EE extrapolation for out-of-band)  
- Precious stone comps (value-search placeholder)  
- Sharesies CSV column mapping (import endpoint accepts paste but does not invent balances)  
- Bank CSV import / transaction categorisation UI  

### Live (opt-in key)

- **Metal spot → NZD** via [gold-api.com](https://api.gold-api.com/price/XAU/NZD) with no key; [Metals.Dev](https://metals.dev/) only when `METALS_API_KEY` is set — see [docs/METALS.md](./docs/METALS.md)

## Asset coverage

| Asset | Status |
|-------|--------|
| Bank accounts & transactions | Schema + API; UI shell |
| Budgets / categories | Seeded categories; budget API |
| Stocks | Live Yahoo NZD quotes + Akahu sync + history charts |
| Crypto | Schema; GMT token as crypto line OK |
| **GoMining digital miners** | First-class `gomining_miner`; add form + refresh stub |
| Art (Masterworks-style) | Schema |
| Gold / silver / platinum / palladium | Live NZD spot via gold-api.com (no key); Metals.Dev if keyed |
| Precious stones | Schema; **no invented vals** |
| **Forex** (Revolut USD/EUR/GBP etc.) | Manual holdings · Frankfurter → NZD · delete supported |
| **KiwiSaver** | Sharesies via Akahu; bank-held manual form + CSV (IRD/Akahu bank KS N/A) |


## Akahu sync (banks / Sharesies / Hatch / KiwiSaver)

Live sync uses the **Akahu** API. Tokens stay on the Express server — never in the browser or git.
Full how-to (institutions, Personal vs Full App, OAuth Connect): **[docs/AKAHU_CONNECT.md](./docs/AKAHU_CONNECT.md)**.

### Configure credentials

**On this box:** `AKAHU_APP_ID` and `AKAHU_USER_TOKEN` are already in the environment (Personal App / shared token).

**On a Windows workstation:** create a `.env` in the project root (gitignored) — see `.env.example`:

```env
AKAHU_APP_ID=your_app_id
AKAHU_USER_TOKEN=your_user_token
# Optional Full App OAuth (per-user Connect):
# AKAHU_APP_SECRET=
# AKAHU_REDIRECT_URI=http://127.0.0.1:3000/api/akahu/callback
# AKAHU_FRONTEND_URL=http://127.0.0.1:3000
```

Then:

```bash
npm install
npm run dev
```

- **Connect:** Settings → **Connect accounts** (OAuth when Full App secret is set; otherwise use my.akahu.nz + shared token).
- **Sync:** Portfolio / Dashboard / KiwiSaver / Spending buttons, or Settings → Sync now.
- API: `GET /api/akahu/status`, `POST /api/akahu/connect`, `POST /api/akahu/sync`, …

**Multi-user:** Personal App = one shared `AKAHU_USER_TOKEN` for the whole local DB. Per-user tokens need Full App OAuth (`akahu_connections` table).

Do **not** commit `.env`. Non-NZD Akahu market values are converted to **NZD** with live FX:
- Primary: [Frankfurter](https://www.frankfurter.app/docs/) (`api.frankfurter.dev`)
- USD fallback: existing BTC FX path (CoinGecko / Coinbase → USD→NZD ratio)
Never invent rates — if FX fails, Value stays **—**.

Cost basis: taken from Akahu (`cost_basis` / average × shares / `value − returns`) and FX’d to NZD when present; otherwise **blank (—)**, never fake $0.

Portfolio → **Refresh stock values** (or per-card Refresh) re-runs Akahu sync + FX.

## Crypto quotes (NZD)

Order for live unit prices (never invented):

1. Fresh in-memory / `price_quotes` cache  
2. [CoinGecko](https://docs.coingecko.com/reference/simple-price) `simple/price` (USD+NZD)  
3. On fail / HTTP 429 → [Coinbase](https://docs.cloud.coinbase.com/sign-in-with-coinbase/docs/api-prices) public `{SYMBOL}-USD` spot  
4. Then [Kraken](https://docs.kraken.com/api/docs/rest-api/get-ticker-information) public USD ticker  
5. USD→NZD via Frankfurter (or existing BTC FX ratio fallback)

**CRO / Cronos** maps to CoinGecko `crypto-com-chain` and spot product `CRO-USD`. Holding icons cascade **CoinGecko image → cryptocurrency-icons CDN by ticker → letter avatar** (`onError`); CRO uses the CoinGecko Cronos logo because it is absent from the CDN set. Ambiguous symbols (e.g. GoMining `GMT` vs STEPN on Coinbase) skip public-spot fallbacks rather than risk a wrong price. History charts use CoinGecko `market_chart`; on failure, a single live-spot point is returned when available.

## Security / privacy

- Do **not** ask for or store bank or Sharesies passwords  
- Do **not** scrape Sharesies; prefer official export/API when available  
- Quote providers must return `stubbed` / `unavailable` rather than fake numbers  

## Related research docs (sibling)

- [`docs/DATA_MODEL.md`](docs/DATA_MODEL.md) — entities & relationships  
- [`docs/GOMINING.md`](docs/GOMINING.md) — GoMining miners vs GMT token  
- [`docs/SHARESIES_KIWISAVER.md`](docs/SHARESIES_KIWISAVER.md) — official export/API notes  
- [`docs/IMPORT_FORMATS.md`](docs/IMPORT_FORMATS.md) — CSV/OFX stubs  
- [`docs/KIWIBANK_PLAN.md`](docs/KIWIBANK_PLAN.md) · [`docs/GOOGLE_PAY_WALLET.md`](docs/GOOGLE_PAY_WALLET.md)

## Licence

Private / local use.

## Forex (outside bank → NZD)

Track foreign cash held **outside** NZ bank accounts (e.g. Revolut USD/EUR/GBP). Not for NZD — use bank accounts for that.

1. Portfolio → **Add holdings** → **Add forex** (currency, amount, source e.g. Revolut, optional cost NZD)
2. Value = amount × live [Frankfurter](https://www.frankfurter.app/docs/) rate → NZD (USD fallback: BTC FX ratio). Never invent rates — Value stays **—** if FX fails.
3. **Refresh FX rates** / per-card **Refresh value** re-fetches Frankfurter.
4. Included in Dashboard net worth under **Forex**. Delete supported on cards.

## Metals spot (NZD)

Live gold / silver / platinum / palladium in **NZD per troy ounce** from gold-api.com. No API key.

Portfolio → metal card → **Refresh value**, or Value search → **Refresh metal quotes**.

`METALS_API_KEY` is optional. When it is set, spots come from Metals.Dev instead. Without a usable NZD price, market value stays **—** / cost only — never invented.

Details: [docs/METALS.md](./docs/METALS.md)

## Billing

Paid plans are sold through Stripe in NZD, GST included. Settings → Account → Plan offers:

| Plan | Monthly | Yearly | Lookup keys |
|------|---------|--------|-------------|
| Plus | NZ$9.99 | NZ$79.99 | `koruledger_plus_monthly`, `koruledger_plus_yearly` |
| Pro | NZ$19.99 | NZ$149.99 | `koruledger_pro_monthly`, `koruledger_pro_yearly` |
| Business | NZ$29.99 | NZ$249.99 | `koruledger_business_monthly`, `koruledger_business_yearly` |

`npm run stripe:setup` creates the Plus, Pro and Business products and prices, and a cancel-only Customer Portal configuration for Business (safe to re-run). `npm run stripe:setup -- --gst` also creates an inclusive 15% GST rate. A `sk_live_` or `rk_live_` key is refused unless `STRIPE_LIVE_ENABLED=1`. Re-run `npm run stripe:setup` with the test key after pulling this so the Business portal configuration exists. Optionally pin its id with `STRIPE_PORTAL_CONFIG_BUSINESS`.

`POST /api/billing/checkout` starts Checkout for `plus`, `pro` or `business` (monthly or yearly). While `PRO_PLAN_ENABLED` is unset, `pro` is refused with `PRO_UNAVAILABLE`. A Personal account (`usageMode` missing or `personal`) is refused `business` with `BUSINESS_PLAN_REQUIRES_BUSINESS_ACCOUNT`. Business only and Both can check out Business. Plus is offered for every account type; Pro is not hidden by account type. The webhook at `POST /api/billing/webhook` fetches the subscription from Stripe and saves it. A `customer.subscription.updated` event that moves a Business subscription onto a different price, or moves another plan onto Business without Checkout for an allowed account, is logged and does not change the granted plan. `GET /api/billing` reports the plan, the subscription and the prices. An `active`, `trialing` or `past_due` Business subscription grants the Business plan used by the business reports (profit & loss, the GST return, the accountant export and accountant access). It does not include Plus or Pro features. `unpaid` and `canceled` drop the paid plan. Opening the portal for a Business subscription uses the cancel-only configuration (cancel and card update, no plan change).

`npm run plan:set` and `PLAN_BUSINESS_EMAILS` still grant Business without a subscription. Deleting an account cancels its Plus, Pro or Business subscription first. A linked business account is billed on its own customer; deleting the personal account does not cancel that subscription (see below). Variables are in `.env.example`. `npm run test:billing`.

## Linked business accounts

A Personal account cannot turn into a Business account, and it still cannot buy the Business plan on itself (`403 BUSINESS_PLAN_REQUIRES_BUSINESS_ACCOUNT`). It can attach a **separate** business user. Account type stays `users.preferences_json.usageMode` (`personal`, `business`, or `both`; missing counts as personal). Each user has its own books, plan, and Stripe customer. `planOf` and the webhook map a subscription by that user's id and Stripe customer, never by the link. NZD prices are unchanged. `STRIPE_LIVE_ENABLED` stays off unless an operator sets it. `npm run test:links`.

**Email on an account created here.** `users.email` is `NOT NULL UNIQUE`, so the row cannot have a blank address. The server stores a synthetic address `linked.<uuid>@accounts.koruledger.invalid`. `.invalid` is a reserved TLD and is not a mailbox. `password_hash` is `!linked-no-login` (not a password hash) until that user sets a password, passkey, or single sign-on. There is no separate email login; it is opened only by switching.

**Session.** `POST /api/account/switch` creates a new session and replaces the `pt_sid` cookie, the same way login does, and deletes the previous session. `sessions.origin_owner_user_id` is the personal owner's id when the new session is a linked business, and null on a normal sign-in or when switching back. Switching does not ask for a password. The link row is what allows it. An audit row with kind `account_switch` is written for both users.

**After a switch, reload user-scoped data.** Bank accounts, holdings, budgets, invoices, businesses, and anything else loaded for the previous user now belong to someone else. A full page load is the safe choice. `GET /api/auth/me` returns `activeAccount` both on `user` and next to `user`, so the client can see which account is active:

```json
{ "id": "<user id>", "usageMode": "business", "isLinkedBusiness": true, "ownerId": "<personal user id or null>" }
```

`ownerId` is null unless this session is a linked business.

**Deleting the personal account** detaches every link and marks those business users for deletion (`preferences_json.pendingDeletion`: `at`, `reason: "owner_account_deleted"`, `formerOwnerUserId`). Their sessions are destroyed and sign-in is refused (`403 ACCOUNT_PENDING_DELETION`). Their books and Stripe customer are **not** deleted in that request, and their subscription is **not** cancelled, so a billing failure on a linked account cannot block the personal deletion. Cancel the business plan on that account first if it should stop being charged. Deleting a linked business user only removes that user's link.

An owner may attach at most 5 business users. A business user belongs to at most one owner. Only a personal or both account that is not itself linked can create or link. A linked business can switch back to its owner.

### `GET /api/account/links`

Auth required.

```json
{
  "current": { "id": "", "displayName": "", "usageMode": "personal", "plan": "free", "isLinkedBusiness": false },
  "owner": null,
  "linked": [
    { "id": "", "displayName": "", "businessName": "", "plan": "free", "hasOwnLogin": false, "canUnlink": false }
  ]
}
```

`owner` is the personal account when the caller is a linked business, otherwise null. `linked` is the business users this caller owns (empty from a linked business). `businessName` is that user's default business, or null. `plan` is `free`, `plus`, `pro`, or `business`. `canUnlink` is true only when the caller is the owner and `hasOwnLogin` is true (password, passkey, or single sign-on).

### `POST /api/account/business`

Body: `{ "businessName": "Koru Honey" }`. Creates a business user with the owner's first and last name, `usageMode` `business`, a starter business of that name, and the free plan. No password.

`201` `{ "account": <linked item>, "links": <GET shape> }`

| Status | Code | When |
|--------|------|------|
| 400 | `INVALID_BUSINESS_NAME` | Missing, blank, or over 120 characters |
| 401 | `UNAUTHORIZED` | Signed out |
| 403 | `NOT_PERSONAL_ACCOUNT` | Caller is business-only |
| 403 | `LINKED_BUSINESS_CANNOT_OWN` | Caller is itself a linked business |
| 409 | `LINK_LIMIT` | Owner already has 5 |

### `POST /api/account/links`

Body: `{ "email": "bee@example.com", "password": "…" }`. Checks the password and rate limit the same way as `POST /api/auth/login` (10 failures per account and 50 per client in 15 minutes). The target must be `usageMode` `business` and not already linked.

`200` `{ "links": <GET shape> }`

| Status | Code | When |
|--------|------|------|
| 400 | `MISSING_FIELDS` | Email or password missing |
| 401 | `INVALID_CREDENTIALS` | Wrong email or password. The personal session stays signed in. |
| 401 | `UNAUTHORIZED` | Signed out |
| 403 | `NOT_PERSONAL_ACCOUNT` | Caller cannot own a link |
| 403 | `LINKED_BUSINESS_CANNOT_OWN` | Caller is itself linked |
| 403 | `NOT_BUSINESS_ACCOUNT` | Password matched an account that is not business-only |
| 403 | `TWO_FACTOR_REQUIRED` | That account has two-factor on. Turn it off, then link. |
| 409 | `CANNOT_LINK_SELF` | Email is the signed-in user |
| 409 | `ALREADY_LINKED` | Already attached to a personal account |
| 409 | `LINK_LIMIT` | Owner already has 5 |
| 409 | `ACCOUNT_PENDING_DELETION` | That user is marked for deletion |
| 429 | `TOO_MANY_ATTEMPTS` | Rate limit. `Retry-After` is set. |

### `DELETE /api/account/links/:linkedUserId`

Only the owner. `200` `{ "ok": true, "links": <GET shape> }`

| Status | Code | When |
|--------|------|------|
| 403 | `NOT_LINK_OWNER` | Caller does not own that link |
| 404 | `NOT_FOUND` | No such link |
| 409 | `LINKED_ACCOUNT_HAS_NO_LOGIN` | Created without a login, and it still has none |

### `POST /api/account/switch`

Body: `{ "accountId": "<owner or linked user id>" }`. Allowed only between an owner and its linked accounts, either way. Not from one linked business straight to another.

`200` `{ "ok": true, "user": <same shape as GET /api/auth/me user>, "activeAccount": <activeAccount> }` plus a new `pt_sid` cookie.

| Status | Code | When |
|--------|------|------|
| 400 | `MISSING_FIELDS` | `accountId` missing |
| 400 | `SAME_ACCOUNT` | Already the active user |
| 401 | `UNAUTHORIZED` | Signed out |
| 403 | `SWITCH_NOT_ALLOWED` | Not an owner/linked pair |
| 403 | `ACCOUNT_PENDING_DELETION` | Target is marked for deletion |

Client helpers in `src/api/client.ts`: `getAccountLinks`, `createLinkedBusiness`, `linkExistingBusiness`, `unlinkAccount`, `switchAccount` (also on `api.accountLinks`). Types live in `src/types/accountLinks.ts`.

## Branch / release flow

NZ personal finance / portfolio tracker (Akahu).

- **alpha** — feature and testing branch
- **main** — production
- Promote **alpha → main** via PR after GitHub Actions CI (lint / typecheck / test / build) passes
- Deploy-from-main is a gated stub until hosting secrets are configured (see .github/workflows/)
