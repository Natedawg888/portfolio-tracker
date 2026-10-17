/**
 * Transaction categories: one tab per type, a row per category with its colour, this month's
 * total, Rename and a ⋯ menu (Move to another type, Delete). Colours save on pick. Deleting a
 * category that is in use asks which category of the same type gets its transactions and plans;
 * nothing is lost, and a clash with that category's plans is refused rather than merged.
 * Used in Settings and in the Budget page's "Manage categories" dialog.
 */
import { useCallback, useEffect, useMemo, useRef, useState, type CSSProperties } from 'react';
import { ApiError, api, formatNzd } from '../api/client';
import { beginPageRead, commitPageRead, invalidateFinancial, readPageCache } from '../lib/pageDataCache';
import { CATEGORY_TYPES, CATEGORY_TYPE_LABELS, normalizeCategoryType, type CategoryType } from '../lib/categoryTypes';
import { CATEGORY_PALETTE, CATEGORY_PALETTE_NAMES, categoryColourFor, paletteName, validColour } from '../lib/categoryColours';
import { aggregateCategorySpend, type ChartDebtRepayment, type ChartTransaction } from './CategorySpendChart';
import { monthEnd, monthStart, todayAucklandYmd } from '../lib/period';
import { isBuiltInCategory, monthTotalText, TYPE_EXPLAINER, usageText, type UsageCounts } from '../lib/categoryManagerView';
import { showQuietToast } from '../lib/quietToast';
import { MoreMenu } from './MoreMenu';
import { CategoryAddField, CategoryTabPanel, CategoryTabs } from './categories/CategoryParts';

export type ManagedCategory = {
  id: string;
  /** Well-known key (cat-income, cat-debt, …); built-in ones can't be moved or deleted. */
  slug?: string;
  name: string;
  parentId: string | null;
  colour: string | null;
  type: CategoryType;
  isIncome: boolean;
  sortOrder: number;
};

const CACHE_KEY = 'categories';

function errorText(err: unknown, fallback: string): string {
  return err instanceof ApiError ? err.message : fallback;
}
const toast = (message: string, kind: 'info' | 'warn' = 'info') => showQuietToast(message, { kind, ttlMs: kind === 'warn' ? 6000 : 4000 });

type MonthData = { txns: ChartTransaction[]; repayments: ChartDebtRepayment[]; income: Map<string, number> };

function useThisMonth() {
  const [month] = useState(() => {
    const [y, m] = todayAucklandYmd().split('-').map(Number);
    const ym = { year: y, month: m };
    const short = new Intl.DateTimeFormat('en-NZ', { month: 'short', timeZone: 'UTC' }).format(new Date(Date.UTC(y, m - 1, 1)));
    return { from: monthStart(ym), to: monthEnd(ym), key: `${y}-${String(m).padStart(2, '0')}`, short };
  });
  return month;
}

