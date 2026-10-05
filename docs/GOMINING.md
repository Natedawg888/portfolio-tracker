# GoMining — digital miner valuation (portfolio)

Research date: **2026-10-01**.  
Scope: track **digital miner** values (hashrate, rarity/level, estimated marketplace value) for net worth. **GOMINING token (GMT/GOMINING) is a separate line.** Never invent prices.

Site: [https://gomining.com/](https://gomining.com/) · Docs: [https://docs.gomining.com/en/about](https://docs.gomining.com/en/about)

Cross-links: [IMPORT_FORMATS.md](./IMPORT_FORMATS.md) · [KIWIBANK_PLAN.md](./KIWIBANK_PLAN.md)

---

## What GoMining is (accurate from public docs)

GoMining positions itself as a Bitcoin “superapp”: **physical hashrate is tokenized into digital miners** so users earn **daily BTC** without operating ASICs. Each digital miner is an NFT-like asset (collections issued by BMINE on ETH / BSC / Solana / TON depending on collection), backed by a share of GoMining’s data-centre hashrate via their LBH-style model.

**Core assets for this tracker:**

| Asset | What it is | Portfolio role |
| --- | --- | --- |
| **Digital miner (NFT)** | Computing power (TH/s) + energy efficiency (W/TH); earns BTC (Mining mode) or game rewards (Miner Wars); tradable | **Primary** — estimate liquidation / replacement value |
| **GOMINING token** | Utility/governance token (maintenance discounts, staking/veGOMINING, marketplace payments). CoinGecko shows rebrand note from symbol GMT → GOMINING | **Separate** liquid crypto line |
| **Wallet BTC / stables** | Virtual wallet balances | Optional cash/crypto lines |

Miner docs: [Miners](https://docs.gomining.com/en/product/miners) · [About miners](https://docs.gomining.com/en/product/miners/about)  
Rarity: driven by visual trait parameters; OpenSea referenced for rarity of modifications ([About miners](https://docs.gomining.com/en/product/miners/about)).

Maintenance/electricity formulas (for income modelling, **not** for inventing mark-to-market) are published on the About miners page and match the in-app panel: kWh **$0.05** (docs also cite $0.05–0.07); service **$0.0089**/TH/day; discount on both electricity and service; Net = PR + GBP − C1 − C2.

---

## What to track per miner (v1)

For each NFT miner Nathan owns, store **user-supplied or account-exported** facts:

| Field | Source of truth |
| --- | --- |
| Name / collection / token id | GoMining app Mining farm / wallet |
| **Hashrate (TH/s)** | App / MCP `get_nfts` / `get_nft_detail` |
| **Energy efficiency (W/TH)** | Same |
| **Rarity** + **upgrade level** | `get_nft_detail` (docs list rarity & upgrade level) |
| Status (Mining / Miner Wars / listed) | App |
| **Estimated value** | See marketplace section — **never fabricate** |
| `asOf` + `valuationSource` | Required on every quote |

Aggregate portfolio metric sketches (computed, not invented prices):

- Total hashrate Σ TH/s  
- Value in GOMINING tokens if using marketplace comps × GOMINING/USD (or NZD) from a cited feed  
- Optional: income estimate using published formulas + live BTC — label as **model**, not market price

---

## Marketplace / miner valuation sources

### Official marketplace (peer-to-peer)

- Docs: [Marketplace](https://docs.gomining.com/en/product/miners/marketplace)  
- Secondary marketplace FAQ: browse listings, Hot deals / Auction filters; logged-in users can see prices; buy requires KYC L1 + at least one active miner ([help.nft.gomining.com secondary marketplace](https://help.nft.gomining.com/faq/marketplace/secondary-marketplace)).  
- Payments in **GOMINING tokens**; **5% marketplace fee** on sell ([Academy — how to sell](https://academy.gomining.com/articles/how-to-sell-your-digital-miner)).  
- Listing modes: **fixed price** or **step-down auction** ([Step-Down Auction](https://docs.gomining.com/en/product/miners/marketplace/step-down-auction)).  
- App can suggest linking price to **market average for same power & efficiency** (fair price of similar new miner) — still a market quote, not something we invent.

**Valuation approaches that are honest for v1:**

1. **Manual mark** — Nathan pastes last listing / offer / “market average” shown in-app for comparable TH + efficiency.  
2. **Comps** — observe secondary listings (price ÷ TH ≈ price per TH); apply only with citation + timestamp.  
3. **Primary/collection pricing** — MCP tool `get_marketplace_pricing` returns collection price, total hashrate, **price per TH**, ROI multiplier, sale status (authenticated MCP — see below).  
4. **Do not** use theorised NPV of future BTC rewards as a silent “price” without labelling it a model and citing BTC + fee inputs.

### GoMining MCP Server (account-scoped, read-only)

- URL: `https://mcp.gomining.com/mcp`  
- Docs: [GoMining MCP Server](https://docs.gomining.com/en/product/ai/mcp-server)  
- **Read-only** tools after user OAuth/consent to an AI client. **Not** a documented public anonymous REST API for third-party production apps.  
- Miner-relevant tools:
  - `get_nfts` — name, hashrate, efficiency, status  
  - `get_nft_detail` — hashrate, efficiency, **current price**, ROI/payback, daily/total income, **rarity**, **upgrade level**  
  - `get_marketplace_pricing` — official marketplace collection pricing + **price per TH**  
  - `search_secondary_marketplace` — peer listings with filters (currency, hashrate, price, collection)  
  - `get_ticker_prices` — BTC, ETH, GMT, fiat  
  - `get_virtual_wallet_balances` — includes GMT/BTC/etc.

**For this portfolio tracker:** treat MCP as a **Nathan-operated personal data path** (export numbers into the app), not as an embedded unofficial scrape. There is **no** published keyless HTTP “list my miners” API for arbitrary backends found in public docs as of 2026-10-01.

### On-chain / OpenSea

Miners can live in external wallets and be sold on public NFT marketplaces ([About miners](https://docs.gomining.com/en/product/miners/about)). Floor prices vary by collection/network — only use if a specific listing/floor is cited; collections differ.

---

## GOMINING token price (separate line)

| Source | Detail |
| --- | --- |
| CoinGecko page | [coingecko.com/en/coins/gomining-token](https://www.coingecko.com/en/coins/gomining-token) |
| CoinGecko **API id** | Search API returns id **`gmt-token`**, symbol **`gomining`**, name GoMining Token (verified 2026-10-01 via `/api/v3/search?query=gomining`). Website slug `gomining-token` ≠ API id — **use `gmt-token`**. |
| Public price call (keyless, rate-limited) | `GET https://api.coingecko.com/api/v3/simple/price?ids=gmt-token&vs_currencies=usd,nzd` ([Keyless Public API](https://docs.coingecko.com/docs/keyless-public-api), [simple/price](https://docs.coingecko.com/reference/simple-price)) |
| Exchanges | CoinGecko lists CEX pairs (e.g. GOMINING/USDT); Kraken lists GOMINING/USD — useful if wiring Kraken MCP later |

Token utility summary from CoinGecko/project copy: maintenance fee discounts (up to ~20%), burn mechanics, governance — cite CoinGecko/GoMining docs; do not invent APY.

**MCP** `get_ticker_prices` can also return GMT alongside fiat — still requires Nathan’s MCP login.

---

## Official / public API vs must stay manual

| Data | Public / automated? | v1 approach |
| --- | --- | --- |
| GOMINING token USD/NZD | **Yes** — CoinGecko `gmt-token` (rate limits apply) | Auto-refresh quote; status `ok`/`stale`/`unavailable` |
| BTC (for income models) | **Yes** — CoinGecko `bitcoin` | Optional model input only |
| Nathan’s miner list (TH, efficiency, rarity, level) | **No** public unauthenticated API | **Manual entry** or paste from app / MCP session export |
| Miner “current price” / ROI from GoMining | MCP `get_nft_detail` (authenticated) | Manual copy or future personal integration after consent |
| Secondary market comps | Browse marketplace / MCP `search_secondary_marketplace` (auth) | Manual comps or MCP; not keyless |
| Primary generative USD/TH | **Yes** — `GET …/nft-collection/find-all-generative` | Auto mark: TH × (priceUsdt/power) × BTC FX → NZD |
| Wallet GMT/BTC balances | App or MCP wallet tools | Manual or MCP-assisted |

---

## Recommended v1 approach

1. **Holding type:** extend portfolio with a `gomining_miner` (or reuse a generic NFT/miner holding) storing hashrate, efficiency, rarity, upgrade level, cost basis NZD, and **nullable** `valuationNzd` / `valuationGmt` + `valuationSource` + `asOf`.  
2. **Token line:** `GOMINING` crypto holding; refresh via CoinGecko `gmt-token` only when the HTTP call succeeds — otherwise mark quote `unavailable` (never invent).  
3. **Miner value:** **auto** from public primary generative collections (`nft-collection/find-all-generative`): match EE + closest power tier → `usdPerTh = priceUsdt/power` → `NZD = hashrate × usdPerTh × (btcNzd/btcUsd)`. EE outside live 12/15 bands → linear extrapolate usd/TH vs EE from live anchors (`gomining_extrapolated`). Manual override still allowed. Secondary P2P comps remain MCP/manual (no keyless list API).  
4. **Do not** ship silent NPV valuations as market price.  
5. Stubs: `src/imports/gominingManual.ts`, optional `src/api/coingeckoClient.ts` for `gmt-token` + `bitcoin`.

### What’s blocked

- Automated sync of Nathan’s miners without his MCP/app export or a future official app API.  
- Live secondary-market portfolio marks without either manual comps or authenticated marketplace tools.  
- Any price when CoinGecko/MCP returns errors — show `unavailable`.

---

## Security / integrity

- No GoMining passwords in the tracker.  
- MCP OAuth is between Nathan’s AI client and GoMining — do not proxy credentials.  
- Always persist `source` + `asOf` on valuations (`QuoteSource` / notes in `src/types`).


---

## Earnings estimate model (portfolio UI)

Implemented in `src/lib/gominingEarnings.ts` (+ server `gominingIncome.ts`). **Always labeled “estimate”** — never treated as market price.

Official in-app formulas (verified 2026-10-01 against GoMining Reward screenshots):

### Net sat / TH / day

$$
\text{Net sat/TH/day} = \text{PR} + \text{GBP} - \text{C1} - \text{C2}
$$

Example (1 TH @ EE 21.85, discount 6.06%, BTC ≈ 83415.87):

`47.3885 (PR) + 0.0081 (GBP) − 29.5280 (C1) − 10.0228 (C2) = 7.8458 sat`

| Part | Formula (sat/TH/day) | Notes |
| --- | --- | --- |
| **PR** (Pool Reward) | Live `totalIncomePerThToday` ÷ `btcCourseInUsd` × 1e8 | From `POST …/nft-income-aggregation/get-last` — **never invent** |
| **GBP** (GoBTC Pay) | API field when present; else **0** | In-app “GoBTC Pay reward”; product rolling out — note when stubbed |
| **C1** (Electricity) | `(kWh × 24 × EE / BTC_USD / 1000) × 1e8 × (1 − Discount%)` | App kWh **$0.05** (API c1 implies 0.05); EE = W/TH |
| **C2** (Service) | `(0.0089 / BTC_USD) × 1e8 × (1 − Discount%)` | Documented $0.0089 / TH / day |
| **Discount** | Applied to **both C1 and C2** | VIP + Service-button days + solo; user % in app settings |

Portfolio / miner totals = per-TH figures × computing power (TH).

Example: Mine Box 25.734 TH × 7.8458 sat/TH ≈ **+201.90 sat** net/day with the same per-TH inputs.

### Docs cross-refs

- [About miners](https://docs.gomining.com/en/product/miners/about) — Electricity + Service
- [Maintenance fees and discounts](https://docs.gomining.com/en/product/miners/maintenance-fees-and-discounts) — discount stack
- [Rewards](https://docs.gomining.com/en/product/miners/rewards) — daily pool payouts per TH
- [Academy ROI calculator](https://academy.gomining.com/articles/gomining-roi-calculator-2026) — network-share fallback only

### Live feeds (`GET /api/settings/gomining`)

| Field | Source | Role |
| --- | --- | --- |
| `fx` | CoinGecko → Coinbase / Frankfurter | BTC/USD + BTC/NZD display |
| `income` | GoMining `nft-income-aggregation/get-last` | PR (sat/TH), c1/c2, implied kWh, optional GBP |
| `networkHashrate` | mempool.space → blockchain.info | Academy EH/s fallback only |
| `effective` | manual settings ⊕ live | Values the estimate uses |

For C1/C2 BTC conversion the UI prefers: **manual BTC override → GoMining `btcCourseInUsd` → live FX**.  
For kWh: **manual → API-implied (c1×1000/24) → default $0.05**.

### BTC / USD / NZD display

UI toggle: **BTC · USD · NZD · All** on the GoMining miners section.

- Status line: **FX live · …**, **Pool live · N sat/TH**, **GBP=0** (or live GBP when API provides it)
- If feeds fail → **—** + stubbed message (never invent)

### Periods

Daily estimate scaled linearly:

| Period | Multiplier |
| --- | --- |
| Day | ×1 |
| Week | ×7 |
| Month | ×(365.25 / 12) ≈ 30.4375 |
| Year | ×365.25 |

### Editing miners

Each miner card keeps its summary: TH/s, cost, value, return, earnings, the earnings-estimate block, and **Refresh value**. **Edit TH / EE / Est. NZD** opens a center-page popup. Save and Cancel (also the close control, backdrop click, or Escape) close that popup. The popup still `PATCH /api/holdings/:id` with `hashrateThs`, `energyEfficiencyWth`, and optional `estimatedValueNzd`. Blank Est. NZD clears a manual value. The earnings formula is unchanged. The add form still creates new miners.

### Stubs / unavailable

- Missing hashrate → estimate unavailable  
- Missing EE → electricity/C1 stubbed (service still shown)  
- Missing BTC/USD (and no GoMining course) → C1/C2 + net stubbed  
- Missing GoMining pool income **and** network EH/s → PR + net stubbed  
- GBP missing from API → **0** with note (never invent)

### GoMining discount applied (UI)

Editable **%** at the top of the GoMining miners section, persisted via `PATCH /api/settings/gomining`.

**Applies to:** Electricity (C1) **and** Service (C2) inside the earnings estimate.  
**Does not apply to:** `estimated_value_nzd` secondary/marketplace marks.


---

## Estimated secondary / marketplace NZD (implemented)

**Code:** `server/quotes/gominingMarketplace.ts` · refresh via `POST /api/holdings/:id/refresh-value` or `POST /api/holdings/refresh-gomining-values`.

| Step | Detail |
| --- | --- |
| Source | Public `GET https://api.gomining.com/api/nft-collection/find-all-generative` (fallback `gomining.com/api/…`) |
| Live EE bands | **12 and 15 W/TH only** (verified 2026-10-01). No keyless secondary listing API for higher EE (~19–23). |
| Match | (1) EE within ±0.5 of a generative band → closest `power` (TH). (2) EE **strictly between** live bands → linear interpolate `usd/TH` from live lower/upper at closest power. (3) Unknown EE → 15 W/TH band. (4) EE **outside** bands → **linear extrapolate** `usd/TH` vs EE from the two extreme live bands (same line as interpolate, extended) at closest power. |
| USD/TH | `priceUsdt / power` (or interpolated / extrapolated between live band usd/TH). Anchors always live — never hardcode fake $/TH. |
| Extrapolation | Band **median** live `usd/TH` at extreme EE bands → `usdPerTh(ee) = usd₁₂ + (ee − 12)/(15 − 12) × (usd₁₅ − usd₁₂)`. If linear ≤ 0 (very high EE), **log-linear** from the same live medians. NZD = `TH × usdPerTh × (btcNzd/btcUsd)`. Source **`gomining_extrapolated`**; UI: “estimate extrapolated from primary 12/15 W/TH”. |
| NZD | `hashrateThs × usdPerTh × (btcNzd / btcUsd)` using live `fetchBtcFx` |
| Persist | `estimated_value_nzd`, `estimated_value_at`, `estimated_value_source='gomining'` or `'gomining_extrapolated'` |
| Manual | Portfolio miner **Edit TH / EE / Est. NZD** popup → `estimated_value_source='manual'` override still allowed. |
| UI | Portfolio cards Value + Return; “Refresh marketplace values” applies to **all** miners (exact + extrapolated). |
| Stub | If marketplace or FX fails → leave prior value / show — · never invent FX or fake anchors |

**Nathan’s farm:** 15 W/TH miners → primary `gomining`; ~19–23 W/TH → `gomining_extrapolated` from live 12/15 anchors.

**Honesty label:** in-band marks are **primary generative list / replacement-cost**. Out-of-band marks are an **explicit linear estimate** from those live anchors — not authenticated secondary P2P. MCP `search_secondary_marketplace` remains account-scoped and not embedded.
