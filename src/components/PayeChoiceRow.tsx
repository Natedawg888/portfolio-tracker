import type { KeyboardEvent, ReactNode } from 'react';

export function PayeChoiceRow<T extends string>({
  label,
  ariaLabel,
  value,
  options,
  onChange,
  aside,
}: {
  label: string;
  ariaLabel?: string;
  value: T;
  options: readonly { value: T; label: string }[];
  onChange: (next: T) => void;
  aside?: ReactNode;
}) {
  function onKeyDown(e: KeyboardEvent<HTMLDivElement>) {
    if (e.key !== 'ArrowRight' && e.key !== 'ArrowDown' && e.key !== 'ArrowLeft' && e.key !== 'ArrowUp') {
      return;
    }
    e.preventDefault();
    const index = options.findIndex((opt) => opt.value === value);
    const delta = e.key === 'ArrowRight' || e.key === 'ArrowDown' ? 1 : -1;
    const next = options[(index + delta + options.length) % options.length];
    if (!next) return;
    onChange(next.value);
    const buttons = e.currentTarget.querySelectorAll<HTMLButtonElement>('[data-value]');
    Array.from(buttons)
      .find((el) => el.dataset.value === next.value)
      ?.focus();
  }

  return (
    <fieldset className="paye-choice">
      <legend className="paye-choice-legend">
        {label}
        {aside}
      </legend>
      <div className="paye-choice-row" role="radiogroup" aria-label={ariaLabel ?? label} onKeyDown={onKeyDown}>
        {options.map((opt) => {
          const active = value === opt.value;
          return (
            <button
              key={opt.value}
              type="button"
              role="radio"
              data-value={opt.value}
              aria-checked={active}
              tabIndex={active ? 0 : -1}
              className={'paye-choice-btn' + (active ? ' active' : '')}
              onClick={() => onChange(opt.value)}
            >
              {opt.label}
            </button>
          );
        })}
      </div>
    </fieldset>
  );
}