export function CategoryManager({ onChanged }: { onChanged?: () => void | Promise<void> }) {
  const [categories, setCategories] = useState<ManagedCategory[]>(() => readPageCache<ManagedCategory[]>(CACHE_KEY) ?? []);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [tab, setTab] = useState<CategoryType>('spending');
  const [renamingId, setRenamingId] = useState<string | null>(null);
  const [paletteId, setPaletteId] = useState<string | null>(null);
  const [deleting, setDeleting] = useState<{ cat: ManagedCategory; usage: UsageCounts; target: string; error?: string } | null>(null);
  const [monthData, setMonthData] = useState<MonthData | null>(null);
  const month = useThisMonth();

  const load = useCallback(async () => {
    const stamp = beginPageRead(CACHE_KEY);
    try {
      const rows = await api.budgets.categories();
      if (!commitPageRead(stamp, rows)) return;
      setCategories(rows);
      setLoadError(null);
    } catch (err) {
      setLoadError(errorText(err, 'Could not load categories'));
    }
  }, []);

  const loadMonth = useCallback(async () => {
    try {
      const [txns, repayments, income] = await Promise.all([
        api.accounts.transactions(month.from, month.to),
        api.debts.repayments({ from: month.from, to: month.to }).catch(() => []),
        api.income.summary(month.key).catch(() => null),
      ]);
      setMonthData({
        txns: txns as ChartTransaction[],
        repayments: repayments as ChartDebtRepayment[],
        income: new Map((income?.categories ?? []).map((c) => [c.categoryId, c.actualNzd])),
      });
    } catch {
      // Rows still work; the month totals just stay out.
    }
  }, [month]);

  useEffect(() => {
    void load();
    void loadMonth();
  }, [load, loadMonth]);

  /** This month's spend per category, counted the way the Budget page counts it. */
  const spend = useMemo(() => {
    const out = new Map<string, number>();
    if (!monthData) return out;
    for (const r of aggregateCategorySpend(monthData.txns, categories, month.from, month.to, monthData.repayments)) {
      if (r.categoryId) out.set(r.categoryId, r.spend);
    }
    return out;
  }, [monthData, categories, month]);

  async function run(action: () => Promise<string>, fallback: string): Promise<boolean> {
    setBusy(true);
    try {
      const note = await action();
      invalidateFinancial('categories', 'spending', 'dashboard');
      await load();
      await onChanged?.();
      toast(note);
      return true;
    } catch (err) {
      toast(errorText(err, fallback), 'warn');
      return false;
    } finally {
      setBusy(false);
    }
  }

  const typeOf = (c: ManagedCategory) => normalizeCategoryType(c.type, c.isIncome);
  const byType = (t: CategoryType) => categories.filter((c) => typeOf(c) === t);
  const rows = byType(tab);

  const patch = (c: ManagedCategory, body: { name?: string; type?: CategoryType; colour?: string | null }) =>
    api.budgets.updateCategory(c.id, { name: body.name ?? c.name, type: body.type ?? typeOf(c), colour: body.colour !== undefined ? body.colour : c.colour });

  /** Close the palette and put focus back on the category's swatch (once it is enabled again). */
  const refocus = useRef<string | null>(null);
  function closePalette(id: string) {
    refocus.current = id;
    setPaletteId(null);
  }
  useEffect(() => {
    if (!refocus.current || busy || paletteId) return;
    document.getElementById(`cat-swatch-${refocus.current}`)?.focus();
    refocus.current = null;
  }, [busy, paletteId]);


  async function pickColour(c: ManagedCategory, colour: string | null) {
    closePalette(c.id);
    await run(async () => {
      await patch(c, { colour });
      return colour ? `${c.name} is now ${paletteName(colour) ?? 'that colour'}` : `${c.name} uses the automatic colour`;
    }, 'Could not save the colour');
  }

  async function moveType(c: ManagedCategory, type: CategoryType) {
    const budget =
      type === 'spending' ? ' It will start counting toward your budget.' : typeOf(c) === 'spending' ? ' It will stop counting toward your budget.' : '';
    const message = `Move “${c.name}” to ${CATEGORY_TYPE_LABELS[type]}? Its transactions and plans stay with it and count as ${CATEGORY_TYPE_LABELS[type].toLowerCase()} from now on.${budget}`;
    if (!window.confirm(message)) return;
    await run(async () => {
      await patch(c, { type });
      return `Moved “${c.name}” to ${CATEGORY_TYPE_LABELS[type]}`;
    }, 'Could not move the category');
  }

  async function startDelete(c: ManagedCategory) {
    setPaletteId(null);
    setRenamingId(null);
    let usage: UsageCounts & { total: number };
    try {
      usage = await api.budgets.categoryUsage(c.id);
    } catch (err) {
      toast(errorText(err, 'Could not check what uses this category'), 'warn');
      return;
    }
    if (usage.total === 0) {
      if (!window.confirm(`Delete “${c.name}”? Nothing uses it.`)) return;
      await run(async () => {
        await api.budgets.deleteCategory(c.id);
        return `Deleted “${c.name}”`;
      }, 'Could not delete the category');
      return;
    }
    const fallback = categories.find((x) => x.id !== c.id && typeOf(x) === typeOf(c));
    if (!fallback) {
      toast(`Add another ${CATEGORY_TYPE_LABELS[typeOf(c)].toLowerCase()} category first, so what uses “${c.name}” has somewhere to go.`, 'warn');
      return;
    }
    setDeleting({ cat: c, usage, target: fallback.id });
  }

  async function confirmDelete() {
    if (!deleting) return;
    const { cat, target } = deleting;
    const into = categories.find((x) => x.id === target);
    setBusy(true);
    try {
      await api.budgets.deleteCategory(cat.id, target);
    } catch (err) {
      // A plan clash (or anything else) stays in the panel, next to the choice that caused it.
      setDeleting({ ...deleting, error: errorText(err, 'Could not delete the category') });
      setBusy(false);
      return;
    }
    setBusy(false);
    setDeleting(null);
    await run(async () => `Deleted “${cat.name}”. Everything moved to “${into?.name ?? 'the other category'}”`, 'Could not refresh the categories');
    void loadMonth();
  }

  function selectTab(t: CategoryType) {
    setTab(t);
    setPaletteId(null);
    setRenamingId(null);
    setDeleting(null);
  }

  return (
    <div className="category-manager">
      <CategoryTabs
        tab={tab}
        onSelect={selectTab}
        counts={{ spending: byType('spending').length, income: byType('income').length, transfer_out: byType('transfer_out').length, transfer_in: byType('transfer_in').length }}
      />

      <CategoryTabPanel tab={tab}>
        <p className="muted small cat-explainer">{TYPE_EXPLAINER[tab]}</p>
        {loadError ? <p className="auth-error" role="alert">{loadError}</p> : null}

        <ul className="cat-rows">
          {rows.map((c) => {
            const saved = validColour(c.colour);
            const shown = categoryColourFor(categories, c.id);
            const auto = categoryColourFor(categories.map((x) => (x.id === c.id ? { ...x, colour: null } : x)), c.id);
            const total = tab === 'spending' ? spend.get(c.id) : tab === 'income' ? monthData?.income.get(c.id) : undefined;
            const colourName = saved ? (paletteName(saved) ?? 'custom') : `Auto, ${paletteName(auto) ?? 'automatic'}`;
            return (
              <li key={c.id} className="cat-row-wrap">
                <div className="cat-row">
                  <button
                    type="button"
                    id={`cat-swatch-${c.id}`}
                    className="cat-swatch"
                    style={{ '--swatch': shown } as CSSProperties}
                    aria-label={`Colour for ${c.name}: ${colourName}`}
                    title={`Colour: ${colourName}`}
                    aria-expanded={paletteId === c.id}
                    disabled={busy}
                    onClick={() => {
                      setRenamingId(null);
                      setPaletteId((p) => (p === c.id ? null : c.id));
                    }}
                  />

                  {renamingId === c.id ? (
                    <RenameForm
                      category={c}
                      busy={busy}
                      onCancel={() => setRenamingId(null)}
                      onSave={async (name) => {
                        const ok = await run(async () => {
                          await patch(c, { name });
                          return `Renamed to “${name}”`;
                        }, 'Could not rename the category');
                        if (ok) setRenamingId(null);
                      }}
                    />
                  ) : (
                    <>
                      <div className="cat-row-main">
                        <span className="cat-row-name">{c.name}</span>
                        {tab === 'spending' || tab === 'income' ? (
                          <span className="cat-row-sub">{monthData ? monthTotalText(total, month.short, formatNzd) : '…'}</span>
                        ) : null}
                      </div>
                      <button
                        type="button"
                        className="btn small ghost cat-rename"
                        disabled={busy}
                        aria-label={`Rename ${c.name}`}
                        onClick={() => {
                          setPaletteId(null);
                          setDeleting(null);
                          setRenamingId(c.id);
                        }}
                      >
                        Rename
                      </button>
                      {isBuiltInCategory(c.slug) ? (
                        // The app looks this one up, so it can't be moved or deleted: no ⋯ menu,
                        // just the same space so Rename lines up with the other rows.
                        <span className="cat-menu-spacer" aria-hidden />
                      ) : (
                      <MoreMenu menu label={`More actions for ${c.name}`}>
                        {(close) => (
                          <>
                            {CATEGORY_TYPES.filter((t) => t !== tab).map((t) => (
                              <button
                                key={t}
                                type="button"
                                role="menuitem"
                                tabIndex={-1}
                                className="btn small"
                                disabled={busy}
                                onClick={() => {
                                  close();
                                  void moveType(c, t);
                                }}
                              >
                                Move to {CATEGORY_TYPE_LABELS[t]}
                              </button>
                            ))}
                            <button
                              type="button"
                              role="menuitem"
                              tabIndex={-1}
                              className="btn small danger"
                              disabled={busy}
                              onClick={() => {
                                close();
                                void startDelete(c);
                              }}
                            >
                              Delete…
                            </button>
                          </>
                        )}
                      </MoreMenu>
                      )}
                    </>
                  )}
                </div>

                {paletteId === c.id ? (
                  <div
                    className="cat-palette"
                    role="radiogroup"
                    aria-label={`Colour for ${c.name}`}
                    ref={(el) => {
                      // Opening the palette puts focus on the current choice.
                      if (el && !el.contains(document.activeElement)) el.querySelector<HTMLElement>('[role="radio"][aria-checked="true"]')?.focus();
                    }}
                    onKeyDown={(e) => {
                      if (e.key === 'Escape') {
                        // Close just the palette, not the Budget page's dialog around it.
                        e.preventDefault();
                        e.stopPropagation();
                        closePalette(c.id);
                        return;
                      }
                      const radios = [...e.currentTarget.querySelectorAll<HTMLElement>('[role="radio"]:not([disabled])')];
                      const i = radios.indexOf(document.activeElement as HTMLElement);
                      const step = e.key === 'ArrowRight' || e.key === 'ArrowDown' ? 1 : e.key === 'ArrowLeft' || e.key === 'ArrowUp' ? -1 : 0;
                      const next = step ? radios[(i + step + radios.length) % radios.length] : e.key === 'Home' ? radios[0] : e.key === 'End' ? radios.at(-1) : null;
                      if (!next) return;
                      e.preventDefault();
                      next.focus();
                    }}
                  >
                    <button
                      type="button"
                      role="radio"
                      aria-checked={!saved}
                      tabIndex={!saved ? 0 : -1}
                      className={'cat-palette-swatch is-auto' + (!saved ? ' is-on' : '')}
                      disabled={busy}
                      onClick={() => void pickColour(c, null)}
                    >
                      <span className="cat-palette-chip" style={{ background: auto }} aria-hidden />
                      Auto ({paletteName(auto) ?? 'automatic'})
                    </button>
                    {CATEGORY_PALETTE.map((hex) => {
                      const on = saved?.toLowerCase() === hex;
                      return (
                        <button
                          key={hex}
                          type="button"
                          role="radio"
                          aria-checked={on}
                          tabIndex={on ? 0 : -1}
                          className={'cat-palette-swatch' + (on ? ' is-on' : '')}
                          disabled={busy}
                          onClick={() => void pickColour(c, hex)}
                        >
                          <span className="cat-palette-chip" style={{ background: hex }} aria-hidden />
                          {CATEGORY_PALETTE_NAMES[hex]}
                        </button>
                      );
                    })}
                    {saved && !paletteName(saved) ? (
                      <button type="button" role="radio" aria-checked tabIndex={0} className="cat-palette-swatch is-on" disabled={busy} onClick={() => closePalette(c.id)}>
                        <span className="cat-palette-chip" style={{ background: saved }} aria-hidden />
                        Custom
                      </button>
                    ) : null}
                    <p className="muted small cat-palette-note">
                      Auto gives each category its own colour by its place in the list, the same on every chart.
                    </p>
                  </div>
                ) : null}

                {deleting?.cat.id === c.id ? (
                  <div className="cat-delete" role="group" aria-label={`Delete ${c.name}`}>
                    <p>
                      “{c.name}” is used by {usageText(deleting.usage)}. Choose another {CATEGORY_TYPE_LABELS[typeOf(c)].toLowerCase()} category
                      to move them to, then delete it. Nothing else changes.
                    </p>
                    <label className="field">
                      <span>Move them to</span>
                      <select
                        value={deleting.target}
                        disabled={busy}
                        onChange={(e) => setDeleting({ cat: deleting.cat, usage: deleting.usage, target: e.target.value })}
                      >
                        {byType(typeOf(c))
                          .filter((x) => x.id !== c.id)
                          .map((x) => (
                            <option key={x.id} value={x.id}>
                              {x.name}
                            </option>
                          ))}
                      </select>
                    </label>
                    {deleting.error ? (
                      <p className="auth-error" role="alert">
                        {deleting.error}
                      </p>
                    ) : null}
                    <div className="row gap">
                      <button type="button" className="btn small danger" disabled={busy} onClick={() => void confirmDelete()}>
                        Move and delete
                      </button>
                      <button type="button" className="btn small ghost" disabled={busy} onClick={() => setDeleting(null)}>
                        Cancel
                      </button>
                    </div>
                  </div>
                ) : null}
              </li>
            );
          })}
          {rows.length === 0 ? <li className="muted small cat-empty">No {CATEGORY_TYPE_LABELS[tab].toLowerCase()} categories yet.</li> : null}
        </ul>

        <CategoryAddField
          key={tab}
          type={tab}
          busy={busy}
          onAdd={(name) =>
            run(async () => {
              await api.budgets.createCategory({ name, type: tab });
              return `Added “${name}”`;
            }, 'Could not add the category')
          }
        />
      </CategoryTabPanel>
    </div>
  );
}

function RenameForm({ category, busy, onSave, onCancel }: { category: ManagedCategory; busy: boolean; onSave: (name: string) => Promise<void>; onCancel: () => void }) {
  const [name, setName] = useState(category.name);
  return (
    <form
      className="cat-rename-form"
      onSubmit={(e) => {
        e.preventDefault();
        const next = name.trim();
        if (!next) return;
        if (next === category.name) onCancel();
        else void onSave(next);
      }}
      onKeyDown={(e) => {
        if (e.key === 'Escape') {
          e.stopPropagation();
          onCancel();
        }
      }}
    >
      <input aria-label={`New name for ${category.name}`} value={name} maxLength={80} disabled={busy} autoFocus onChange={(e) => setName(e.target.value)} />
      <button type="submit" className="btn small primary" disabled={busy || !name.trim()}>
        Save
      </button>
      <button type="button" className="btn small ghost" disabled={busy} onClick={onCancel}>
        Cancel
      </button>
    </form>
  );
}
