# Precious metals spot → NZD

## Provider: Metals.Dev

- Site: https://metals.dev/
- Docs: https://metals.dev/docs
- Endpoint used: `GET https://api.metals.dev/v1/latest?api_key=…&currency=NZD&unit=toz`
- Metals: gold, silver, platinum, palladium
- Unit stored: troy ounce (`toz` / `oz_t`) as NZD per oz t
- **Display:** Value Search can switch NZD/oz t ↔ NZD/g (grams = ÷ 31.1034768). Conversion only — never invents prices.
- **NZD:** requested via `currency=NZD` so Metals.Dev returns prices already in NZD (their FX). We do **not** invent rates.
- Fallback only if the API returns USD despite the parameter: convert with [Frankfurter](https://api.frankfurter.dev) (ECB daily USD→NZD). If that fails, quote stays unavailable unless a last-good spot exists.

## Free API key

1. Sign up at https://metals.dev/ (free plan, no credit card; ~100 requests/month).
2. Open the Dashboard and copy your API key.
3. Add to project `.env` (gitignored):

```env
METALS_API_KEY=your_key_here
```

4. Restart `npm run dev` (or `dev:api`).
5. Portfolio → metal card → **Refresh value**, or Value search → **Refresh metal quotes**, or `POST /api/quotes/metals/refresh`.

Without `METALS_API_KEY`, quotes are `unavailable` / stubbed: Portfolio shows **cost only / —** for metal market value; Dashboard `metalsNzd` stays on cost basis.

## Quota / last-good

Free-tier error `1203` (quota exhausted) is common near month-end. Behaviour:

- Live call is backed off for **24 hours** after a quota error (protects the remaining — already zero — quota).
- Successful spots cache in memory for **6 hours**.
- **Last-good** Metals.Dev NZD/oz t (memory + `price_quotes`) is served as status `stale` when live fetch fails. Never invented.
- Unavailable/null responses **do not overwrite** a prior ok/stale price in `price_quotes`.

Upgrade at https://metals.dev/ or wait for the monthly free-tier reset for fresh live spots.

## Caching

Server caches Metals.Dev responses for **6 hours** in memory to respect the free quota. Force refresh clears the short cache but keeps last-good and quota backoff.

## Asset keys

Canonical quote key: `METAL:{gold|silver|platinum|palladium}:oz_t` (NZD per troy ounce).

Holdings in grams are valued as `amount_g / 31.1034768 × spot_nzd_per_oz_t`.

## Alternatives considered

| Source | Notes |
|--------|--------|
| metals-api.com | Freemium; NZD via `base` / convert; needs key |
| goldapi.io | Freemium; NZD listed; one request per metal |
| metals.dev | **Chosen** — free tier, one call for all metals + NZD |
| RBNZ FX + LBMA | RBNZ has no public metals API; FX-only wrappers need keys |
| NZ bullion dealer pages | Not used — avoid scraping; no passwords |

Never invent prices. Never scrape bank/dealer logins.
