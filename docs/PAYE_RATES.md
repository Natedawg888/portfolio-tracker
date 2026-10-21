# NZ PAYE rates — sources (never invent)

This app's PAYE calculator (`src/lib/payeRates.ts`, `src/lib/payeCalc.ts`, `/paye` page) uses **only** published IRD (and ACC-via-IRD) figures. When IRD publishes a new tax year, update `payeRates.ts` and this document together.

**Tax years (KAN-79):** the calculator reads every rate from the selected year's entry in `PAY_TAX_YEARS` (`payeRates.ts`). The current year is **1 April 2026 – 31 March 2027** (as of October 2026, Pacific/Auckland); **1 April 2025 – 31 March 2026** and **1 April 2024 – 31 March 2025** are also available (see [2025/26 rates](#202526-rates-1-april-2025--31-march-2026) and [2024/25 rates](#202425-rates-1-april-2024--31-march-2025)). The PAYE page has a tax-year picker. Add a year only once IRD has published **all** its figures. ACC for 2027/28 is already published (1.83%, max earnings $160,244, max levy $2,932.47), but income tax, student loan and minimum wage for that year are not, so 2027/28 is not offered yet.

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
| Employee rates | **3.5%**, 4%, 6%, 8%, 10%, plus **3%** under a temporary rate reduction |
| IRD default / minimum employee rate | **3.5%** |
| Employer minimum | **3.5%**; **3%** (match) while the employee is on a temporary rate reduction |
| Account starting rate (saved per user) | **3.5%** |

The PAYE page offers **3.5%** as the starting employee contribution rate for this account (the statutory minimum from 1 April 2026) and saves the rate the user chooses (`users.preferences_json.kiwiSaverEmployeeRatePct`). A custom rate can still be entered. The contribution shown is still gross pay times the saved rate. The page does not invent a contribution dollar amount.

Temporary rate reduction (KAN-88): from the first pay day on/after 1 April 2026 a member can apply to IRD to stay at **3%** for 3–12 months, renewable back-to-back, but not during a savings suspension. While they're on it the employer may match at 3%; otherwise the employer minimum is 3.5%. The pay tools list 3% as "3% (temporary rate reduction)", and `calculatePaye` lifts an employer rate below 3.5% up to 3.5% (with a note) unless the employee rate is 3%. Sources: [IRD — Temporary rate reduction](https://www.ird.govt.nz/kiwisaver/kiwisaver-individuals/making-changes-to-my-kiwisaver/changing-my-kiwisaver-contribution-rate/temporary-rate-reduction), [IRD — KiwiSaver changes](https://www.ird.govt.nz/kiwisaver-changes), [IRD — Employer contributions](https://www.ird.govt.nz/kiwisaver/kiwisaver-employers/contributions-and-deductions/employer-contributions-to-kiwisaver-and-complying-funds).

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

## 2025/26 rates (1 April 2025 – 31 March 2026)

Checked against the sources below on 15 October 2026. Anything not listed is the same as 2026/27.

| Item | 2025/26 | 2026/27 |
| --- | --- | --- |
| Income tax brackets and secondary codes | Same bands ("From 1 April 2025" table) | Same |
| ACC earners' levy | **1.67%**, max earnings **$152,790**, max levy **$2,551.59** | 1.75%, $156,641, $2,741.22 |
| KiwiSaver employee rates | **3, 4, 6, 8, 10%**; default and employer minimum **3%** | 3.5, 4, 6, 8, 10% (+ 3% temporary rate reduction); 3.5% (3% match on a reduction) |
| Student loan | 12% over **$24,128** ("2026 tax year") | Same (threshold frozen) |
| IETC | $520; $24,000–$66,000, abates 13c to $70,000 (from 31 July 2024) | Same |
| Minimum wage (adult / starting-out) | **$23.50 / $18.80** from 1 April 2025 | $23.95 / $19.16 |

