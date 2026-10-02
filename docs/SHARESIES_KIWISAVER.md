# Sharesies KiwiSaver — read-only observe (net worth)

Research date: **2026-10-01**.  
Goal: observe **KiwiSaver balance + fund / holdings mix** from Sharesies NZ for net worth. Prefer official export or sanctioned OAuth — **no passwords in chat, no unofficial login scrapers in-product**.

Product: [sharesies.nz/kiwisaver](https://www.sharesies.nz/kiwisaver)  
Login: [app.sharesies.com/login](https://app.sharesies.com/login)

Cross-links: [KIWIBANK_PLAN.md](./KIWIBANK_PLAN.md) · [IMPORT_FORMATS.md](./IMPORT_FORMATS.md)

---

## What Sharesies offers publicly

### In-app observe (authoritative UI)

After joining the Sharesies KiwiSaver Scheme, the app/web shows:

- current **KiwiSaver balance**
- recent contributions / activity
- **investment plan** (base funds + self-select picks)
- **holdings in each investment**
- buy orders when contributions arrive  

Navigation: Home → Explore → KiwiSaver (web/app).  
Source: [Navigating the Sharesies KiwiSaver Scheme](https://intercom.help/sharesies/en/articles/7439125-navigating-the-sharesies-kiwisaver-scheme-on-web-or-app)

Scheme behaviour (context): base fund(s) + optional self-select (≤50% of plan, ≤5% per pick); US500 / US self-select options described on the marketing page.

### Official reports / CSV (Invest portfolio)

Sharesies documents CSV/PDF reports for **manually integrating with tracking software** ([Reports and contract notes](https://intercom.help/sharesies/en/articles/3146275-reports-and-contract-notes)):

| Report | Format | Use for tracker |
| --- | --- | --- |
| Holdings summary | CSV | Snapshot of holdings / wallet / save balances for a period |
| Investment holdings report | CSV | Ticker, exchange, currency, starting/ending shareholding & **dollar values**, tax-related fields ([field definitions](https://intercom.help/sharesies/en/articles/8093144-investment-holdings-report)) |
| Investment report | PDF | Values for period |
| Transaction / Wallet reports | CSV | Trading & wallet movement (Invest), not the primary KiwiSaver mix view |

Download path (Invest):

1. Log in to Sharesies.  
2. Investment portfolio → **Manage → Download reports**.  
3. Choose report + period → **Export report**.

**Uncertainty (state plainly):** Help Centre articles describe these reports under the **investment portfolio** flow. It is **not clearly documented** in fetched pages that the same CSV exporters dump **KiwiSaver Scheme** holdings 1:1. Nathan should export once and confirm whether KiwiSaver lines appear; if not, use in-app holdings + **View documents** (annual tax certificate / member statements) and **manual snapshot** entry.

Annual tax certificates: app **View Documents** ([tax deep dive](https://www.sharesies.nz/learn/a-deep-dive-into-how-kiwisaver-is-taxed)). Scheme PDFs (PDS, etc.): [kiwisaver/documents](https://www.sharesies.nz/kiwisaver/documents).

### Official Sharesies developer API?

**No public Sharesies developer portal or official read-only portfolio API was found** (2026-10-01). Aggregator pages list “no API products” for Sharesies. Unofficial GitHub/npm “Sharesies-API” wrappers exist historically — **do not use** (they imply credential/session access; not sanctioned).

### Akahu (sanctioned intermediary — optional)

Akahu lists **Sharesies** under enduring **Funds and investment platforms** with **Account data ✅** (Parties ✖️).  
Source: [Akahu integrations](https://developers.akahu.nz/docs/integrations)

Third-party budgeting apps (e.g. BudgetBuddie) claim Sharesies **KiwiSaver** sync **via Akahu** with OAuth-style connect and no password stored by the app ([BudgetBuddie — Sharesies](https://www.budgetbuddie.com/integrations/sharesies)).  

**Caveats:**

- Official bank open-banking matrices mark **KiwiSaver ❌** for bank OB connections ([Akahu OB account types](https://developers.akahu.nz/me/docs/official-open-banking-feature-support-accounts)); Sharesies support is a **non-bank investment** integration — data shape (balance vs full fund mix) must be verified against a live Akahu `GET /accounts` payload after Nathan consents.  
- Personal Akahu app path is the same as in [KIWIBANK_PLAN.md](./KIWIBANK_PLAN.md).  
- Do **not** assume full fund-mix granularity until observed.

### External fund facts (not Nathan’s balance)

[FundCompare API](https://fundcompare.co.nz/api) exposes NZ KiwiSaver **fund** facts (fees, asset mix from FMA QFUs) — useful for labelling funds, **not** for Nathan’s personal balance.

---

## Recommended v1 path

1. **Primary (reliable, official):** Manual or CSV **snapshot import** — balance NZD + per-holding rows from Sharesies UI or Holdings/Investment CSV if KiwiSaver appears.  
2. **Secondary:** After Akahu personal app exists for Kiwibank, **try connecting Sharesies** in the same Akahu account; if KiwiSaver balance appears in `/accounts`, wire read-only observe. Verify fund mix fields before promising UI.  
3. **Reject:** unofficial Sharesies password APIs / scraping.

Stubs: `src/imports/sharesiesHoldingsCsv.ts`, optional reuse of `src/api/akahuClient.ts`.

---

## Exact steps Nathan must do

### A. CSV / document export (no API)

1. Open [app.sharesies.com/login](https://app.sharesies.com/login) and sign in (credentials stay with Sharesies — **do not send passwords to chat or this app**).  
2. Go **Home → Explore → KiwiSaver**; note **balance** and open holdings / investment plan (screenshot or copy for first manual snapshot if needed).  
3. Try **Portfolio → Manage → Download reports** → **Holdings summary** and/or **Investment holdings report** for a recent period → Export CSV.  
4. Check **KiwiSaver → View documents** for statements / tax certificate if CSV lacks scheme detail.  
5. Drop CSV into the tracker import UI (or enter balance + mix manually).

### B. Akahu connect (optional OAuth)

1. Complete Akahu personal app setup per [KIWIBANK_PLAN.md](./KIWIBANK_PLAN.md).  
2. In Akahu connection flow, select **Sharesies** if listed; complete Sharesies authorisation screens (OAuth/consent — no password to our app).  
3. Confirm whether a KiwiSaver account appears; call `/accounts` and record raw JSON shape for mapping.  
4. Revoke anytime in Akahu / Sharesies connected-app settings.

---

## Fallback CSV field mapping

Until a real KiwiSaver export is inspected, map **Investment holdings report** fields (documented) as:

| Sharesies column (documented) | Tracker snapshot field |
| --- | --- |
| Investment ticker symbol | `symbol` / name key |
| Exchange | `exchange` |
| Currency | `currency` |
| Ending shareholding | `units` |
| Ending investment dollar value | `value` (prefer NZD; FX if currency ≠ NZD — mark FX source) |
| Ending share price | optional `price` |

Holdings summary CSV columns are **not fully enumerated** in the help article — implement header sniffing.

Suggested snapshot type (distinct from bank `Transaction`): `KiwiSaverHolding { name, symbol?, valueNzd, weightPct?, asOf }`; parent `KiwiSaverAccount { balanceNzd, holdings[], source, asOf }`.

---

## What’s blocked

| Capability | Blocked until |
| --- | --- |
| Automatic KiwiSaver balance in tracker | Nathan exports CSV/enters snapshot **or** Akahu Sharesies connection proven to return KS data |
| Fund mix breakdown | Same — plus confirmed fields in CSV or Akahu payload |
| Official Sharesies REST API sync | **Unavailable** (no public developer API found) |
| Live price of self-select picks inside KS | Optional later via market data; **balance** from Sharesies is enough for net worth observe |

---

## Security

- Never collect Sharesies passwords.  
- Prefer user-downloaded CSV or Akahu OAuth.  
- KiwiSaver is retirement money — store read-only snapshots; no withdrawal/trading features.

---

## Observed Akahu payload (Nathan · Sharesies KIWISAVER · 2026-10-01)

Live `GET /accounts` for `type: KIWISAVER` / connection Sharesies:

| Field | Present? | Notes |
| --- | --- | --- |
| `balance.current` + `currency: NZD` | ✅ | Authoritative scheme balance |
| `meta.breakdown.returns` | ✅ | Account-level returns (NZD) |
| `meta.portfolio[]` | ✅ | `name`, `symbol`, `value`, `shares`, `returns`, `logo`, `currency`, `fund_id` |
| `meta.profile.pir` | ✅ | e.g. 17.5 |
| `attributes` includes `TRANSACTIONS` | ❌ | `attributes: []` |
| `GET /accounts/{id}/transactions` | ❌ | HTTP 200, **0 items** |
| Government contribution | ❌ | Not a separate field |
| Balance timeseries | ❌ | Not exposed — tracker records a local history point on each Akahu sync |
| `meta.breakdown.cost_basis` | ❌ | Not on Sharesies KS (Hatch investment may have it) |

**Derived (from real fields only):** amount invested ≈ `balance − returns`; return % ≈ `returns / (balance − returns)`.

**Residual:** account `balance.current` can exceed sum(`portfolio[].value`). UI shows residual with an honest note — do not invent labels for the gap.

---

## Bank-held KiwiSaver (not Sharesies)

IRD / Akahu **bank** KiwiSaver is not available. For schemes held at a bank (ANZ, Westpac, ASB, BNZ, Kiwibank, …), use the KiwiSaver tab **manual form** or **bank CSV import** (`POST /api/kiwisaver/import-bank-csv`). UI labels these **Manual** / **Manual (CSV)** — never as Akahu. Column list: [IMPORT_FORMATS.md](./IMPORT_FORMATS.md#bank-held-kiwisaver-manual-csv). Sharesies/Akahu path above is unchanged.

