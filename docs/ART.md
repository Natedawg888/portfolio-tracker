# Art holdings

Manual entry only. **Masterworks has no public developer API** — do not scrape or call private GraphQL with user tokens. Never invent valuations.

## Modes

### Fractional (`artKind: fractional`)
Masterworks-style share of an artwork.

| Field | Notes |
|-------|--------|
| `artworkTitle` / `artist` | Required title; artist optional |
| `ownershipPct` | 0–100 (exclusive of 0) |
| `purchasePriceNzd` / `purchaseDate` | Required |
| `lastValuationNzd` | Optional manual (e.g. copied from Masterworks UI) |
| `notes` / `externalId` | Optional platform label / id |

**Value shown** = `lastValuationNzd` if set, else `purchasePriceNzd` (same as net-worth `art` bucket).

### Physical (`artKind: physical`)
Owned piece.

| Field | Notes |
|-------|--------|
| `artworkTitle` / `artist` | Required title; artist optional |
| `ownershipPct` | Defaults to 100 |
| `appraisalNzd` | **Required** → stored as `lastValuationNzd` with `valuation_source=user_valuation` |
| `purchasePriceNzd` / `purchaseDate` | Optional cost |
| `photoBase64` | Optional → `data/uploads/art/` (`photoUrl` on card) |

## Editing
Holding cards support editing appraisal / latest valuation (and for fractional: ownership %, purchase price/date). Updates go through `PATCH /api/holdings/:id`. Changing appraisal stamps `last_valuation_at`. User-entered only — never invent.

## Photos
`POST /api/holdings/:id/photo` accepts art (same pattern as real estate / manual collectables).

## Schema
`art_kind` column (`fractional` | `physical`) via sql.js migrate. Photos use shared `photo_path`.
