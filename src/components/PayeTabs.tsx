/** The Take-home pay / Economic cycle tabs on the PAYE pages. */
import { useRef, type KeyboardEvent } from 'react';
import { Link, useLocation } from 'react-router-dom';

const TABS = [
  { to: '/paye', label: 'Take-home pay', match: (p: string) => p === '/paye' },
  { to: '/paye/economic-cycle', label: 'Economic cycle', match: (p: string) => p.startsWith('/paye/economic-cycle') },
];

/** Each tab is its own page, so the tabs are links; arrow keys move between them. */
export function PayeTabs() {
  const { pathname } = useLocation();
  const listRef = useRef<HTMLDivElement>(null);
  const active = Math.max(0, TABS.findIndex((t) => t.match(pathname)));
  function onKeyDown(e: KeyboardEvent<HTMLDivElement>) {
    const links = [...(listRef.current?.querySelectorAll<HTMLAnchorElement>('[role="tab"]') ?? [])];
    const i = links.indexOf(document.activeElement as HTMLAnchorElement);
    if (i < 0) return;
    const next = e.key === 'ArrowRight' ? (i + 1) % links.length : e.key === 'ArrowLeft' ? (i - 1 + links.length) % links.length : e.key === 'Home' ? 0 : e.key === 'End' ? links.length - 1 : -1;
    if (next < 0) return;
    e.preventDefault();
    links[next].focus();
  }
  return (
    <div ref={listRef} className="portfolio-tabs paye-tabs" role="tablist" aria-label="PAYE" onKeyDown={onKeyDown}>
      {TABS.map((t, i) => (
        <Link key={t.to} to={t.to} role="tab" aria-selected={i === active} tabIndex={i === active ? 0 : -1} className={`portfolio-tab${i === active ? ' active' : ''}`}>
          {t.label}
        </Link>
      ))}
    </div>
  );
}
