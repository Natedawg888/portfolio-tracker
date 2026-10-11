/**
 * Small ⓘ button that reveals source / last-updated notes for a figure.
 * Opens on hover and keyboard focus, and toggles on click/tap. Escape closes it.
 * The note is always in the DOM and linked with aria-describedby, so screen
 * readers hear it on focus without opening anything.
 */
import { useEffect, useId, useRef, useState, type ReactNode } from 'react';

export function InfoTip({ label, children }: { label: string; children: ReactNode }) {
  const id = useId();
  const [pinned, setPinned] = useState(false);
  const wrapRef = useRef<HTMLSpanElement>(null);

  useEffect(() => {
    if (!pinned) return;
    const onDown = (event: PointerEvent) => {
      if (!wrapRef.current?.contains(event.target as Node)) setPinned(false);
    };
    document.addEventListener('pointerdown', onDown);
    return () => document.removeEventListener('pointerdown', onDown);
  }, [pinned]);

  return (
    <span ref={wrapRef} className={'info-tip' + (pinned ? ' info-tip--open' : '')}>
      <button
        type="button"
        className="info-tip-btn"
        aria-label={label}
        aria-describedby={id}
        aria-expanded={pinned}
        onClick={(event) => {
          event.stopPropagation();
          setPinned((p) => !p);
        }}
        onKeyDown={(event) => {
          if (event.key === 'Escape') {
            setPinned(false);
            (event.currentTarget as HTMLButtonElement).blur();
          }
        }}
      >
        <span aria-hidden="true">ⓘ</span>
      </button>
      <span id={id} role="tooltip" className="info-tip-body">
        {children}
      </span>
    </span>
  );
}
