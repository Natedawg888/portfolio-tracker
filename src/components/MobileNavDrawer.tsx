/**
 * Phone navigation: a drawer that slides in from the right, rendered in a portal at the end
 * of <body> so no page element can affect where it sits. Desktop keeps the nav pill in the
 * header (Layout). The drawer is a modal dialog: focus moves in, is kept inside while open,
 * and goes back to the menu button when it closes. Escape and the backdrop close it.
 */
import { useEffect, useRef, useState, type ReactNode, type RefObject } from 'react';
import { createPortal } from 'react-dom';
import { NavLink } from 'react-router-dom';
import { BrandLockup } from './BrandLockup';
import { prefetchNavTarget } from '../lib/routePrefetch';

export const MOBILE_NAV_ID = 'mobile-nav-drawer';
/** Matches the slide in the CSS; reduced motion skips the wait. */
const SLIDE_MS = 200;

const FOCUSABLE = 'a[href], button:not([disabled]), [tabindex]:not([tabindex="-1"])';

export function CloseIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden>
      <path d="M6 6l12 12M18 6L6 18" />
    </svg>
  );
}

function prefersReducedMotion(): boolean {
  return typeof window.matchMedia === 'function' && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
}

export function MobileNavDrawer({
  open,
  onClose,
  links,
  tools,
  returnFocusRef,
}: {
  open: boolean;
  onClose: () => void;
  links: Array<{ to: string; label: string; end?: boolean }>;
  /** Hide-amounts and theme controls, shown at the bottom. */
  tools: ReactNode;
  /** The menu button, focused again when the drawer closes. */
  returnFocusRef: RefObject<HTMLButtonElement | null>;
}) {
  // Stay mounted while the closing slide runs.
  const [mounted, setMounted] = useState(open);
  const panelRef = useRef<HTMLDivElement>(null);
  const wasOpen = useRef(open);
  if (open && !mounted) setMounted(true);
  const closing = !open && mounted;

  useEffect(() => {
    if (open) {
      wasOpen.current = true;
      // Focus the first control (the close button) once the panel is in the DOM.
      const id = window.requestAnimationFrame(() => {
        panelRef.current?.querySelector<HTMLElement>(FOCUSABLE)?.focus();
      });
      return () => window.cancelAnimationFrame(id);
    }
    if (wasOpen.current) {
      wasOpen.current = false;
      // Don't scroll the page back up to the header to reach the button.
      returnFocusRef.current?.focus({ preventScroll: true });
    }
    return undefined;
  }, [open, returnFocusRef]);

  useEffect(() => {
    if (!closing) return;
    const t = window.setTimeout(() => setMounted(false), prefersReducedMotion() ? 0 : SLIDE_MS);
    return () => window.clearTimeout(t);
  }, [closing]);

  if (!mounted) return null;

  const onKeyDown = (e: React.KeyboardEvent<HTMLDivElement>) => {
    if (e.key === 'Escape') {
      e.stopPropagation();
      onClose();
      return;
    }
    if (e.key !== 'Tab' || !panelRef.current) return;
    // Keep focus inside the drawer.
    const items = [...panelRef.current.querySelectorAll<HTMLElement>(FOCUSABLE)].filter((el) => el.offsetParent !== null);
    if (items.length === 0) return;
    const first = items[0];
    const last = items[items.length - 1];
    if (e.shiftKey && document.activeElement === first) {
      e.preventDefault();
      last.focus();
    } else if (!e.shiftKey && document.activeElement === last) {
      e.preventDefault();
      first.focus();
    }
  };

  return createPortal(
    <div className={'mobile-nav-root' + (closing ? ' is-closing' : '')}>
      <div className="mobile-nav-backdrop" aria-hidden="true" onClick={onClose} />
      <div
        ref={panelRef}
        id={MOBILE_NAV_ID}
        className="mobile-nav-panel"
        role="dialog"
        aria-modal="true"
        aria-label="Main menu"
        onKeyDown={onKeyDown}
      >
        <div className="mobile-nav-head">
          <BrandLockup size="sm" />
          <button type="button" className="mobile-nav-close" aria-label="Close menu" onClick={onClose}>
            <CloseIcon />
          </button>
        </div>
        <nav className="mobile-nav-links" aria-label="Main">
          {links.map((l) => (
            <NavLink
              key={l.to}
              to={l.to}
              end={l.end}
              className={({ isActive }) => 'mobile-nav-link' + (isActive ? ' active' : '')}
              onClick={onClose}
              onFocus={() => prefetchNavTarget(l.to)}
              onTouchStart={() => prefetchNavTarget(l.to)}
            >
              {l.label}
            </NavLink>
          ))}
        </nav>
        <div className="mobile-nav-tools">{tools}</div>
      </div>
    </div>,
    document.body,
  );
}
