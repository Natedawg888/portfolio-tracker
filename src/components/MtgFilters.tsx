import type { MtgColour } from '../types';

export type MtgColourFilter = MtgColour | 'C';
export type MtgRarityFilter = 'common' | 'uncommon' | 'rare' | 'mythic';

export const MTG_COLOUR_FILTERS: MtgColourFilter[] = ['W', 'U', 'B', 'R', 'G', 'C'];
export const MTG_RARITY_FILTERS: MtgRarityFilter[] = ['common', 'uncommon', 'rare', 'mythic'];

const MANA_FILL: Record<MtgColourFilter, string> = {
  W: '#f8f6d8',
  U: '#0e68ab',
  B: '#150b00',
  R: '#d3202a',
  G: '#00733e',
  C: '#bbb4a8',
};

const MANA_STROKE: Record<MtgColourFilter, string> = {
  W: '#9e9a70',
  U: '#0a4f82',
  B: '#4a4038',
  R: '#9a181f',
  G: '#005a30',
  C: '#8a8478',
};

const MANA_GLYPH: Record<MtgColourFilter, string> = {
  W: '#5a5430',
  U: '#ffffff',
  B: '#ffffff',
  R: '#ffffff',
  G: '#ffffff',
  C: '#3a3830',
};

/** Compact WUBRG / colourless mana pip (SVG). */
export function ManaIcon({
  colour,
  size = 18,
  title,
}: {
  colour: MtgColourFilter;
  size?: number;
  title?: string;
}) {
  const label =
    title ??
    (colour === 'C'
      ? 'Colourless'
      : colour === 'W'
        ? 'White'
        : colour === 'U'
          ? 'Blue'
          : colour === 'B'
            ? 'Black'
            : colour === 'R'
              ? 'Red'
              : 'Green');
  const glyph =
    colour === 'W'
      ? 'W'
      : colour === 'U'
        ? 'U'
        : colour === 'B'
          ? 'B'
          : colour === 'R'
            ? 'R'
            : colour === 'G'
              ? 'G'
              : '◇';
  return (
    <svg
      className="mana-icon"
      width={size}
      height={size}
      viewBox="0 0 24 24"
      aria-hidden={title ? undefined : true}
      role={title ? 'img' : undefined}
      aria-label={title ? label : undefined}
    >
      {title ? <title>{label}</title> : null}
      <circle cx="12" cy="12" r="11" fill={MANA_FILL[colour]} stroke={MANA_STROKE[colour]} strokeWidth="1.5" />
      <text
        x="12"
        y="12.5"
        textAnchor="middle"
        dominantBaseline="central"
        fill={MANA_GLYPH[colour]}
        fontSize={colour === 'C' ? 11 : 12}
        fontWeight="700"
        fontFamily="system-ui, sans-serif"
      >
        {glyph}
      </text>
    </svg>
  );
}

export function rarityLabel(rarity: string): string {
  const s = rarity.trim().toLowerCase();
  if (s === 'mythic') return 'Mythic';
  if (s === 'rare') return 'Rare';
  if (s === 'uncommon') return 'Uncommon';
  if (s === 'common') return 'Common';
  return rarity;
}

type HoldingLike = {
  cardGame?: string | null;
  cardColours?: MtgColour[] | null;
  cardRarity?: string | null;
};

/** OR across selected colours; colourless matches empty identity. Empty selection = pass. */
export function matchesMtgColourFilters(
  h: HoldingLike,
  selected: Set<MtgColourFilter>,
): boolean {
  if (selected.size === 0) return true;
  // Colour filters only apply to MTG; Pokémon / other items stay visible.
  if ((h.cardGame ?? '').toLowerCase() !== 'mtg') return true;
  const colours = h.cardColours;
  if (colours == null) return false;
  if (selected.has('C') && colours.length === 0) return true;
  return colours.some((c) => selected.has(c));
}

/** OR across selected rarities. Empty selection = pass. */
export function matchesMtgRarityFilters(
  h: HoldingLike,
  selected: Set<MtgRarityFilter>,
): boolean {
  if (selected.size === 0) return true;
  // Rarity filters only apply to MTG; Pokémon / other items stay visible.
  if ((h.cardGame ?? '').toLowerCase() !== 'mtg') return true;
  const r = (h.cardRarity ?? '').toLowerCase();
  if (!r) return false;
  return selected.has(r as MtgRarityFilter);
}

export function MtgFilterBar({
  colourFilters,
  rarityFilters,
  onToggleColour,
  onToggleRarity,
  onClear,
  matchCount,
  totalCount,
}: {
  colourFilters: Set<MtgColourFilter>;
  rarityFilters: Set<MtgRarityFilter>;
  onToggleColour: (c: MtgColourFilter) => void;
  onToggleRarity: (r: MtgRarityFilter) => void;
  onClear: () => void;
  matchCount: number;
  totalCount: number;
}) {
  const active = colourFilters.size > 0 || rarityFilters.size > 0;
  return (
    <div className="mtg-filters" role="group" aria-label="MTG card filters">
      <div className="mtg-filter-row">
        <span className="muted small mtg-filter-label">Colour</span>
        <div className="mtg-filter-chips">
          {MTG_COLOUR_FILTERS.map((c) => {
            const on = colourFilters.has(c);
            return (
              <button
                key={c}
                type="button"
                className={`mtg-filter-chip${on ? ' active' : ''}`}
                aria-pressed={on}
                title={
                  c === 'C'
                    ? 'Colourless'
                    : c === 'W'
                      ? 'White'
                      : c === 'U'
                        ? 'Blue'
                        : c === 'B'
                          ? 'Black'
                          : c === 'R'
                            ? 'Red'
                            : 'Green'
                }
                onClick={() => onToggleColour(c)}
              >
                <ManaIcon colour={c} size={16} />
              </button>
            );
          })}
        </div>
      </div>
      <div className="mtg-filter-row">
        <span className="muted small mtg-filter-label">Rarity</span>
        <div className="mtg-filter-chips">
          {MTG_RARITY_FILTERS.map((r) => {
            const on = rarityFilters.has(r);
            return (
              <button
                key={r}
                type="button"
                className={`mtg-filter-chip rarity rarity-${r}${on ? ' active' : ''}`}
                aria-pressed={on}
                onClick={() => onToggleRarity(r)}
              >
                {rarityLabel(r)}
              </button>
            );
          })}
        </div>
      </div>
      {active && (
        <div className="mtg-filter-row mtg-filter-status">
          <span className="muted small">
            Showing {matchCount} of {totalCount}
          </span>
          <button type="button" className="btn ghost small" onClick={onClear}>
            Clear filters
          </button>
        </div>
      )}
    </div>
  );
}
