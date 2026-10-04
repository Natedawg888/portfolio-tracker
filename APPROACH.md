# Economic Cycle — approach

Educational, informational view of the New Zealand economic phase. It does not give personal financial advice and does not tell anyone to buy, sell, or hold an investment.

## What already existed

Portfolio Tracker is a local-first NZD net-worth app: Vite + React, Express, sql.js SQLite (`data/portfolio.db`). Finance rows are per user. Macro statistics are not user data and are not a second database.

Nothing in the repo already classifies an economic phase, stores official macro series, or renders that dashboard. Quotes, holdings, KiwiSaver, and Akahu stay untouched.

## Shape

Data and presentation are split.

- `server/economy/weights.ts` — phase rules, indicator thresholds, and score anchors. Change these without rewriting the feature.
- `server/economy/scoring.ts` — pure, deterministic classification. No clock, no network, no database.
- `server/economy/providers/` — country data behind one interface. New Zealand is the first implementation. A later country is another provider, not a fork of the scorer.
- `server/economy/service.ts` — fetch or reuse stored observations, score, persist.
- `src/pages/EconomicCycle.tsx` — renders the API payload. It does not score.

Later modules (not in this PR) can call the same scorer:

- news: attach sourced headlines beside a phase
- portfolio exposure: map the signed-in user's holdings onto the asset-class context
- scenario simulator: call `assessCycle` with a user-supplied indicator set

Those seams are named in `server/economy/extensions.ts` and are not implemented.

## Phase model

Five phases, in cycle order: Recovery, Expansion, Late Expansion, Slowdown, Recession. A later quarter can move from Recession back to Recovery when the indicators say so. There is no timer and no manually assigned phase.

Each indicator is placed in a bucket (`low`, `moderate`, `high`) and a change (`falling`, `stable`, `rising`) using the thresholds in `weights.ts`. Each phase lists rules: indicator, weight, and the buckets and/or changes that fit that phase. A rule counts only when every stated condition matches (logical and). A missing previous value makes the change clause uncertain (half credit) rather than a match.

The phase score is the weight-averaged fit of the rules whose indicators are actually present. The current phase is the highest score. Ties break by total matched weight, then by a fixed order, so the result does not depend on object key order.

Outputs:

- **Overall score** — blend of phase anchors from -100 (recession-like) to +100 (strong expansion). It summarises the mix. It is not a forecast.
- **Confidence** — how strongly the available indicators support the winning phase: agreement, margin over the next phase, and how many of the catalogued indicators were present. Thin coverage is capped. Confidence is not a probability that the phase will continue.
- **Indicator score** — that indicator's fit to the winning phase, 0–100.
- **Contribution** — weight times fit, so a heavy indicator is visible.
- **Direction** — up, down, or flat versus the previous observation of the same series.
- **Momentum** — strengthening, weakening, or steady, from the activity indicators only (GDP, unemployment, employment, spending, business activity, housing). Unemployment rising counts as weakening.
- **Previous phase** — the prior quarter's independent classification from the same series, not a stored label.

## Persistence

Tables in the existing SQLite file:

- `economic_indicators` — one row per country, indicator, period, and provider. Value, unit, period, previous value, source, source URL, published time, published-time precision, retrieved time, provider kind.
- `economic_cycle_assessments` — phase, score, confidence, momentum, previous phase, as-of quarter.
- `economic_indicator_scores` — score, direction, and contribution for the current assessment.
- `economic_fetch_log` — when the provider last succeeded, so a page view does not re-download large extracts on every request.

Macro rows have no `user_id`. The page and API still sit behind the existing sign-in gate.

## New Zealand provider

`nz-public` is the default. It is provider-agnostic at the boundary: `EconomicDataProvider.fetch()` returns observations. The scorer never imports Stats NZ or OECD.

Wired feeds (no API key, no secrets):

