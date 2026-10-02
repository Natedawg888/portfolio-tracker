import { useEffect, useMemo, useState } from 'react';
import type { FormEvent, ReactNode } from 'react';
import { api, formatNzd } from '../api/client';
import type { MtgColour } from '../types';
import {
  COLLECTABLE_PRESETS,
  emptyMessageFor,
  inferTypesFromHoldings,
  isApiCardGame,
  slugifyCollectableTypeId,
  type CollectableTypeDef,
  type CollectableTypeKind,
} from '../lib/collectables';
import {
  MtgFilterBar,
  matchesMtgColourFilters,
  matchesMtgRarityFilters,
  type MtgColourFilter,
  type MtgRarityFilter,
} from './MtgFilters';

export type CollectableItem = {
  id: string;
  assetClass: string;
  name: string;
  cardGame?: string | null;
  cardColours?: MtgColour[] | null;
  cardRarity?: string | null;
  quantity?: number | null;
  marketValueNzd?: number | null;
  valuationNzd?: number | null;
  costBasisNzd?: number | null;
};

function parseOptionalNumber(value: string): number | null {
  const t = value.trim();
  if (!t) return null;
  const n = Number(t);
  return Number.isFinite(n) ? n : null;
}

function itemValueNzd(h: CollectableItem): number | null {
  if (h.marketValueNzd != null && Number.isFinite(h.marketValueNzd)) return Number(h.marketValueNzd);
  if (h.valuationNzd != null && Number.isFinite(h.valuationNzd)) return Number(h.valuationNzd);
  return null;
}

function sumValues(items: CollectableItem[]): number | null {
  let total = 0;
  let any = false;
  for (const h of items) {
    const v = itemValueNzd(h);
    if (v != null) {
      total += v;
      any = true;
    }
  }
  return any ? total : null;
}

const emptyCardForm = {
  name: '',
  cardSet: '',
  cardNumber: '',
  cardFinish: 'nonfoil',
  quantity: '1',
  costBasisNzd: '',
  notes: '',
  apiId: '',
};

const emptyManualForm = {
  name: '',
  appraisalNzd: '',
  quantity: '1',
  costBasisNzd: '',
  notes: '',
  photoBase64: '' as string,
};

type Props = {
  holdings: CollectableItem[];
  onChanged: () => Promise<void> | void;
  renderCard: (holding: CollectableItem) => ReactNode;
  onBanner?: (msg: string | null) => void;
};