Sources:
- IRD — Tax rates for individuals: https://www.ird.govt.nz/income-tax/income-tax-for-individuals/tax-codes-and-tax-rates-for-individuals/tax-rates-for-individuals
- IRD — ACC earners' levy rates: https://www.ird.govt.nz/income-tax/income-tax-for-individuals/acc-clients-and-carers/acc-earners-levy-rates
- IRD — KiwiSaver changes (2025): https://www.ird.govt.nz/updates/news-folder/2025/kiwisaver-changes (3% → 3.5% on pay days from 1 April 2026)
- IRD — Student loan repayments (salary/wages): https://www.ird.govt.nz/student-loans/living-in-new-zealand-with-a-student-loan/repaying-my-student-loan-when-i-earn-salary-or-wages
- IRD — IETC: https://www.ird.govt.nz/income-tax/income-tax-for-individuals/individual-tax-credits/independent-earner-tax-credit-ietc
- Employment NZ — Previous minimum wage rates: https://www.employment.govt.nz/pay-and-hours/pay-and-wages/minimum-wage/previous-min-wage-rates

## 2024/25 rates (1 April 2024 – 31 March 2025)

Added for KAN-96 and checked on 18 October 2026. The income tax brackets and IETC thresholds changed on **31 July 2024**, part way through the year.

| Item | 2024/25 |
| --- | --- |
| Income tax (whole year) | IRD's **composite** rates: 10.5% to $14,000; 12.82% to $15,600; 17.5% to $48,000; 21.64% to $53,500; 30% to $70,000; 30.99% to $78,100; 33% to $180,000; 39% above |
| Income tax (single pay) | Pay days to 30 July 2024: 10.5% to $14,000; 17.5% to $48,000; 30% to $70,000; 33% to $180,000; 39% above. From 31 July 2024: the current bands |
| Secondary codes | Whole year: the codes from 31 July 2024 (no composite table exists; the result says so). Single pay: by pay date, before 31 July 2024 SB $14,000 / S $48,000 / SH $70,000 / ST $180,000 |
| ACC earners' levy | **1.60%**, max earnings **$142,283**, max levy **$2,276.52** |
| KiwiSaver employee rates | **3, 4, 6, 8, 10%**; default and employer minimum **3%** |
| Student loan | 12% over **$24,128** (from 1 April 2024) |
| IETC (whole year) | **Not loaded.** IRD squares up 2024/25 with a transitional calculation and its figures weren't confirmed, so the PAYE page disables the IETC switch for this year |
| IETC (single pay) | Pay days to 30 July 2024: $24,000–$44,000, abates 13c to $48,000. From 31 July 2024: $24,000–$66,000, abates 13c to $70,000 |
| Minimum wage (adult / starting-out) | **$23.15 / $18.52** from 1 April 2024 |
| Working for Families | Not loaded |

The whole-year PAYE calculator uses the composite rates. The payslip check uses the rates in force on each pay day (`payDatePeriods` in `payeRates.ts`, read by `ratesForPayDate`).

Sources:
- IRD — Tax rates for individuals ("From 1 April 2024 to 31 March 2025" table): https://www.ird.govt.nz/income-tax/income-tax-for-individuals/tax-codes-and-tax-rates-for-individuals/tax-rates-for-individuals
- IRD — ACC earners' levy: https://www.ird.govt.nz/acclevy
- IRD — IETC: https://www.ird.govt.nz/income-tax/income-tax-for-individuals/individual-tax-credits/independent-earner-tax-credit-ietc
- TIB Vol 36 No 7 (Aug 2024): https://www.taxtechnical.ird.govt.nz/-/media/project/ir/tt/pdfs/tib/volume-36---2024/tib-vol36-no7.pdf
- Employment NZ — Previous minimum wage rates: https://www.employment.govt.nz/pay-and-hours/pay-and-wages/minimum-wage/previous-min-wage-rates

## Household take-home pay (KAN-79)

The Household page adds up members who opt in to sharing their pay. Each member is worked out on their own with `calculatePaye` for the tax year being viewed (NZ has no joint filing), and saved piece-rate sources go through the same engine. Contract and share-of-catch sources aren't taxed through payroll, so only their gross and amount received are counted. Payroll giving and investing credits aren't part of the household inputs. Code: `server/households/paye.ts`; tests: `server/households/paye.test.ts`.

## Working for Families (KAN-79)

Household estimate only (Household page → Household take-home pay). Each person's PAYE stays individual; these credits use **family income**: the parents' or caregivers' combined pay before tax, from the pay they share. Code: `src/lib/wffCalc.ts` (rates in `WffRates` on each `PAY_TAX_YEARS` entry), `server/households/family.ts`.

### 1 April 2026 – 31 March 2027 (checked 16 October 2026)