| Indicator | Source | Series |
| --- | --- | --- |
| GDP growth | Stats NZ CSV, discovered from the public catalogue (URL is not hard-coded to a quarter) | Production GDP, chain volume, seasonally adjusted, quarterly percent change (`SNEQ.SG01RSC01B01PC`) |
| Inflation | Stats NZ CPI Infoshare file for the latest quarter, plus OECD CPI annual growth for earlier quarters | All-groups CPI, percent change from the same quarter a year earlier |
| Unemployment | OECD, national labour-force survey | Seasonally adjusted unemployment rate, ages 15+ |
| Employment growth | Stats NZ employment indicators | Filled jobs, all industries, seasonally adjusted. This app calculates the annual percent change from the level series and says so |
| Consumer spending | Stats NZ retail trade survey | All industries, deflated, seasonally adjusted, percent change from the previous quarter |
| Interest rates | OECD financial markets | Call-money / interbank rate, percent per annum. This is not the RBNZ Official Cash Rate table |
| Yield curve | OECD financial markets | Long-term rate minus short-term rate, percentage points, calculated here |
| Share market | OECD share-price index | Percent change over three months, calculated here |
| Housing activity | Stats NZ building consents, monthly workbook (about 180 KB), not the regional CSV | Number of new dwellings consented, all dwellings, seasonally adjusted (`BLDM.SFTZ1100A1S`). This app calculates the annual percent change from the count and says so |
| Business activity | OECD business tendency surveys | Production tendency, percentage balance. This app shows 50 plus half that balance, so 50 is the published neutral point. It is not a branded PMI |

Not wired, and left blank rather than filled in:

- Credit conditions — the Reserve Bank credit conditions survey is the official New Zealand series. `rbnz.govt.nz` returns HTTP 403, so the card stays blank instead of using a stand-in

`ECONOMY_PROVIDER=sample` switches to a fixture provider. Those rows are labelled sample, use old periods, and are marked stale. The default path never substitutes them when a live fetch fails.

Every point stores source, period, published time, and retrieved time. If a file has no publication timestamp, `published_at` is the period end and `published_at_precision` is `period_end`, and the UI says so. Stats NZ release pages supply a real release date when the catalogue title maps to an information-release page. "Last updated" is the retrieved time of the extract actually used.

The phase is as of the latest completed quarter in Pacific/Auckland. Each indicator contributes its latest observation on or before that quarter end. Quarters do not all share one period; each card shows its own period. A print older than the lag allowed for its frequency is marked stale and is not described as a current figure.

The history chart replays the latest vintage of each series (revisions included). It is not a real-time record of what the phase would have been on first release. The page says that.

## Asset-class context

Static copy per phase for equities, property, bonds, cash / term deposits, and commodities. Each row is a historical tendency (positive, neutral, or negative) plus a neutral explanation. Tests reject advice wording such as buy, sell, hold, or "move your money".

## Countries

New Zealand is the default. The United States is the second connected country. The list lives in `server/economy/countries.ts`. A further country needs a registry row and a provider that returns observations for that code; the page renders whatever the API lists.

US figures come from OECD SDMX (key economic indicators, the share-price index, and the production tendency), which republishes national series, from the Census Bureau housing-starts workbook, and from the Federal Reserve Senior Loan Officer Opinion Survey. Housing activity is the annual percent change in housing starts, calculated here. Business activity uses the same diffusion index as New Zealand. Credit conditions are the net percentage of banks easing standards, calculated as the negative of the published net-tightening figure. Related news for the US searches Federal Reserve rates, GDP, inflation, unemployment, housing, and markets, and still includes BBC world and politics. The New Zealand news searches are unchanged.

## Related news

Under the indicator cards, the page loads headlines with the same RSS client as the holdings news module (`server/news`): Google News searches for central-bank rates, GDP, inflation, unemployment, housing, and the global economy, plus BBC world and politics. The calculated phase adds one New Zealand search using the phase name. Items keep the feed’s headline, publication, date, description, and link. A failed feed is an error with no articles. Portfolio exposure and the scenario simulator are still not built.

## Tests

`npm run test:economy` runs the scoring tests, period alignment, the advice-language check, and the sample-provider label. Scoring tests were written against the public function before the calculation was filled in. They cover the five canonical stories, confidence under thin data, deterministic repeats, weight overrides, tie-break, and quarter-to-quarter previous phase.

## Risks and limits

- Stats NZ catalogue HTML and series ids can change. A missed series becomes a blank card and a lower confidence, not a made-up number.
- OECD republishes national data and can lag or revise. The card names OECD when that is the source. Downloads use Node's `https` client: the global `fetch` implementation receives HTTP 500 from `sdmx.oecd.org` for the same CSV URLs.
- The interbank rate is not the OCR. An RBNZ table provider can replace that series later without a scoring change.
- Derived percent changes (employment, shares, yield spread) are arithmetic on official levels, labelled as calculated here.
- Latest-vintage history overstates how obvious a phase was at the time.
- Thresholds are a documented starting point for New Zealand, not a structural model of the economy.
- First load downloads the GDP CSV (about 20 MB) and smaller extracts. Later loads reuse SQLite until `ECONOMY_CACHE_HOURS` (default 12) or `?refresh=1`.