export function CollectablesPanel({ holdings, onChanged, renderCard, onBanner }: Props) {
  const [types, setTypes] = useState<CollectableTypeDef[]>([]);
  const [presets, setPresets] = useState<CollectableTypeDef[]>(COLLECTABLE_PRESETS);
  const [typesLoaded, setTypesLoaded] = useState(false);
  const [openTypeId, setOpenTypeId] = useState<string | null>(null);
  const [mtgColourFilters, setMtgColourFilters] = useState<Set<MtgColourFilter>>(() => new Set());
  const [mtgRarityFilters, setMtgRarityFilters] = useState<Set<MtgRarityFilter>>(() => new Set());
  const [refreshing, setRefreshing] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const [cardForm, setCardForm] = useState(emptyCardForm);
  const [manualForm, setManualForm] = useState(emptyManualForm);
  const [csvText, setCsvText] = useState('');
  const [csvFileName, setCsvFileName] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [addingType, setAddingType] = useState(false);
  const [customTitle, setCustomTitle] = useState('');
  const [customKind, setCustomKind] = useState<CollectableTypeKind>('manual');

  const byType = useMemo(() => {
    const map = new Map<string, CollectableItem[]>();
    for (const h of holdings) {
      const key = (h.cardGame ?? 'other').toLowerCase();
      const list = map.get(key) ?? [];
      list.push(h);
      map.set(key, list);
    }
    return map;
  }, [holdings]);

  /** Configured types only — unused presets (never added) stay omitted. */
  const visibleTypes = types;

  const openDef = openTypeId ? types.find((t) => t.id === openTypeId) ?? null : null;

  const openRawItems = openTypeId ? byType.get(openTypeId) ?? [] : [];

  const filteredMtg = useMemo(() => {
    if (!openDef || openDef.kind !== 'mtg') return openRawItems;
    return openRawItems.filter(
      (h) => matchesMtgColourFilters(h, mtgColourFilters) && matchesMtgRarityFilters(h, mtgRarityFilters),
    );
  }, [openDef, openRawItems, mtgColourFilters, mtgRarityFilters]);

  const openItems = openDef?.kind === 'mtg' ? filteredMtg : openRawItems;

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const r = await api.settings.getCollectableTypes();
        if (cancelled) return;
        setPresets(r.presets?.length ? r.presets : COLLECTABLE_PRESETS);
        if (r.types.length > 0) {
          setTypes(r.types);
        } else {
          // Bootstrap from holdings only — do not force MTG/Pokémon/figurines.
          const inferred = inferTypesFromHoldings(holdings.map((h) => h.cardGame));
          setTypes(inferred);
          if (inferred.length > 0) {
            await api.settings.setCollectableTypes(inferred);
          }
        }
      } catch {
        if (!cancelled) {
          setTypes(inferTypesFromHoldings(holdings.map((h) => h.cardGame)));
        }
      } finally {
        if (!cancelled) setTypesLoaded(true);
      }
    })();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- bootstrap once on mount
  }, []);

  // When new holdings appear for an unknown game, surface that type.
  useEffect(() => {
    if (!typesLoaded) return;
    setTypes((prev) => {
      const known = new Set(prev.map((t) => t.id));
      const extras = inferTypesFromHoldings(
        holdings.map((h) => h.cardGame).filter((g) => g && !known.has(String(g).toLowerCase())),
      );
      if (extras.length === 0) return prev;
      const next = [...prev, ...extras];
      void api.settings.setCollectableTypes(next).catch(() => undefined);
      return next;
    });
  }, [holdings, typesLoaded]);

  useEffect(() => {
    if (!openTypeId) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpenTypeId(null);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [openTypeId]);

  function banner(next: string | null) {
    setMsg(next);
    onBanner?.(next);
  }

  async function persistTypes(next: CollectableTypeDef[]) {
    setTypes(next);
    try {
      const r = await api.settings.setCollectableTypes(next);
      setTypes(r.types);
      if (r.presets?.length) setPresets(r.presets);
    } catch (err) {
      banner((err as Error).message);
    }
  }

  function toggleMtgColour(c: MtgColourFilter) {
    setMtgColourFilters((prev) => {
      const next = new Set(prev);
      if (next.has(c)) next.delete(c);
      else next.add(c);
      return next;
    });
  }

  function toggleMtgRarity(r: MtgRarityFilter) {
    setMtgRarityFilters((prev) => {
      const next = new Set(prev);
      if (next.has(r)) next.delete(r);
      else next.add(r);
      return next;
    });
  }

  async function refreshQuotes() {
    banner(null);
    setRefreshing(true);
    try {
      const r = await api.holdings.refreshCollectablesValues();
      banner(
        `Collectables: ${r.appliedCount}/${r.total} quoted (Scryfall / pokemontcg.io → NZD)` +
          (r.failedCount ? ` · ${r.failedCount} unavailable (never invent)` : ''),
      );
      await onChanged();
    } catch (err) {
      banner((err as Error).message);
    } finally {
      setRefreshing(false);
    }
  }

  async function onAddCard(e: FormEvent, game: 'mtg' | 'pokemon') {
    e.preventDefault();
    banner(null);
    setBusy(true);
    try {
      await api.holdings.create({
        assetClass: 'collectable',
        cardGame: game,
        name: cardForm.name.trim() || undefined,
        cardSet: cardForm.cardSet || undefined,
        cardNumber: cardForm.cardNumber || undefined,
        cardFinish: cardForm.cardFinish || undefined,
        cardApiId: cardForm.apiId || undefined,
        quantity: Number(cardForm.quantity || 1),
        costBasisNzd: parseOptionalNumber(cardForm.costBasisNzd),
        notes: cardForm.notes || null,
      });
      setCardForm({
        ...emptyCardForm,
        cardFinish: game === 'mtg' ? 'nonfoil' : 'holofoil',
      });
      banner(`${game === 'mtg' ? 'MTG' : 'Pokémon'} card added (lookup → NZD)`);
      await onChanged();
    } catch (err) {
      banner((err as Error).message);
    } finally {
      setBusy(false);
    }
  }

  async function onAddManual(e: FormEvent, typeId: string) {
    e.preventDefault();
    banner(null);
    setBusy(true);
    try {
      await api.holdings.create({
        assetClass: 'collectable',
        cardGame: typeId,
        name: manualForm.name.trim(),
        quantity: Number(manualForm.quantity || 1),
        appraisalNzd: Number(manualForm.appraisalNzd),
        costBasisNzd: parseOptionalNumber(manualForm.costBasisNzd),
        notes: manualForm.notes || null,
        photoBase64: manualForm.photoBase64 || undefined,
      });
      setManualForm(emptyManualForm);
      banner('Collectable item added (manual appraisal NZD)');
      await onChanged();
    } catch (err) {
      banner((err as Error).message);
    } finally {
      setBusy(false);
    }
  }

  async function onSelectCsv(file: File | null) {
    if (!file) return;
    const text = await file.text();
    setCsvText(text);
    setCsvFileName(file.name);
  }

  async function onImportCsv(e: FormEvent) {
    e.preventDefault();
    banner(null);
    setBusy(true);
    try {
      const r = await api.holdings.importCollectablesCsv(csvText);
      banner(
        `CSV import: ${r.created} created · ${r.quotedOk} quoted OK` +
          (r.fxConverted ? ` · ${r.fxConverted} purchase price(s) converted to NZD` : '') +
          ` · columns ${r.columns}`,
      );
      setCsvText('');
      setCsvFileName(null);
      await onChanged();
    } catch (err) {
      banner((err as Error).message);
    } finally {
      setBusy(false);
    }
  }

  function onPickPhoto(file: File | null) {
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      const result = typeof reader.result === 'string' ? reader.result : '';
      setManualForm((prev) => ({ ...prev, photoBase64: result }));
    };
    reader.readAsDataURL(file);
  }

  function openModal(def: CollectableTypeDef) {
    setCardForm({
      ...emptyCardForm,
      cardFinish: def.kind === 'pokemon' ? 'holofoil' : 'nonfoil',
    });
    setMtgColourFilters(new Set());
    setMtgRarityFilters(new Set());
    setMsg(null);
    setOpenTypeId(def.id);
  }

  async function addPresetOrCustom(def: CollectableTypeDef) {
    if (types.some((t) => t.id === def.id)) {
      banner(`${def.title} is already in your types`);
      openModal(def);
      setAddingType(false);
      return;
    }
    const next = [...types, def];
    await persistTypes(next);
    setAddingType(false);
    setCustomTitle('');
    setCustomKind('manual');
    openModal(def);
  }

  async function onAddCustomType(e: FormEvent) {
    e.preventDefault();
    const title = customTitle.trim();
    if (!title) return;
    let id = slugifyCollectableTypeId(title);
    if (!id) {
      banner('Invalid type name');
      return;
    }
    if (customKind === 'mtg') id = 'mtg';
    if (customKind === 'pokemon') id = 'pokemon';
    const preset = COLLECTABLE_PRESETS.find((p) => p.id === id);
    const def: CollectableTypeDef = preset
      ? preset
      : {
          id,
          title,
          kind: customKind === 'mtg' || customKind === 'pokemon' ? customKind : 'manual',
          blurb:
            customKind === 'mtg'
              ? COLLECTABLE_PRESETS[0].blurb
              : customKind === 'pokemon'
                ? COLLECTABLE_PRESETS[1].blurb
                : 'Manual appraisal NZD · optional photo',
        };
    await addPresetOrCustom(def);
  }

  async function removeType(id: string) {
    const items = byType.get(id) ?? [];
    if (items.length > 0) {
      banner('Remove or reassign items before deleting this type');
      return;
    }
    const next = types.filter((t) => t.id !== id);
    await persistTypes(next);
    if (openTypeId === id) setOpenTypeId(null);
  }

  const hasApiCards = holdings.some((h) => isApiCardGame(h.cardGame));

  return (
    <section className="panel">
      <div className="panel-heading">
        <h3>Collectables</h3>
        <div className="row gap" style={{ marginTop: 0 }}>
          <span className="muted small">
            Your types only · tiles open scrollable lists · MTG colour/rarity when type is MTG
          </span>
          <button
            type="button"
            className="btn ghost"
            onClick={() => void refreshQuotes()}
            disabled={refreshing || !hasApiCards}
          >
            {refreshing ? 'Refreshing…' : 'Refresh card quotes'}
          </button>
        </div>
      </div>

      <div className="collectable-type-grid" role="list">
        {visibleTypes.map((def) => {
          const items = byType.get(def.id) ?? [];
          const total = sumValues(items);
          return (
            <div key={def.id} className="collectable-type-card-wrap">
              <button
                type="button"
                className={`collectable-type-card type-${def.kind} type-id-${def.id}`}
                role="listitem"
                onClick={() => openModal(def)}
                aria-haspopup="dialog"
              >
                <div className="collectable-type-card-top">
                  <span className="collectable-type-title">{def.title}</span>
                  <span className="collectable-type-count">
                    {items.length} item{items.length === 1 ? '' : 's'}
                  </span>
                </div>
                <p className="muted small collectable-type-blurb">{def.blurb}</p>
                <div className="collectable-type-value">
                  {total != null ? formatNzd(total) : '—'}
                </div>
                <span className="collectable-type-open muted small">Open list →</span>
              </button>
              {items.length === 0 && (
                <button
                  type="button"
                  className="btn ghost small collectable-type-remove"
                  title="Remove empty type"
                  onClick={() => void removeType(def.id)}
                >
                  Remove
                </button>
              )}
            </div>
          );
        })}

        <button
          type="button"
          className="collectable-type-card collectable-type-add"
          onClick={() => setAddingType((v) => !v)}
        >
          <span className="collectable-type-title">+ Add type</span>
          <p className="muted small collectable-type-blurb">
            MTG, Pokémon, figurines, or a custom category you care about
          </p>
        </button>
      </div>

      {addingType && (
        <div className="collectable-add-type panel-inset">
          <p className="muted small" style={{ marginTop: 0 }}>
            Only types you add appear as tiles. Empty unused presets stay omitted.
          </p>
          <div className="row gap wrap">
            {presets.map((p) => (
              <button
                key={p.id}
                type="button"
                className="btn ghost"
                disabled={types.some((t) => t.id === p.id)}
                onClick={() => void addPresetOrCustom(p)}
              >
                {p.title}
                {types.some((t) => t.id === p.id) ? ' ✓' : ''}
              </button>
            ))}
          </div>
          <form className="form-grid" style={{ marginTop: '0.75rem' }} onSubmit={(e) => void onAddCustomType(e)}>
            <label>
              Custom type name
              <input
                value={customTitle}
                onChange={(e) => setCustomTitle(e.target.value)}
                placeholder="e.g. Sealed product, Amiibo…"
                required
              />
            </label>
            <label>
              Pricing
              <select
                value={customKind}
                onChange={(e) => setCustomKind(e.target.value as CollectableTypeKind)}
              >
                <option value="manual">Manual appraisal NZD</option>
                <option value="mtg">MTG (Scryfall)</option>
                <option value="pokemon">Pokémon (pokemontcg.io)</option>
              </select>
            </label>
            <button type="submit" className="btn primary" disabled={busy || !customTitle.trim()}>
              Add custom type
            </button>
          </form>
        </div>
      )}

      {typesLoaded && visibleTypes.length === 0 && (
        <p className="muted" style={{ marginTop: '0.75rem' }}>
          No collectable types yet. Add MTG, Pokémon, figurines, or a custom type — unused defaults stay hidden.
        </p>
      )}

      {openDef && (
        <div
          className="modal-overlay"
          role="presentation"
          onClick={(e) => {
            if (e.target === e.currentTarget) setOpenTypeId(null);
          }}
        >
          <div
            className="modal-dialog modal-dialog-wide collectable-modal"
            role="dialog"
            aria-modal="true"
            aria-labelledby={`collectable-modal-${openDef.id}`}
          >
            <div className="modal-header">
              <h3 id={`collectable-modal-${openDef.id}`}>{openDef.title}</h3>
              <button
                type="button"
                className="btn small modal-close"
                aria-label="Close"
                onClick={() => setOpenTypeId(null)}
              >
                ×
              </button>
            </div>
            <p className="muted small" style={{ marginTop: 0 }}>
              {openDef.blurb}
              {` · ${openRawItems.length} item${openRawItems.length === 1 ? '' : 's'}`}
              {sumValues(openRawItems) != null && ` · ${formatNzd(sumValues(openRawItems)!)}`}
            </p>

            {openDef.kind === 'mtg' && openRawItems.length > 0 && (
              <MtgFilterBar
                colourFilters={mtgColourFilters}
                rarityFilters={mtgRarityFilters}
                onToggleColour={toggleMtgColour}
                onToggleRarity={toggleMtgRarity}
                onClear={() => {
                  setMtgColourFilters(new Set());
                  setMtgRarityFilters(new Set());
                }}
                matchCount={filteredMtg.length}
                totalCount={openRawItems.length}
              />
            )}

            <div className="collectable-modal-scroll">
              {openItems.length === 0 ? (
                <p className="muted">
                  {openDef.kind === 'mtg' &&
                  openRawItems.length > 0 &&
                  (mtgColourFilters.size > 0 || mtgRarityFilters.size > 0)
                    ? openRawItems.every(
                        (h) =>
                          (mtgColourFilters.size > 0 && h.cardColours == null) ||
                          (mtgRarityFilters.size > 0 && !h.cardRarity),
                      )
                      ? 'No cards match — colour/rarity data is missing on these cards. Use Refresh card quotes (or backfill-mtg-meta) to load Scryfall identity & rarity, then filter again.'
                      : 'No cards match the selected colour/rarity filters.'
                    : emptyMessageFor(openDef)}
                </p>
              ) : (
                <div className="holding-cards">{openItems.map((h) => renderCard(h))}</div>
              )}
            </div>

            <details className="collectable-modal-add" open={openItems.length === 0}>
              <summary>
                {openDef.kind === 'manual'
                  ? `Add ${openDef.title} item`
                  : openDef.kind === 'mtg'
                    ? 'Add / import MTG cards'
                    : 'Add / import Pokémon cards'}
              </summary>

              {(openDef.kind === 'mtg' || openDef.kind === 'pokemon') && (
                <>
                  <form
                    className="form-grid"
                    onSubmit={(e) => void onAddCard(e, openDef.kind === 'mtg' ? 'mtg' : 'pokemon')}
                  >
                    <label>
                      Card name
                      <input
                        value={cardForm.name}
                        onChange={(e) => setCardForm({ ...cardForm, name: e.target.value })}
                        placeholder={openDef.kind === 'mtg' ? 'Lightning Bolt…' : 'Charizard…'}
                      />
                    </label>
                    <label>
                      Set code
                      <input
                        value={cardForm.cardSet}
                        onChange={(e) => setCardForm({ ...cardForm, cardSet: e.target.value })}
                        placeholder={openDef.kind === 'mtg' ? 'lea…' : 'base1…'}
                      />
                    </label>
                    <label>
                      Number
                      <input
                        value={cardForm.cardNumber}
                        onChange={(e) =>
                          setCardForm({ ...cardForm, cardNumber: e.target.value })
                        }
                      />
                    </label>
                    <label>
                      Finish
                      <input
                        value={cardForm.cardFinish}
                        onChange={(e) =>
                          setCardForm({ ...cardForm, cardFinish: e.target.value })
                        }
                        placeholder={openDef.kind === 'mtg' ? 'nonfoil / foil' : 'holofoil'}
                      />
                    </label>
                    <label>
                      Qty
                      <input
                        type="number"
                        min={1}
                        step={1}
                        value={cardForm.quantity}
                        onChange={(e) =>
                          setCardForm({ ...cardForm, quantity: e.target.value })
                        }
                      />
                    </label>
                    <label>
                      Cost basis (NZD, optional)
                      <input
                        type="number"
                        step="any"
                        value={cardForm.costBasisNzd}
                        onChange={(e) =>
                          setCardForm({ ...cardForm, costBasisNzd: e.target.value })
                        }
                      />
                    </label>
                    <label className="span-2">
                      Notes
                      <input
                        value={cardForm.notes}
                        onChange={(e) => setCardForm({ ...cardForm, notes: e.target.value })}
                      />
                    </label>
                    <p className="muted small span-2">
                      Market price and art from{' '}
                      {openDef.kind === 'mtg' ? 'Scryfall' : 'pokemontcg.io'} → NZD via Frankfurter.
                      Never invent prices.
                    </p>
                    <button type="submit" className="btn primary" disabled={busy}>
                      Add card
                    </button>
                  </form>

                  <form className="form-grid" onSubmit={(e) => void onImportCsv(e)}>
                    <h4 className="span-2" style={{ margin: '0.5rem 0 0' }}>
                      Bulk import CSV
                    </h4>
                    <p className="muted small span-2">
                      Compact{' '}
                      <code>game,name,set,number,finish,quantity,cost_basis_nzd,notes,api_id</code>
                      {openDef.kind === 'mtg' &&
                        ' or ManaBox export (Scryfall ID → MTG). Prices from APIs → NZD.'}
                    </p>
                    <label className="span-2">
                      CSV file
                      <input
                        type="file"
                        accept=".csv,text/csv"
                        onChange={(e) => void onSelectCsv(e.target.files?.[0] ?? null)}
                      />
                      {csvFileName && (
                        <span className="muted small">Selected: {csvFileName}</span>
                      )}
                    </label>
                    <button type="submit" className="btn primary" disabled={busy || !csvText.trim()}>
                      Import CSV
                    </button>
                  </form>
                </>
              )}

              {openDef.kind === 'manual' && (
                <form className="form-grid" onSubmit={(e) => void onAddManual(e, openDef.id)}>
                  <label>
                    Item name
                    <input
                      value={manualForm.name}
                      onChange={(e) => setManualForm({ ...manualForm, name: e.target.value })}
                      required
                      placeholder={`e.g. ${openDef.title}`}
                    />
                  </label>
                  <label>
                    Appraised value (NZD)
                    <input
                      type="number"
                      step="any"
                      min={0}
                      value={manualForm.appraisalNzd}
                      onChange={(e) =>
                        setManualForm({ ...manualForm, appraisalNzd: e.target.value })
                      }
                      required
                    />
                  </label>
                  <label>
                    Qty
                    <input
                      type="number"
                      min={1}
                      value={manualForm.quantity}
                      onChange={(e) =>
                        setManualForm({ ...manualForm, quantity: e.target.value })
                      }
                    />
                  </label>
                  <label>
                    Photo of item
                    <input
                      type="file"
                      accept="image/*"
                      onChange={(e) => onPickPhoto(e.target.files?.[0] ?? null)}
                    />
                  </label>
                  <label>
                    Cost basis (NZD, optional)
                    <input
                      type="number"
                      step="any"
                      value={manualForm.costBasisNzd}
                      onChange={(e) =>
                        setManualForm({ ...manualForm, costBasisNzd: e.target.value })
                      }
                    />
                  </label>
                  <label>
                    Notes
                    <input
                      value={manualForm.notes}
                      onChange={(e) => setManualForm({ ...manualForm, notes: e.target.value })}
                    />
                  </label>
                  <button type="submit" className="btn primary" disabled={busy}>
                    Add item
                  </button>
                </form>
              )}
            </details>

            {msg && <p className="banner">{msg}</p>}
          </div>
        </div>
      )}
    </section>
  );
}
