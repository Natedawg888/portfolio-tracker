/**
 * Onboarding → Pick your budget categories. Pure helpers for the checklist.
 *
 * The starter categories are saved at signup, so the list starts from what is saved: each saved
 * category is a ticked row, and a starter category the user removed earlier comes back unticked.
 * Nothing changes until Continue: unticked saved categories are deleted then, ticked starter ones
 * that are missing are recreated (same slug, so the app still recognises them), and new ones are
 * created. Built-in categories (BUILT_IN_CATEGORIES) are always included and can't be unticked.
 *
 * Until Continue the choices are kept as a draft (what differs from the saved list), so a refresh
 * or signing in again shows them rather than the defaults.
 */
import { DEFAULT_CATEGORY_SEEDS } from './categoryDefaults';
import { BUILT_IN_CATEGORIES, isBuiltInCategory } from './categoryManagerView';
import { CATEGORY_TYPES, CATEGORY_TYPE_LABELS, normalizeCategoryType, type CategoryType } from './categoryTypes';

export type SavedCategory = { id: string; slug?: string; name: string; type: CategoryType; isIncome?: boolean; sortOrder: number };

export type PickRow = {
  key: string;
  name: string;
  type: CategoryType;
  ticked: boolean;
  /** Built in: always included. */
  locked: boolean;
  /** For locked rows: "Used for debt repayments". */
  reason: string | null;
  /** saved: in the database now · starter: a starter category not saved (removed earlier) · new: added on this page. */
  source: 'saved' | 'starter' | 'new';
  id?: string;
  slug?: string;
  sortOrder: number;
};

export type PickDraft = {
  /** Saved categories the user unticked. */
  unticked: string[];
  /** Starter categories (not saved) the user ticked. */
  ticked: string[];
  /** Added on this page and still ticked. */
  added: { name: string; type: CategoryType }[];
};

const NEW_SORT = 1000;

export function lockReason(slug: string | null | undefined): string | null {
  if (!isBuiltInCategory(slug)) return null;
  const what = BUILT_IN_CATEGORIES[slug as string];
  return `Used for ${what}.`;
}

const newKey = (type: CategoryType, name: string) => `new:${type}:${name.trim().toLowerCase()}`;

function sortRows(rows: PickRow[]): PickRow[] {
  return [...rows].sort((a, b) => a.sortOrder - b.sortOrder || a.name.localeCompare(b.name));
}

/** The checklist: saved categories, removed starter ones, and the draft on top. */
export function buildRows(saved: SavedCategory[], draft?: PickDraft | null): PickRow[] {
  const unticked = new Set(draft?.unticked ?? []);
  const reticked = new Set(draft?.ticked ?? []);
  const rows: PickRow[] = saved.map((c) => {
    const key = `id:${c.id}`;
    const locked = isBuiltInCategory(c.slug);
    return {
      key,
      name: c.name,
      type: normalizeCategoryType(c.type, c.isIncome),
      ticked: locked || !unticked.has(key),
      locked,
      reason: lockReason(c.slug),
      source: 'saved',
      id: c.id,
      slug: c.slug,
      sortOrder: c.sortOrder,
    };
  });
  const savedSlugs = new Set(saved.map((c) => c.slug).filter(Boolean));
  for (const seed of DEFAULT_CATEGORY_SEEDS) {
    if (savedSlugs.has(seed.slug)) continue;
    const key = `seed:${seed.slug}`;
    const locked = isBuiltInCategory(seed.slug);
    rows.push({
      key,
      name: seed.name,
      type: seed.type,
      ticked: locked || reticked.has(key),
      locked,
      reason: lockReason(seed.slug),
      source: 'starter',
      slug: seed.slug,
      sortOrder: seed.sortOrder,
    });
  }
  let n = 0;
  for (const a of draft?.added ?? []) {
    if (!CATEGORY_TYPES.includes(a.type) || !a.name?.trim()) continue;
    if (rows.some((r) => r.key === newKey(a.type, a.name))) continue;
    rows.push({ key: newKey(a.type, a.name), name: a.name.trim(), type: a.type, ticked: true, locked: false, reason: null, source: 'new', sortOrder: NEW_SORT + n++ });
  }
  return sortRows(rows);
}

