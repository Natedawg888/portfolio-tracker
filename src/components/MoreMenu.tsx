/**
 * ⋯ button that opens a small panel of actions (Budget transactions, Debts cards).
 * Focus moves into the panel on open; Escape or a click outside closes it and
 * Escape returns focus to the button.
 *
 * menu: the panel is a menu. The button sets aria-haspopup="menu" and aria-expanded.
 * Arrow keys, Home, and End move between menuitems. The panel is position:fixed so a
 * scrolling table does not clip it.
 */
import { useEffect, useId, useLayoutEffect, useRef, useState, type KeyboardEvent as ReactKeyboardEvent, type ReactNode } from 'react';

export function MoreMenu({
  label,
  children,
  menu = false,
}: {
  label: string;
  children: (close: () => void) => ReactNode;
  /** Arrow-key menu with aria-haspopup="menu". Other panels keep the previous behaviour. */
  menu?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [pos, setPos] = useState<{ top: number; left: number } | null>(null);
  const wrapRef = useRef<HTMLDivElement>(null);
  const toggleRef = useRef<HTMLButtonElement>(null);
  const focusedOpen = useRef(false);
  const menuId = useId();

  function menuItems(): HTMLElement[] {
    const root = wrapRef.current;
    if (!root) return [];
    return [...root.querySelectorAll<HTMLElement>('.more-menu-body [role="menuitem"]:not([disabled])')];
  }

  useLayoutEffect(() => {
    if (!open || !menu) return;
    const place = () => {
      const button = toggleRef.current;
      const panel = wrapRef.current?.querySelector<HTMLElement>('.more-menu-body');
      if (!button || !panel) return;
      const rect = button.getBoundingClientRect();
      const width = panel.offsetWidth;
      const height = panel.offsetHeight;
      const gap = 4;
      let top = rect.bottom + gap;
      if (top + height > window.innerHeight - 8 && rect.top - height - gap > 8) top = rect.top - height - gap;
      let left = rect.right - width;
      if (left < 8) left = 8;
      if (left + width > window.innerWidth - 8) left = Math.max(8, window.innerWidth - 8 - width);
      setPos((prev) => (prev && prev.top === top && prev.left === left ? prev : { top, left }));
    };
    place();
    window.addEventListener('resize', place);
    window.addEventListener('scroll', place, true);
    return () => {
      window.removeEventListener('resize', place);
      window.removeEventListener('scroll', place, true);
    };
  }, [open, menu]);

  useEffect(() => {
    if (!open) {
      focusedOpen.current = false;
      return;
    }
    // A fixed menu is hidden until it has been measured. Focusing then does nothing.
    if (menu && pos == null) return;
    if (focusedOpen.current) return;
    focusedOpen.current = true;
    const selector = menu
      ? '.more-menu-body [role="menuitem"]:not([disabled])'
      : '.more-menu-body select, .more-menu-body button, .more-menu-body input';
    wrapRef.current?.querySelector<HTMLElement>(selector)?.focus();
  }, [open, menu, pos]);

  useEffect(() => {
    if (!open) return;
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

  function onKeyDown(event: ReactKeyboardEvent<HTMLDivElement>) {
    if (!menu) return;
    if (!open && (event.key === 'ArrowDown' || event.key === 'ArrowUp')) {
      event.preventDefault();
      setOpen(true);
      return;
    }
    if (!open) return;
    if (event.key === 'Tab') {
      setOpen(false);
      return;
    }
    const list = menuItems();
    if (list.length === 0) return;
    const index = list.indexOf(document.activeElement as HTMLElement);
    let next = -1;
    if (event.key === 'ArrowDown') next = index < 0 ? 0 : (index + 1) % list.length;
    else if (event.key === 'ArrowUp') next = index < 0 ? list.length - 1 : (index - 1 + list.length) % list.length;
    else if (event.key === 'Home') next = 0;
    else if (event.key === 'End') next = list.length - 1;
    else return;
    event.preventDefault();
    list[next]?.focus();
  }

  return (
    <div className={'more-menu txn-menu' + (menu ? ' more-menu--floating' : '')} ref={wrapRef} onKeyDown={onKeyDown}>
      <button
        ref={toggleRef}
        type="button"
        className="txn-menu-toggle"
        aria-haspopup={menu ? 'menu' : undefined}
        aria-expanded={open}
        aria-controls={open ? menuId : undefined}
        aria-label={label}
        onClick={() => setOpen((o) => !o)}
      >
        ⋯
      </button>
      {open ? (
        <div
          id={menuId}
          className="more-menu-body txn-menu-body"
          role={menu ? 'menu' : undefined}
          style={
            menu
              ? {
                  position: 'fixed',
                  top: pos?.top ?? 0,
                  left: pos?.left ?? 0,
                  right: 'auto',
                  visibility: pos ? 'visible' : 'hidden',
                }
              : undefined
          }
        >
          {children(() => setOpen(false))}
        </div>
      ) : null}
    </div>
  );
}
