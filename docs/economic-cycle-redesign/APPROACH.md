# Economic Cycle redesign — approach

This plan covers the dashboard redesign. The original feature design (phase model, providers, persistence) is in the root `APPROACH.md`, which is left as it is.

## 1. Current architecture

| Concern | Where | Notes |
| --- | --- | --- |
| Framework | Vite 8 + React 19 (`src/`), Express 5 API (`server/`), sql.js SQLite | One repo, `npm run dev` runs both |
| Routing | `react-router-dom` 7, `src/App.tsx` → `/economic-cycle` → `src/pages/EconomicCycle.tsx` | Behind the sign-in gate |
| State | Local component state + `src/lib/pageDataCache.ts` (`economy:<country>`, `news:<country>:<phase>`) | Cache keeps payloads across page visits |
| Styling | Global `src/App.css`, page-scoped tokens under `.econ-page` for light and dark | Dark green / cream identity, rounded cards |
| Charts | Hand-written SVG (sparkline, phase timeline). No chart library | `AssetLineChart` is NZD/money-specific, not reused |
| Tests | Plain `node --import tsx` scripts with `assert`; no DOM test runner | `npm run test:economy`, `test:page-cache` |
| API | `GET /api/economy/cycle?country=&refresh=`, `GET /api/economy/news?phase=&country=&refresh=` (`server/routes/economy.ts`) | |
| Scoring | `server/economy/scoring.ts` (pure), rules and thresholds in `weights.ts` | Deterministic, no clock or I/O |
| Quarter selection | `server/economy/analyse.ts` | Replays every quarter since 2012 from stored observations |
| Payload | `server/economy/view.ts` (`buildCycleView`) | Page renders this; it does not score |
| Fetch / cache | `server/economy/service.ts`, `store.ts` | `ECONOMY_CACHE_HOURS` (12 h), `?refresh=1` |
| News | `server/economy/phaseNews.ts` over `server/news/rss.ts` | Google News searches per topic + BBC world/politics |
| Asset context | `server/economy/assetContext.ts` | Static qualitative copy per phase, not data |

### How the numbers are made (unchanged by this work)

- Each indicator is bucketed `low / moderate / high` against thresholds, and `falling / stable / rising` against its previous value using a flat band.
- Each phase has one rule per indicator with a weight. Fit is 1 / 0 per condition, 0.5 when the change is unknown; the rule fit is the minimum of its conditions.
- Phase fit = Σ(weight × fit) / Σ(weight) over present indicators. The winning phase is the highest fit.
- **Confidence** = `0.62 × support + 0.23 × margin + 0.15 × coverage`, capped at 45 with fewer than 3 indicators and at 70 with fewer than 5. Support is the winner's fit, margin is its relative lead over the runner-up, coverage is indicators present / 11. It is an agreement score. It is not calibrated and is not a probability.
- **Overall score** = fit-weighted average of phase anchors (−80 recession … +75 late expansion).
- **Contribution** = rule weight × fit for the winning phase.

## 2. Problems in the current page

1. Hero stacks eight lines of small text (confidence disclaimer, score, momentum, country, as-of, provider, explanation paragraph, button). The phase is clear; the reasons are not.
2. Each indicator card prints ~10 lines: value, previous, status, a generated paragraph ("This reading is in the middle range. It is lower than the previous reading. The match with this phase is 50 out of 100…"), period, published, retrieved, source, notes, a long description, sparkline. Eleven of these make a wall of text.
3. Status relies on wording only; "Diverges" is reworded into a sentence on the card.
4. The phase rail is decorative. It cannot be explored.
5. No breakdown of the confidence value, no list of supporting vs. conflicting indicators, and no view of how the other four phases scored.
6. Publication date, period, and retrieval time all render as same-weight lines. Derived values (calculated in this app) are only flagged inside long notes.
7. News: up to nine groups × four cards, each with a large "No summary in this feed item." block. Google News descriptions usually repeat the headline.
8. Asset context is static copy shown as a grid of five cards under the history chart.
9. Sparkline has no accessible description of values. Phase chart needs horizontal scroll on mobile (fine) but the table is the only text alternative.
10. Performance is fine: one cycle request (cached), one news request. Nothing re-fetches on render.

## 3. Data audit — what is and is not supported

