/**
 * ⋯ button that opens a small panel of actions (Budget transactions, Debts cards).
 * Focus moves into the panel on open; Escape or a click outside closes it and
 * Escape returns focus to the button.
 */
import { useEffect, useId, useRef, useState, type ReactNode } from 'react';

export function MoreMenu({ label, children }: { label: string; children: (close: () => void) => ReactNode }) {
  const [open, setOpen] = useState(false);
  const wrapRef = useRef<HTMLDivElement>(null);
  const toggleRef = useRef<HTMLButtonElement>(null);
  const menuId = useId();

  useEffect(() => {
    if (!open) return;
    wrapRef.current
      ?.querySelector<HTMLElement>('.more-menu-body select, .more-menu-body button, .more-menu-body input')
      ?.focus();
    const onDown = (event: PointerEvent) => {
      if (!wrapRef.current?.contains(event.target as Node)) setOpen(false);
    };
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        setOpen(false);
        toggleRef.current?.focus();
      }
    };
    document.addEventListener('pointerdown', onDown);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('pointerdown', onDown);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);

  return (
    <div className="more-menu txn-menu" ref={wrapRef}>
      <button
        ref={toggleRef}
        type="button"
        className="txn-menu-toggle"
        aria-expanded={open}
        aria-controls={open ? menuId : undefined}
        aria-label={label}
        onClick={() => setOpen((o) => !o)}
      >
        ⋯
      </button>
      {open ? (
        <div id={menuId} className="more-menu-body txn-menu-body">
          {children(() => setOpen(false))}
        </div>
      ) : null}
    </div>
  );
}
