# Precious stones — OpenFacet diamonds + manual other gems

## Policy

- **Never invent prices.** If OpenFacet or USD→NZD FX fails, valuation stays `null` and a message explains why.
- Always persist **source** + **as-of** (and notes) with any valuation.
- Live quotes are **diamond-only**. Ruby, sapphire, emerald, and other gems use a **manual estimated NZD** (`user_valuation`).

## Provider: OpenFacet (diamonds)

- Site: https://openfacet.net/
- MCP (preferred — interpolates): `POST https://mcp.openfacet.net/`
  - Headers: `Content-Type: application/json`, `MCP-Protocol-Version: 2026-07-28`, `Mcp-Method: tools/call`, `Mcp-Name: get_diamond_price`
  - Tool: `get_diamond_price` with `carat`, `color`, `clarity`, optional `shape`
- REST matrix (fallback / research): https://data.openfacet.net/matrix.json (may need a normal browser User-Agent)
- **No API key** required.
- Response: `per_carat_usd`, `total_usd`; `_meta.timestamp`, `_meta.source`
- Limits:
  - Carat: **0.3–6.0**
  - Colour: **D–M**
  - Clarity: **FL | IF | VVS1 | VVS2 | VS1 | VS2 | SI1 | SI2**
  - Shape (optional): round | cushion | radiant | emerald | oval | pear | marquise | heart (default **round**)

## FX → NZD

OpenFacet prices are **USD**. Convert with existing `convertToNzd` / Frankfurter (`server/quotes/fx.ts`). Never invent FX rates. If FX fails, the stone quote is `unavailable`.

## Caching

In-memory cache ~**1 hour** (`server/quotes/stones.ts`). OpenFacet updates ~daily. Force refresh on holding **Refresh value** or Value Search with `force` / `?refresh=1`.

## Asset keys

`STONE:diamond:{carat}:{color}:{clarity}:{shape}`  
Example: `STONE:diamond:1:G:VS2:round`

Stored on the holding: `valuation_nzd`, `valuation_source` (`openfacet` or `user_valuation`), `valuation_notes`, `last_valuation_at`. Also written to `price_quotes`.

## UI / API

- Portfolio → Add holdings → **Add precious stone**
- Portfolio → Precious stones → **Refresh value** (diamonds with 4Cs)
- Value Search → diamond quote form (preview, no holding)
- `GET/POST /api/quotes/stones/diamond`
- `GET /api/quotes/stones/status`

## Non-diamond gems

Require `valuationNzd` (manual estimate). Source `user_valuation`. Notes state there is no live gem API. Refresh does not overwrite with invented prices.

## Module

`server/quotes/stones.ts` — `quoteDiamondOpenFacet`, `isDiamondStoneType`, `stoneAssetKey`, helpers.
