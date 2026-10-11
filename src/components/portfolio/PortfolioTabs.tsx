/**
 * Portfolio tab bar. Arrow keys move between tabs (Home / End jump); only the
 * selected tab is in the tab order. The selected tab lives in the URL hash.
 */
import { useRef } from 'react';
import { nextTab, panelId, TAB_LABELS, tabId, type PortfolioTab } from '../../lib/portfolioView';

export function PortfolioTabs({
  tabs,
  active,
  onSelect,
}: {
  tabs: PortfolioTab[];
  active: PortfolioTab;
  onSelect: (tab: PortfolioTab) => void;
}) {
  const listRef = useRef<HTMLDivElement>(null);

  return (
    <div
      ref={listRef}
      className="portfolio-tabs"
      role="tablist"
      aria-label="Portfolio sections"
      onKeyDown={(e) => {
        const target = nextTab(tabs, active, e.key);
        if (!target) return;
        e.preventDefault();
        onSelect(target);
        listRef.current?.querySelector<HTMLButtonElement>(`#${tabId(target)}`)?.focus();
      }}
    >
      {tabs.map((t) => (
        <button
          key={t}
          id={tabId(t)}
          type="button"
          role="tab"
          className={'portfolio-tab' + (t === active ? ' active' : '')}
          aria-selected={t === active}
          aria-controls={panelId(t)}
          tabIndex={t === active ? 0 : -1}
          onClick={() => onSelect(t)}
        >
          {TAB_LABELS[t]}
        </button>
      ))}
    </div>
  );
}
