import { useEffect, useId, useMemo, useRef, useState } from 'react';

export type CurrencyOption = {
  code: string;
  name: string;
  countries: string[];
  searchText: string;
};

type Props = {
  label: string;
  value: string;
  onChange: (code: string) => void;
  currencies: CurrencyOption[];
  disabled?: boolean;
  id?: string;
};

/**
 * Searchable currency dropdown — filter by ISO code, currency name, or country.
 * Lists all Frankfurter currencies passed in (never invents rates).
 */
export function CurrencyPicker({
  label,
  value,
  onChange,
  currencies,
  disabled,
  id,
}: Props) {
  const autoId = useId();
  const inputId = id ?? autoId;
  const rootRef = useRef<HTMLLabelElement>(null);
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');

  const selected = useMemo(
    () => currencies.find((c) => c.code === value) ?? null,
    [currencies, value],
  );

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return currencies;
    return currencies.filter(
      (c) =>
        c.searchText.includes(q) ||
        c.code.toLowerCase().includes(q) ||
        c.name.toLowerCase().includes(q) ||
        c.countries.some((co) => co.toLowerCase().includes(q)),
    );
  }, [currencies, query]);

  useEffect(() => {
    if (!open) setQuery('');
  }, [open]);

  useEffect(() => {
    function onDoc(e: MouseEvent) {
      if (!rootRef.current?.contains(e.target as Node)) setOpen(false);
    }
    document.addEventListener('mousedown', onDoc);
    return () => document.removeEventListener('mousedown', onDoc);
  }, []);

  function pick(code: string) {
    onChange(code);
    setOpen(false);
    setQuery('');
  }

  const display = selected
    ? `${selected.code} — ${selected.name}`
    : value
      ? value
      : 'Select currency';

  return (
    <label className="currency-picker" ref={rootRef}>
      {label}
      <div className={`currency-picker-control${open ? ' open' : ''}`}>
        <button
          type="button"
          id={inputId}
          className="currency-picker-trigger"
          disabled={disabled || currencies.length === 0}
          aria-haspopup="listbox"
          aria-expanded={open}
          onClick={() => setOpen((o) => !o)}
        >
          <span className="currency-picker-value">{display}</span>
          <span className="currency-picker-caret" aria-hidden>
            ▾
          </span>
        </button>
        {open ? (
          <div className="currency-picker-panel" role="listbox">
            <input
              type="search"
              className="currency-picker-search"
              placeholder="Search country or currency…"
              value={query}
              autoFocus
              onChange={(e) => setQuery(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Escape') setOpen(false);
                if (e.key === 'Enter' && filtered[0]) {
                  e.preventDefault();
                  pick(filtered[0].code);
                }
              }}
            />
            <ul className="currency-picker-list">
              {filtered.length === 0 ? (
                <li className="currency-picker-empty">No match</li>
              ) : (
                filtered.map((c) => (
                  <li key={c.code}>
                    <button
                      type="button"
                      className={
                        c.code === value
                          ? 'currency-picker-option selected'
                          : 'currency-picker-option'
                      }
                      role="option"
                      aria-selected={c.code === value}
                      onClick={() => pick(c.code)}
                    >
                      <strong>{c.code}</strong>
                      <span>{c.name}</span>
                      {c.countries[0] ? (
                        <span className="muted small">{c.countries[0]}</span>
                      ) : null}
                    </button>
                  </li>
                ))
              )}
            </ul>
          </div>
        ) : null}
      </div>
    </label>
  );
}