| Need | Supported? | Basis |
| --- | --- | --- |
| Takeaways from data | Yes | Level and change per indicator from the model's own buckets |
| Why this phase | Yes | Fit, weight, contribution per indicator; phase fits for all five phases |
| Confidence breakdown | Yes, after exposing the three parts already computed in `assessCycle` | No formula change |
| Phase history | Yes | `analysis.timeline` (latest vintage replay) |
| Indicator conditions per past phase | Yes | Frames replayed by `analyse.ts`; medians per phase |
| Share returns by phase | Partly | `share_market` is the OECD share-price index 3-month change. Non-overlapping quarter-end changes can be chained into a quarter-end price index. Price only: no dividends, fees, or tax. Quarter-end resolution understates intra-quarter drawdowns |
| Cash / term deposits by phase | Partly | `interest_rates` is the interbank rate (not a retail term-deposit rate, not the OCR). Real rate ≈ rate − annual CPI. Before tax |
| Residential property returns | **No** | `housing_activity` is dwelling consents, not prices. Needs a house-price index (e.g. REINZ HPI, Stats NZ / CoreLogic) |
| Bonds | **No** | Needs a bond total-return index (e.g. S&P/NZX NZ Government Bond Index) |
| Gold / precious metals | **No** | App only keeps ≤1 year of metal prices for portfolio cards. Needs a long monthly NZD gold series |
| Crypto | **No** | App keeps ≤1 year. Bitcoin history is also too short to span several NZ cycles in this model (2012+) |
| Scenario simulator | Yes | `assessCycle` is pure; inputs come from stored observations |

## 4. Proposed UI and UX

1. **Overview** — country, phase, a 0–100 confidence meter labelled "indicator agreement, not a probability", overall score on a −100…+100 strip, as-of quarter and last retrieved. Three themed takeaways (Growth, Prices & rates, Jobs) built from level/change of the relevant indicators. "Why this phase?" disclosure: supports / mixed / conflicts lists with contribution and max weight, all five phase fits, the confidence parts and caps, and limitations.
2. **Phase explorer** — the five-phase rail becomes a set of toggle buttons. The calculated phase keeps a solid "Current" badge; the selection uses an outline and an "Exploring" label. The panel shows the model's own rules for that phase (generated from `weights.ts`), how well today's data fits it, how many quarters since 2012 the model placed in it, median indicator readings in those quarters, and the existing educational asset-tendency copy labelled as general, not calculated. Selection is UI state only.
3. **Indicator cards** — collapsed: name, value, change vs. previous (arrow + signed delta), sparkline, status chip (icon + text: Supports / Mixed / Conflicts / No data), one data-driven sentence, period · source, stale/derived badges. Expanded (in-place, full row): labelled chart with axes and the model's low/high thresholds, current and previous with periods, rule for the current phase, fit / weight / contribution, method text, notes, source link, observation period, publication date and precision, retrieval time, data-quality warnings.
4. **Asset explorer** — chips for Shares, Residential property, Bonds, Cash & term deposits, Gold, Crypto; multi-select to compare. Shares and Cash show per-phase statistics from the stored series with dataset, period, n, and caveats. Others show "No historical dataset connected" and the data needed. No recommendations.
5. **What-if simulator** — sliders for GDP growth, inflation, unemployment, interest rate, consumer spending. Server re-scores with `assessCycle`; client shows baseline vs. scenario phase fits. Banner: hypothetical, not a forecast.
6. **Data freshness** — strip summarising newest/oldest observation periods, stale and missing counts; per card the observation period, publication date, retrieval time kept distinct.
7. **News** — one deduplicated list with topic filter chips (client-side), compact rows, summary only when it adds text beyond the headline, "Related indicator" line linking the topic to the current reading, "Show more", per-feed errors collapsed into one line.
8. **Phase history** — existing chart and table kept, collapsed under a heading.

## 5. Components

Reuse: `pageDataCache`, `usePageCacheValue`, `cycleLoad`, `formatAuckland`, `.panel`, `.card`, `.btn`, `.hero-card`, `.econ-page` theme tokens, phase colour classes.

Modify: `src/pages/EconomicCycle.tsx` (layout + loading only), `src/types/economy.ts`, `src/api/client.ts` (scenario call), `src/App.css` (econ section), `server/economy/view.ts`, `server/economy/scoring.ts` (expose confidence parts), `server/economy/phaseNews.ts` (topic id), `server/economy/countries.ts` (NZ markets search), `server/routes/economy.ts` (scenario route).

