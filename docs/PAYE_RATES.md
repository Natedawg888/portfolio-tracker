# NZ PAYE rates — sources (never invent)

This app's PAYE calculator (`src/lib/payeRates.ts`, `src/lib/payeCalc.ts`, `/paye` page) uses **only** published IRD (and ACC-via-IRD) figures. When IRD publishes a new tax year, update `payeRates.ts` and this document together.

**Applied period:** pay dates **1 April 2026 – 31 March 2027** (current as of October 2026, Pacific/Auckland).

**Method note:** Take-home is estimated with an **annual progressive** income-tax model, ACC levied separately, then periodised (÷52 / ÷26 / ÷12). IRD's official weekly/fortnightly **tables** (IR340/IR341) combine PAYE+ACC and use pay-period truncation/rounding, so results can differ by a few dollars from IRD's calculator or payroll software. Feature set is inspired by https://www.paye.net.nz/calculator/; visuals use Portfolio Tracker panels/theme only.

## Income tax brackets (from 1 April 2025; still current for 2026/27)

| For each dollar of income | Tax rate |
| --- | --- |
| 0 – $15,600 | 10.5% |
| $15,601 – $53,500 | 17.5% |
| $53,501 – $78,100 | 30% |
| $78,101 – $180,000 | 33% |
| $180,001 and over | 39% |

Source: https://www.ird.govt.nz/income-tax/income-tax-for-individuals/tax-codes-and-tax-rates-for-individuals/tax-rates-for-individuals

### Secondary tax codes (before ACC)

| Estimated annual total income (all sources) | Code | Rate |
| --- | --- | --- |
| 0 – $15,600 | SB | 10.5% |
| $15,601 – $53,500 | S | 17.5% |
| $53,501 – $78,100 | SH | 30% |
| $78,101 – $180,000 | ST | 33% |
| $180,001+ | SA | 39% |

Source: same IRD page; also https://www.ird.govt.nz/income-tax/income-tax-for-individuals/tax-codes-and-tax-rates-for-individuals/about-tax-codes

## ACC earners' levy (1 April 2026 – 31 March 2027)

| Item | Value |
| --- | --- |
| Levy rate | **1.75%** ($1.75 per $100, incl. GST) |
| Maximum liable earnings | **$156,641** |
| Maximum levy | **$2,741.22** |

Source: https://www.ird.govt.nz/income-tax/income-tax-for-individuals/acc-clients-and-carers/acc-earners-levy-rates

IRD payroll tables include ACC inside "PAYE"; this calculator **splits** income tax and ACC for clarity.

## KiwiSaver (pay dates on/after 1 April 2026)

| Item | Value |
| --- | --- |
| Employee rates | **3.5%**, 4%, 6%, 8%, 10% |
| IRD default / minimum employee rate | **3.5%** |
| Employer minimum | **3.5%** |
| Account starting rate (saved per user) | **3.5%** |

The PAYE page offers **3.5%** as the starting employee contribution rate for this account (the statutory minimum from 1 April 2026) and saves the rate the user chooses (`users.preferences_json.kiwiSaverEmployeeRatePct`). A custom rate can still be entered. The contribution shown is still gross pay times the saved rate. The page does not invent a contribution dollar amount.

Sources:
- IR340 Apr 2026: https://www.ird.govt.nz/-/media/project/ir/home/documents/forms-and-guides/ir300---ir399/ir340/ir340-apr-2026.pdf
- Taxation bill now in effect (31 Mar 2026): https://www.ird.govt.nz/updates/news-folder/2026/taxation-bill-now-in-effect
- Payroll Calculations & Business Rules Spec 2026 PDF on ird.govt.nz

## Student loan (NZ-based, salary/wages)

| Item | Value |
| --- | --- |
| Repayment rate | **12%** of income over threshold |
| Annual threshold | **$24,128** (frozen) |
| Weekly / fortnightly / 4-weekly / monthly | $464 / $928 / $1,856 / $2,010.66 |
| Secondary job | **12% of all secondary gross** (no threshold) |

Source: https://www.ird.govt.nz/student-loans/living-in-new-zealand-with-a-student-loan/repaying-my-student-loan-when-i-earn-salary-or-wages

## Independent Earner Tax Credit (IETC)

| Annual income (before tax) | Credit |
| --- | --- |
| Under $24,000 | $0 |
| $24,000 – $66,000 | **$520**/yr ($10/week) |
| $66,001 – $69,999 | $520 minus 13c per $1 over $66,000 |
| $70,000+ | $0 |

Primary tax codes **ME** / **ME SL** when applied during the year. Eligibility exclusions (Working for Families, NZ Super, etc.) are the user's responsibility — the calculator only applies the income-band formula when IETC is enabled.

