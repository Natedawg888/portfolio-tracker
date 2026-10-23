/**
 * The Take-home pay / Economic cycle switch on the PAYE pages. Same segmented pill control as
 * the Projections mode switch (the active one is a solid accent pill). Each is its own page, so
 * they are links, and the current one has aria-current="page".
 */
import { Link, useLocation } from 'react-router-dom';

const TABS = [
  { to: '/paye', label: 'Take-home pay', match: (p: string) => p === '/paye' },
  { to: '/paye/economic-cycle', label: 'Economic cycle', match: (p: string) => p.startsWith('/paye/economic-cycle') },
];

export function PayeTabs() {
  const { pathname } = useLocation();
  const active = Math.max(0, TABS.findIndex((t) => t.match(pathname)));
  return (
    <nav className="segmented paye-tabs" aria-label="PAYE">
      {TABS.map((t, i) => (
        <Link key={t.to} to={t.to} aria-current={i === active ? 'page' : undefined} className={`segmented-btn${i === active ? ' active' : ''}`}>
          {t.label}
        </Link>
      ))}
    </nav>
  );
}
