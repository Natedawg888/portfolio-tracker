/**
 * One-tap choices as a radio group: role="radiogroup" / "radio" with aria-checked.
 * Only the checked chip is in the tab order; arrow keys, Home and End move and select.
 */
import { useRef, type KeyboardEvent } from 'react';

export function RadioChips({
  labelId,
  options,
  value,
  onChange,
  small = false,
}: {
  /** id of the visible label for the group. */
  labelId: string;
  options: ReadonlyArray<{ value: string; label: string }>;
  value: string;
  onChange: (value: string) => void;
  small?: boolean;
}) {
  const refs = useRef<Array<HTMLButtonElement | null>>([]);
  const current = Math.max(0, options.findIndex((o) => o.value === value));

  function onKeyDown(e: KeyboardEvent<HTMLDivElement>) {
    const last = options.length - 1;
    const next =
      e.key === 'ArrowRight' || e.key === 'ArrowDown' ? (current === last ? 0 : current + 1)
      : e.key === 'ArrowLeft' || e.key === 'ArrowUp' ? (current === 0 ? last : current - 1)
      : e.key === 'Home' ? 0
      : e.key === 'End' ? last
      : null;
    if (next == null) return;
    e.preventDefault();
    onChange(options[next].value);
    refs.current[next]?.focus();
  }

  return (
    <div
      className={'segmented warranty-chips' + (small ? ' segmented--small' : '')}
      role="radiogroup"
      aria-labelledby={labelId}
      onKeyDown={onKeyDown}
    >
      {options.map((o, i) => {
        const checked = i === current;
        return (
          <button
            key={o.value}
            ref={(el) => {
              refs.current[i] = el;
            }}
            type="button"
            role="radio"
            aria-checked={checked}
            tabIndex={checked ? 0 : -1}
            className={'segmented-btn' + (checked ? ' active' : '')}
            onClick={() => onChange(o.value)}
          >
            {o.label}
          </button>
        );
      })}
    </div>
  );
}
