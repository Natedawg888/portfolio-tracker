# Real estate & Collectables

## Real estate (`real_estate`)
- Manual **property_value_nzd** (market/owned) and **mortgage_outstanding_nzd**.
- Equity = value − mortgage. Dashboard shows equity; gross in assets, mortgage reduces net worth.
- Optional **house photo** → `data/uploads/properties/` (`/api/uploads/…`).

## Collectables (`collectable`)

Portfolio shows **user-configured type tiles** (not forced MTG / Pokémon / figurines). Add only the types you care about via **+ Add type** (presets or custom). Empty unused presets stay omitted; empty configured types can be removed. Each tile opens a **centered scrollable modal** with that type’s items. Add / import lives in the modal. **MTG** tiles still get colour/rarity filters when `card_game=mtg`.

### Cards (`card_game` = `mtg` | `pokemon`)
- Lookup by **name / set / number / api_id** or **CSV bulk** (inside the type modal).
- Market price + card art from:
  - **Scryfall** (MTG) — `prices.usd` / foil → NZD via Frankfurter
  - **pokemontcg.io** (Pokémon) — TCGPlayer market → NZD via Frankfurter
- **No photo/vision pricing.** Never invent prices.
- **Colour / rarity** (MTG modal): stored from Scryfall `color_identity` + `rarity` on import/quote when missing. Filters: WUBRG + colourless (mana icons) and common / uncommon / rare / mythic.

CSV columns:

```
game,name,set,number,finish,quantity,cost_basis_nzd,notes,api_id
```

### Figurines / other (`card_game` = `other`)
- Manual **appraisalNzd** + optional **user photo** → `data/uploads/collectables/` (add from the Figurines/other modal).

### ManaBox CSV import

The same collectables CSV importer also accepts ManaBox exports unchanged. It maps:

- `Name` → card name
- `Set code` (preferred) or `Set name` → set
- `Collector number` → number
- `Foil` → finish (`foil` / `nonfoil`)
- `Quantity` → quantity
- `Scryfall ID` → API ID and automatically selects MTG
- `Purchase price` + `Purchase price currency` → NZD cost basis (live FX when the currency is not NZD)

`ManaBox ID`, condition, language, misprint, altered, and added metadata are retained in the holding notes. Rarity is stored on `card_rarity` (Scryfall preferred, else ManaBox CSV); colours on `card_colours`. The original compact format remains supported.
