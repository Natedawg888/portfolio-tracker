# Import format expectations (CSV / OFX / wallet)

Research-backed sketch for scaffold parsers. **Confirm headers against Nathan’s real exports** — banks change column names between classic and refreshed UIs.

Cross-links: [KIWIBANK_PLAN.md](./KIWIBANK_PLAN.md) · [GOOGLE_PAY_WALLET.md](./GOOGLE_PAY_WALLET.md) · [SHARESIES_KIWISAVER.md](./SHARESIES_KIWISAVER.md)

Target type: `Transaction` in `src/types/index.ts` (`date`, `description`, `amount` signed, `kind`, `currency`, `externalId`).

---

## Module stubs

| File | Role |
| --- | --- |
| `src/imports/types.ts` | `ImportResult`, column map, parse errors |
| `src/imports/kiwibankCsv.ts` | Kiwibank CSV |
| `src/imports/kiwibankOfx.ts` | Kiwibank OFX |
| `src/imports/walletCsv.ts` | Generic spend CSV (post–Takeout conversion) |
| `src/imports/googlePayTakeout.ts` | Takeout JSON → rows |
| `src/imports/sharesiesHoldingsCsv.ts` | Sharesies holdings / KiwiSaver snapshot CSV |
| `src/imports/bankKiwisaverCsv.ts` | Bank-held KiwiSaver snapshot CSV (manual — not Akahu) |
| `src/imports/gominingManual.ts` | Manual digital-miner holdings + optional price refresh |

---

## Kiwibank CSV

**Sources of format truth:** user export; Kiwibank documents CSV/JSON/OFX/QIF/PDF ([online banking refresh](https://www.kiwibank.co.nz/banking-with-us/online-banking/internet-banking/a-new-internet-banking-experience-is-coming/)). Third parties report columns like Date, Memo/Description, Amount, Balance ([Owdyn](https://owdyn.com/blog/how-to-import-nz-bank-transactions)).

| Expected / sniff aliases | Notes |
| --- | --- |
| `Date` | NZ `DD/MM/YYYY` or `DD/MM/YYYY HH:mm` → `YYYY-MM-DD` |
| `Amount` | May be signed single column **or** separate Debit/Credit — detect |
| `Memo`, `Description`, `Particulars` | Concatenate with Code/Reference if present |
| `Balance` | Optional |
| `Code`, `Reference`, `Analysis` | “Full CSV” variants |

Dedupe key suggestion: hash(`date|amount|description|balance?`).

---

## Kiwibank OFX

Expect `BANKMSGSRSV1` / `STMTTRN`: `DTPOSTED`, `TRNAMT`, `FITID`, `NAME`/`MEMO`. Use `FITID` as `externalId` when present. Currency from `CURDEF` (usually NZD).

---

## Google Pay / Wallet CSV (after Takeout conversion)

No official CSV schema. Parser: `src/imports/walletCsv.ts` (`parseWalletCsv`) — flexible header sniffing.

| Expected / sniff aliases | → |
| --- | --- |
| `date`, `transactionTime`, `Date` | `date` (YYYY-MM-DD; NZ `DD/MM/YYYY` OK) |
| `amount`, `Amount` (or debit/credit cols) | signed `amount` |
| `description`, `merchant`, `counterparty` | `description` |
| `card_name`, `cardName`, `paymentInstrument`, `Card` | `cardName` (instrument label — not PAN) |
| `currency`, `external_id` / `id` | optional |
| `status` | skip failed/cancelled/pending when present |

Only rows on/after **2026-10-01** are kept on import. Charged `accountId` is required (link to Kiwibank cash).

**Manual first-class path:** Nexo / GoMining / other cards that never appear in Akahu — use Spending → Add transaction (card presets + free-text). Do not wait on Wallet CSV.

Prefer issuer bank sync (Akahu) when the spend hits Kiwibank. Takeout JSON: `parseGooglePayTakeoutJson` is best-effort with provisional field names — confirm against a real sample.

---

## Sharesies holdings / KiwiSaver snapshot

Prefer official **Holdings summary (CSV)** or **Investment holdings report (CSV)** from Portfolio → Manage → Download reports ([help](https://intercom.help/sharesies/en/articles/3146275-reports-and-contract-notes)).

Investment holdings report documented fields include ticker, exchange, currency, starting/ending shareholding and dollar values ([definitions](https://intercom.help/sharesies/en/articles/8093144-investment-holdings-report)). For **net worth observe**, map ending dollar value + ticker/name into a KiwiSaver / holdings snapshot (not necessarily `Transaction`).

If KiwiSaver-only PDF statements are all that’s available, keep **manual balance + fund mix** entry until a CSV sample exists.

---

## Bank-held KiwiSaver (manual CSV)

**Why:** IRD / Akahu bank KiwiSaver is not available. Bank-held schemes (ANZ, Westpac, ASB, BNZ, Kiwibank, …) are entered on the KiwiSaver tab via form or CSV. Labels show **Manual** / **Manual (CSV)** — never as Akahu.

Parser: `src/imports/bankKiwisaverCsv.ts` · API: `POST /api/kiwisaver/import-bank-csv`. Upserts by `provider` + `scheme_name`. Does **not** touch Akahu Sharesies rows. Records a balance history point on save (`source=csv`).

| Column | Required | Aliases / notes |
| --- | --- | --- |
| `provider` | one of provider / scheme_name / name | `bank`, `institution`, `manager` |
| `scheme_name` | optional | `scheme`, `product` |
| `name` | optional | display label; defaults from provider + scheme |
| `balance_nzd` | **yes** | `balance`, `value`, `value_nzd`, `total` |
| `amount_invested_nzd` | optional | `invested`, `cost_basis_nzd`, … — if set without returns, returns = balance − invested |
| `returns_nzd` | optional | `returns`, `earnings`, `gain` |
| `observed_at` | optional | `as_of`, `date`, `statement_date` — ISO or NZ `DD/MM/YYYY` |
| `notes` | optional | |
| `fund_name` | optional | with multiple rows per scheme → fund mix |
| `fund_allocation_pct` | optional | `allocation`, `weight_pct` |
| `fund_balance_nzd` | optional | `fund_value`, `holding_value` |

Example:

```csv
provider,scheme_name,balance_nzd,amount_invested_nzd,returns_nzd,observed_at,notes
ANZ,Growth,12500.50,10000,,2026-10-01,Statement Oct
Westpac,Balanced,8200.00,,450.00,01/10/2026,
```

Fund-mix example (two funds, same scheme):

```csv
provider,scheme_name,balance_nzd,fund_name,fund_allocation_pct,fund_balance_nzd
ANZ,Growth,12500.50,Growth Fund,60,7500.30
ANZ,Growth,12500.50,Cash,40,5000.20
```

`provider=sharesies` rows are rejected here — use Akahu sync / Sharesies CSV stub instead.

---

## GoMining miners (manual + optional feed)

Not a bank CSV. See [GOMINING.md](./GOMINING.md). Import shape sketch:

| Field | Notes |
| --- | --- |
| `minerId` / name | NFT id or collection name |
| `hashrateTh` | TH/s |
| `efficiencyWPerTh` | W/TH |
| `rarity` / `upgradeLevel` | from app / MCP `get_nft_detail` |
| `listedPriceGmt` or `estValueGmt` | secondary marketplace / manual |
| `asOf` | ISO timestamp |
| GMT wallet balance | **separate** line item |
