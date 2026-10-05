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

## Branch / release flow

NZ personal finance / portfolio tracker (Akahu).

- **alpha** — feature and testing branch
- **main** — production
- Promote **alpha → main** via PR after GitHub Actions CI (lint / typecheck / test / build) passes
- Deploy-from-main is a gated stub until hosting secrets are configured (see .github/workflows/)
