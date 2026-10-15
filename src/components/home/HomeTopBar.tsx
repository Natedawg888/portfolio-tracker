/**
 * Home page top bar: brand (to the top of the page), Features / Privacy anchors, Log in
 * and Sign up. On narrow screens the anchors move into a menu; Log in and Sign up stay.
 */
import { useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { BrandLockup } from '../BrandLockup';

const ANCHORS = [
  { href: '#features', label: 'Features' },
  { href: '#privacy', label: 'Privacy' },
];

export function HomeTopBar() {
  const [open, setOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);
  const toggleRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        setOpen(false);
        toggleRef.current?.focus();
      }
    };
    const onClick = (e: MouseEvent) => {
      if (!menuRef.current?.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('keydown', onKey);
    document.addEventListener('mousedown', onClick);
    return () => {
      document.removeEventListener('keydown', onKey);
      document.removeEventListener('mousedown', onClick);
    };
  }, [open]);

  return (
    <header className="home-topbar">
      <a className="home-brand" href="#top">
        <BrandLockup size="sm" />
      </a>
      <nav className="home-anchors" aria-label="On this page">
        {ANCHORS.map((a) => (
          <a key={a.href} href={a.href}>
            {a.label}
          </a>
        ))}
      </nav>
      <div className="home-menu" ref={menuRef}>
        <button
          ref={toggleRef}
          type="button"
          className="btn ghost home-menu-toggle"
          aria-expanded={open}
          aria-controls="home-menu-list"
          onClick={() => setOpen((o) => !o)}
        >
          Menu
        </button>
        {open ? (
          <ul id="home-menu-list" className="home-menu-list">
            {ANCHORS.map((a) => (
              <li key={a.href}>
                <a href={a.href} onClick={() => setOpen(false)}>
                  {a.label}
                </a>
              </li>
            ))}
          </ul>
        ) : null}
      </div>
      <div className="home-auth">
        <Link className="btn home-btn-outline" to="/login">
          Log in
        </Link>
        <Link className="btn primary" to="/register">
          Sign up
        </Link>
      </div>
    </header>
  );
}