| Item | Value |
| --- | --- |
| Family tax credit | $7,921 eldest child, $6,454 each other child |
| Abatement | 27.5% of family income over $44,900; off the family tax credit first, then the in-work tax credit |
| In-work tax credit | $7,670 for 1–3 children ($147 a week, **temporary**), + $780 per child after the 3rd. Back to $97 a week ($5,070) after 31 March 2027. IRD: it "may reduce back to $97 if the cost of petrol drops below $3 a litre for four weeks" |
| Minimum family tax credit | Tops income after income tax up to $36,604 ($703 a week); 20 hours a week (sole parent) or 30 between a couple |
| Best Start | $4,041 a child a year ($77 a week) to age 3; 21% over $79,000. Children born on or after 1 April 2026 are income-tested from birth; earlier births aren't in their first year |
| Instalments | Yearly amount ÷ 52, rounded down |

Sources: IRD [family tax credit](https://www.ird.govt.nz/working-for-families/types/family-tax-credit), [in-work tax credit](https://www.ird.govt.nz/working-for-families/types/in-work-tax-credit), [minimum family tax credit](https://www.ird.govt.nz/working-for-families/types/minimum-family-tax-credit), [Best Start](https://www.ird.govt.nz/working-for-families/types/best-start), and the [IR271 weekly payments chart 2027](https://www.ird.govt.nz/-/media/project/ir/home/documents/forms-and-guides/ir200---ir299/ir271/ir271-2027.pdf). `src/lib/wffCalc.test.ts` checks rows of that chart and IRD's worked examples.

### 1 April 2025 – 31 March 2026: not loaded

IRD's chart for that year (IR271, July 2025) shows weekly amounts but not the yearly family tax credit rates, and IRD's pages now show only 2026/27. Third-party figures (e.g. $7,524 eldest) don't reproduce IRD's chart, so nothing is loaded and the estimate shows a dash. Known from the chart: threshold $42,700, IWTC $97 a week, MFTC $35,316 after tax, Best Start $73 a week ($3,838).

Not modelled: shared care, foster care / orphan's / unsupported child's benefits, and changes part-way through the year.

## Payslip check (KAN-78)

Budget → Payslips compares each payslip with what the calculator expects for its pay period, tax code and the tax year of its pay date (`src/lib/payslipCheck.ts`): PAYE (income tax after IETC on ME), the ACC earners' levy (or PAYE including ACC, when the payslip shows them together), the KiwiSaver employee contribution (at the rate given, or whichever standard rate it matches) and student loan (per-period threshold on M/ME; every dollar on secondary codes). Rates are the ones in force on the pay date, so a 2024/25 payslip before 31 July 2024 uses that year's old brackets and IETC thresholds. Pay is annualised (×52, ×26, ×13 or ×12) and divided back, as IRD's payroll specification does. A difference of up to $1, or 1% when that's more, counts as matching because IRD's period tables round. Covered tax codes: M, ME, SB, S, SH, ST, SA, each with or without SL. ESCT and other codes are recorded but not checked. A pay date in a tax year without loaded rates isn't checked.

## KiwiSaver calculator (KAN-59)

KiwiSaver page → KiwiSaver calculator (`src/lib/kiwiSaverCalc.ts`, rules in `src/lib/kiwiSaverRules.ts`, checked 16 October 2026):

| Rule | Value | Source |
| --- | --- | --- |
| Government contribution (from 1 July 2025) | 25c per $1 you put in (1 July – 30 June), up to $260.72; put in $1,042.86 for the full amount; ages 16–65; taxable income $180,000 or less | [IRD — Getting the KiwiSaver government contribution](https://www.ird.govt.nz/kiwisaver/kiwisaver-individuals/growing-my-kiwisaver-account/getting-the-kiwisaver-government-contribution) |
| ESCT on employer contributions (from 1 April 2025) | 10.5% to $18,720; 17.5% to $64,200; 30% to $93,720; 33% to $216,000; 39% above — on salary + employer contributions | IRD "Get ready for new ESCT and FBT changes"; IR340 April 2026 |
| Employee rates, employer minimum | From the current year in `payeRates.ts` (3.5% minimum from 1 April 2026; 4% from 1 April 2028 is noted, not modelled) | see above |
| Withdrawal age | 65 | IRD |

Today's rules apply to every projected year, and dollar thresholds aren't inflation-adjusted. The return is the user's assumption (after fees and tax).

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