export function toggleRow(rows: PickRow[], key: string): PickRow[] {
  return rows.map((r) => (r.key === key && !r.locked ? { ...r, ticked: !r.ticked } : r));
}

/**
 * Add a category to a tab, ticked. A name already in that tab is ticked instead of added twice.
 * Returns a message when nothing could be added.
 */
export function addRow(rows: PickRow[], type: CategoryType, rawName: string): { rows: PickRow[]; message: string | null; key: string | null } {
  const name = rawName.trim().replace(/\s+/g, ' ');
  if (!name) return { rows, message: null, key: null };
  if (name.length > 80) return { rows, message: 'Use 80 characters or fewer.', key: null };
  const same = rows.find((r) => r.type === type && r.name.toLowerCase() === name.toLowerCase());
  if (same) {
    if (same.ticked) return { rows, message: `“${same.name}” is already in ${CATEGORY_TYPE_LABELS[type]}.`, key: same.key };
    return { rows: rows.map((r) => (r.key === same.key ? { ...r, ticked: true } : r)), message: null, key: same.key };
  }
  const elsewhere = rows.find((r) => r.type !== type && r.name.toLowerCase() === name.toLowerCase() && r.ticked);
  if (elsewhere) return { rows, message: `“${elsewhere.name}” is already in ${CATEGORY_TYPE_LABELS[elsewhere.type]}.`, key: null };
  const last = rows.reduce((m, r) => Math.max(m, r.sortOrder), NEW_SORT - 1);
  const key = newKey(type, name);
  return { rows: [...rows, { key, name, type, ticked: true, locked: false, reason: null, source: 'new', sortOrder: Math.max(NEW_SORT, last + 1) }], message: null, key };
}

/** Keep the starter set: everything saved and every starter category ticked; nothing new. */
export function withDefaults(rows: PickRow[]): PickRow[] {
  return rows.filter((r) => r.source !== 'new').map((r) => ({ ...r, ticked: true }));
}

/** What differs from the saved list, to keep until Continue. */
export function draftFromRows(rows: PickRow[]): PickDraft {
  return {
    unticked: rows.filter((r) => r.source === 'saved' && !r.ticked).map((r) => r.key),
    ticked: rows.filter((r) => r.source === 'starter' && r.ticked).map((r) => r.key),
    added: rows.filter((r) => r.source === 'new' && r.ticked).map((r) => ({ name: r.name, type: r.type })),
  };
}

export function isEmptyDraft(d: PickDraft): boolean {
  return d.unticked.length === 0 && d.ticked.length === 0 && d.added.length === 0;
}

export type SavePlan = {
  remove: { id: string; name: string }[];
  create: { name: string; type: CategoryType; slug?: string; id?: string; sortOrder?: number }[];
};

/** The calls Continue makes. A recreated starter category keeps its slug, so the app still finds it. */
export function savePlan(rows: PickRow[]): SavePlan {
  return {
    remove: rows.filter((r) => r.source === 'saved' && !r.ticked && !r.locked && r.id).map((r) => ({ id: r.id as string, name: r.name })),
    create: rows
      .filter((r) => r.source !== 'saved' && r.ticked)
      .map((r) =>
        r.source === 'starter'
          ? { name: r.name, type: r.type, slug: r.slug, id: r.slug, sortOrder: r.sortOrder }
          : { name: r.name, type: r.type },
      ),
  };
}

export const tickedCount = (rows: PickRow[], type?: CategoryType) => rows.filter((r) => r.ticked && (!type || r.type === type)).length;

/** Parse a stored draft; anything malformed is ignored. */
export function parseDraft(raw: string | null): PickDraft | null {
  if (!raw) return null;
  try {
    const o = JSON.parse(raw) as Partial<PickDraft>;
    const strings = (v: unknown) => (Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string') : []);
    const added = Array.isArray(o.added)
      ? o.added.filter((a): a is { name: string; type: CategoryType } => Boolean(a) && typeof a.name === 'string' && CATEGORY_TYPES.includes(a.type))
      : [];
    return { unticked: strings(o.unticked), ticked: strings(o.ticked), added };
  } catch {
    return null;
  }
}