Source: https://www.ird.govt.nz/income-tax/income-tax-for-individuals/individual-tax-credits/independent-earner-tax-credit-ietc

## Payroll giving

| Item | Value |
| --- | --- |
| Donation tax credit | **33.33c per $1** donated (1/3) |
| Cap | Credit must not exceed the **tax portion** of PAYE for the period |

Sources:
- https://www.ird.govt.nz/roles/employees/payroll-giving-as-an-employee
- IR617 Payroll giving PDF on ird.govt.nz

## Charity donation tax credit (IR526 — outside payroll)

Separate from payroll giving. Eligible cash donations of **$5+** to IRD-approved donees earn a tax credit of **1/3** of donations, capped at **1/3 of taxable income**. Claim after year-end (myIR / IR526) with receipts. **Do not** include payroll-giving amounts (already credited each pay).

| Item | Value |
| --- | --- |
| Rate | **33.33c per $1** donated |
| Cap | Lesser of 1/3 donations and 1/3 taxable income |
| Timing | Year-end assessment / IR526 (not payday PAYE) |

Source: https://www.ird.govt.nz/income-tax/income-tax-for-individuals/individual-tax-credits/donation-tax-credits/about-donation-tax-credits

The calculator applies the credit to estimated PAYE / refund and does **not** re-deduct the gift from salary take-home (money already given outside payroll).

**Budget link:** On **Budget / Spending**, setting a transaction category to **Charity** opens a receipt upload popup. Saving with “Link to PAYE” stores the receipt (image/PDF) and adds the donation into PAYE prefs (`charityLinks` -> annual IR526 total).

## Investing credits (beyond IETC)

**Honest finding:** IRD employer PAYE tables, tax codes, and the Payroll Calculations & Business Rules Spec have **no payday “investing credit” field**. Salary/wage PAYE is not reduced mid-year for investment credits.

What *does* exist are **investment-related tax credits on the annual income-tax assessment**. Enter annual **NZD from statements / myIR** on the PAYE tab so estimated take-home reflects them. This app does **not** invent credit amounts.

| Kind | What it is | Timing | Source |
| --- | --- | --- | --- |
| Imputation credits | Tax NZ companies already paid, attached to dividends | Assessment (also offsets dividend RWT at payment) | Dividend statements; IRD RWT / imputation guidance |
| RWT credits | Resident withholding tax already deducted on interest/dividends | Assessment offset | Bank/broker statements; myIR investment income |
| PIE tax credit | Excess PIE tax when PIR was too high vs correct PIR | Year-end PIE calculation on assessment | https://www.ird.govt.nz/income-tax/income-tax-for-individuals/types-of-individual-income/portfolio-investment-entity-income-for-individuals/end-of-year-pie-calculation |
| Foreign tax credit | Tax paid overseas on foreign investment income (capped at NZ tax on that income) | IR3 / assessment | https://www.ird.govt.nz/international-tax/individuals/tax-for-new-zealand-tax-residents |
| Other investing | User-labelled NZD | Your figure | — |

### RWT interest rate bands (reference only — from 31 July 2024)

| Total taxable income | RWT rate |
| --- | --- |
| Up to $15,600 | 10.5% |
| $15,601 – $53,500 | 17.5% |
| $53,501 – $78,100 | 30% |
| $78,101 – $180,000 | 33% |
| $180,001+ | 39% |

Defaults: no chosen rate on interest -> **33%**; no IRD number -> **45%**. Dividend RWT -> **33%** (reduced by attached imputation credits).

Source: https://www.ird.govt.nz/income-tax/withholding-taxes/resident-withholding-tax-rwt/using-the-right-rwt-tax-rate

### How the calculator applies them

Investing credits reduce the modelled PAYE pot (income tax + ACC − IETC − payroll giving − charity donation credit), floored at 0. Any surplus still increases estimated annual take-home (as a refund would). They **do not** change your employer tax code.

The PAYE page **persists** last inputs (including investing and charity credits) in `localStorage` (`portfolio-tracker-paye-prefs`) and restores applied credits on load. Investing credits are **not** seeded with $0 placeholders. Portfolio/income auto-fill adds a row only when a real savings-interest or dividend income record/transaction in the tax year explicitly names a credit kind (imputation / RWT / PIE / foreign) with NZD > 0 — other income and plain dividends/interest alone never add a row or invent RWT. Manual **Add credit** remains available.

## Piece rate, contract (schedular) and share of catch (KAN-70)

