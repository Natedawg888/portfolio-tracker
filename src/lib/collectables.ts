/** Frontend helpers for collectable type / card_game slugs. */

export type CollectableTypeKind = 'mtg' | 'pokemon' | 'manual';

export type CollectableTypeDef = {
  id: string;
  title: string;
  kind: CollectableTypeKind;
  blurb?: string;
};

export const COLLECTABLE_PRESETS: CollectableTypeDef[] = [
  {
    id: 'mtg',
    title: 'MTG',
    kind: 'mtg',
    blurb: 'Magic: The Gathering · Scryfall → NZD',
  },
  {
    id: 'pokemon',
    title: 'Pokémon',
    kind: 'pokemon',
    blurb: 'Pokémon TCG · pokemontcg.io → NZD',
  },
  {
    id: 'other',
    title: 'Figurines / other',
    kind: 'manual',
    blurb: 'Manual appraisal NZD · optional photo',
  },
];

export function isApiCardGame(game: string | null | undefined): boolean {
  const g = (game ?? '').toLowerCase();
  return g === 'mtg' || g === 'pokemon';
}

export function isManualCollectableGame(game: string | null | undefined): boolean {
  return Boolean(game) && !isApiCardGame(game);
}

export function slugifyCollectableTypeId(raw: string): string | null {
  const s = String(raw ?? '')
    .trim()
    .toLowerCase()
    .replace(/\s+/g, '-')
    .replace(/[^a-z0-9_-]/g, '');
  if (!s || s.length > 40) return null;
  return s;
}

export function kindForGame(game: string | null | undefined): CollectableTypeKind {
  const g = (game ?? '').toLowerCase();
  if (g === 'mtg') return 'mtg';
  if (g === 'pokemon') return 'pokemon';
  return 'manual';
}

export function emptyMessageFor(def: CollectableTypeDef): string {
  if (def.kind === 'mtg') {
    return 'No MTG cards yet. Add by name/set or import a ManaBox / CSV export.';
  }
  if (def.kind === 'pokemon') {
    return 'No Pokémon cards yet. Add by name/set or import CSV.';
  }
  return `No ${def.title} items yet. Add with an appraised NZD value.`;
}

/** Infer type defs from existing holdings when settings are empty. */
export function inferTypesFromHoldings(
  games: Array<string | null | undefined>,
): CollectableTypeDef[] {
  const seen = new Set<string>();
  const out: CollectableTypeDef[] = [];
  for (const raw of games) {
    const id = slugifyCollectableTypeId(String(raw ?? '')) ?? (raw ? String(raw).toLowerCase() : '');
    if (!id || seen.has(id)) continue;
    seen.add(id);
    const preset = COLLECTABLE_PRESETS.find((p) => p.id === id);
    if (preset) {
      out.push(preset);
    } else {
      out.push({
        id,
        title: id.replace(/[-_]/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase()),
        kind: kindForGame(id),
        blurb: 'Manual appraisal NZD · optional photo',
      });
    }
  }
  return out;
}