Create:
- `server/economy/insights.ts` — takeaways, rule descriptions, phase guide, freshness (pure)
- `server/economy/assetEvidence.ts` — shares and cash statistics by phase (pure)
- `server/economy/scenario.ts` — re-score a copy of the current inputs (pure)
- `src/lib/economyView.ts` — presentation helpers (status chips, deltas, news filters, scenario ranges)
- `src/components/economy/*` — `CycleOverview`, `PhaseExplorer`, `IndicatorCard`, `IndicatorChart`, `AssetExplorer`, `ScenarioSimulator`, `EconomyNews`, `PhaseHistory`

`src/components/PhaseNews.tsx` is replaced by `EconomyNews` (only the economy page used it).

## 6. Data and backend changes

- Additive payload fields only. No change to rules, weights, thresholds, confidence formula, tie-break, or stored tables.
- `CycleAssessment.confidenceDetail` exposes support, margin, coverage, raw value, and cap already used to compute confidence.
- `POST /api/economy/scenario` reads stored observations (`readObservations`), never calls a provider and never writes.
- News items gain `topicId`. NZ gets a "Markets" Google News search (one more feed in the same request).

## 7. Testing

- `server/economy/insights.test.ts`, `assetEvidence.test.ts`, `scenario.test.ts`: takeaways from fixtures, statuses, freshness, chaining maths, missing-data handling, scenario baseline equals the real assessment, inputs are not mutated (frozen), invalid overrides rejected.
- Extend `scoring.test.ts`: confidence detail reproduces confidence for every canonical fixture.
- Extend `view.test.ts`: new fields, stale/missing/derived flags.
- `src/lib/economyView.test.ts`: status mapping, change formatting, news filtering/dedupe, explorer state never alters the current phase.
- Existing `test:economy`, `test:page-cache`, `tsc -b`, `oxlint`, `vite build`.
- Browser check with the cached Playwright Chromium: desktop and 390 px mobile screenshots, console errors, request counts while switching filters and moving sliders.

## 8. Stages

1. This document.
2. Server insights + overview, phase explorer, indicator cards.
3. News redesign; asset explorer with shares and cash evidence.
4. Scenario simulator.
5. Tests, build, browser verification.

## 9. Risks

- Payload grows (phase guide, evidence). Bounded: 5 phases × 11 medians, ~60 quarters of shares/cash.
- Shares and interbank series are also scoring inputs. Per-phase statistics use the **following** quarter's share change to avoid reading the input back as an outcome, and still carry a circularity warning.
- Small samples: some phases have few quarters. Each statistic shows n; below 4 quarters the value is withheld.
- Latest-vintage history overstates how clear past phases were (already stated by the page).
- Adding an NZ markets feed adds one RSS request per news load (cached by the RSS client).
- No DOM test runner: interaction logic lives in pure helpers that are unit-tested; the rendered behaviour is checked in a real browser.

## 10. Verification (2026-10-11)

- `npx tsc -b`, `oxlint` on the touched files, `vite build`: clean.
- `npm run test:economy`, `test:economy-page`, `test:page-cache`, `test:news`: pass.
- Browser (Playwright + Chromium, throwaway account on a copy of the database): 1440 px desktop, 390 px mobile, 820 px tablet in dark mode. Checked: three takeaways render; "Why this phase?" opens with four signal groups; selecting another phase (mouse and keyboard) shows "Exploring" while the calculated phase and its "Now" badge stay unchanged; indicator cards expand and collapse; topic filters make no extra requests; news links open the original article in a new tab; a burst of slider moves sends one debounced `POST /scenario`; the stored cycle payload is identical before and after scenarios; no page-level horizontal overflow (the phase rail and the phase-history chart scroll inside their own containers on mobile); no console errors.
- In dev, `/cycle` and `/news` are each requested twice on first load. That is React `StrictMode` remounting; the first cycle request is aborted. Production builds make one of each.

Changes made during verification:

- "Related indicator" on a headline now requires the headline or summary to mention the topic. The topic alone only says which search returned the article, and it attached readings to unrelated political stories.
- Under "All", BBC world and politics items are listed after the economy topics.
- Mobile phase rail no longer clips the selected node; chart band labels moved clear of the latest point; asset-table subheadings wrap; an icon glyph that did not render was removed.

Not covered by automated tests: there is no DOM test runner, so rendered interactions are checked by the browser script above rather than in `npm test`.