The pay type selector on `/paye` offers **Salary / wages**, **Hourly**, **Piece rate**, **Contract (schedular)** and **Share of catch**. Rates for these come from the per-tax-year config `PAY_TAX_YEARS` in `src/lib/payeRates.ts` (keyed by the year the tax year starts; `2026` = 1 April 2026 – 31 March 2027). Add a new entry when the next year's figures are published.

### Minimum wage (1 April 2026 – 31 March 2027)

| Rate | Hourly |
| --- | --- |
| Adult | **$23.95** (up from $23.50) |
| Starting-out / training | **$19.16** (80% of adult) |

Source: Employment NZ, https://www.employment.govt.nz/news-and-updates/minimum-wage-is-increasing-on-1-april-2026 (Minimum Wage Order 2026).

Piece-rate employees must be paid at least minimum wage for the hours they work. When rate × units ÷ hours is below the adult minimum wage, the page shows a note and the topped-up amount (minimum wage × hours), and PAYE is worked out on the topped-up figure.

### Holiday pay with wages

**8%** of gross earnings, paid each pay ("pay as you go"). Only allowed for genuine fixed-term work under 12 months or work too irregular for four weeks' holidays, by written agreement. The page applies 8% to topped-up earnings when the toggle is on.

Source: https://www.employment.govt.nz/pay-and-hours/pay-and-wages/leave-and-holiday-pay/pay-as-you-go-annual-holiday-payments

### Schedular withholding (tax code WT)

Standard rates from IRD's **IR330C Tax rate notification for contractors (January 2024)**, page 3. The page offers these activities:

| # | Activity | Standard rate |
| --- | --- | --- |
| 2 | Agricultural contracts on farming land | 15% |
| 3 | Agricultural, horticultural or viticultural contracts (labour on fruit crops, orchards, vegetables, vineyards) | 15% |
| 5 | Cleaning (not residential premises) | 20% |
| 8 | Labour-only contracts in the building industry | 20% |
| 12 | Fishing boat work for profit-share (supply of labour only) | 20% |
| 13 | Forestry or bush work, flax planting or cutting | 15% |
| 15 | Gardening, grass / hedge cutting, weed or vermin destruction (for a business) | 20% |
| 19 | Labour hire arrangement | 20% |
| 20 | Caretaking / guard, mail contracting, milk delivery, refuse removal, school transport | 15% |
| 21 | Sales of eels, greenstone, sphagnum moss, whitebait, wild deer / pigs / goats (not retail) | 25% |
| 23 | Shearing or droving | 15% |
| 25 | Voluntary schedular payments (by written agreement) | 20% |

- Elected rate: not below **10%** (15% for non-residents / temporary visa holders). A tailored rate certificate (IR23BS) can go lower.
- No IR330C given: **45%** no-notification rate.
- GST registered: withholding is on the **GST-exclusive** amount; GST (**15%**) is added to the invoice and owed to IRD.
- No PAYE, KiwiSaver or student loan is deducted from schedular payments. ACC invoices the contractor directly. End-of-year tax and possibly provisional tax (residual income tax over $5,000) may still be due.

Source: https://www.ird.govt.nz/-/media/project/ir/home/documents/forms-and-guides/ir300---ir399/ir330c/ir330c-2024.pdf

### Share of catch

Catch value (per trip × trips per week, or per week) × share %, minus optional expenses. Treated as self-employed income: no PAYE. The page shows income tax on the annual net from the brackets above as a guide only. If the operator deducts schedular tax (activity 12, 20%), use Contract (schedular).

### Saved pay sources

"Save as income source" stores the calculator inputs in `pay_sources` (per user). The server recomputes weekly gross / net from those inputs with the same calculator (`src/lib/outputPayCalc.ts`). Weekly net (piece-rate take-home; contract net received excl. GST; share of catch after expenses) × 52 ÷ 12 is shown as expected income on Budget and Home (beside received income, never added to it). Projections use it for monthly saving only when the saving window has no recorded income.

## Files

| Path | Role |
| --- | --- |
| `src/lib/payeRates.ts` | Constants + source URL list |
| `src/lib/payeCalc.ts` | Annual progressive engine |
| `src/lib/payePrefs.ts` | localStorage persistence for PAYE inputs / credits |
| `src/lib/payeInvestingFromPortfolio.ts` | Suggest investing credits from income only when real NZD + credit wording exists |
| `src/pages/Paye.tsx` | UI (`/paye`, nav label **PAYE**) |
| `src/lib/outputPayCalc.ts` | Piece rate, schedular, share of catch, pay range (KAN-70) |
| `src/lib/outputPayPrefs.ts` | localStorage for the output-pay inputs |
| `src/components/OutputPay.tsx` | Output-pay inputs, results, saved sources |
| `server/paySources/` | Saved pay sources (store, validation) — `/api/pay-sources` |
