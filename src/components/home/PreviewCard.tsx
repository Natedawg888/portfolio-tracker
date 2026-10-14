/**
 * Home page preview: example figures only (never a real user's data), in tabs.
 * Tabs follow the WAI-ARIA pattern: arrow keys, Home and End move and select;
 * only the selected tab is in the tab order.
 */
import { useRef, useState } from 'react';
import { PREVIEW_TABS, nextPreviewTab, previewData, type PreviewTab } from '../../lib/homePreview';

const nzd = (n: number) =>
  new Intl.NumberFormat('en-NZ', { style: 'currency', currency: 'NZD', maximumFractionDigits: n % 1 === 0 ? 0 : 2 }).format(n);

const tabId = (t: PreviewTab) => `home-preview-tab-${t}`;
const panelId = (t: PreviewTab) => `home-preview-panel-${t}`;

export function PreviewCard() {
  const [active, setActive] = useState<PreviewTab>('networth');
  const listRef = useRef<HTMLDivElement>(null);
  const d = previewData(active);
  const total = d.rows.reduce((s, r) => s + r.amount, 0);

  return (
    <section className="panel home-preview" aria-labelledby="home-preview-title">
      <div className="home-preview-head">
        <h2 id="home-preview-title" className="home-preview-title">
          What you’ll see
        </h2>
        <span className="home-example-badge">Example</span>
      </div>
      <div
        ref={listRef}
        className="segmented home-preview-tabs"
        role="tablist"
        aria-label="Example views"
        onKeyDown={(e) => {
          const next = nextPreviewTab(active, e.key);
          if (!next) return;
          e.preventDefault();
          setActive(next);
          listRef.current?.querySelector<HTMLButtonElement>(`#${tabId(next)}`)?.focus();
        }}
      >
        {PREVIEW_TABS.map((t) => (
          <button
            key={t.id}
            id={tabId(t.id)}
            type="button"
            role="tab"
            className={'segmented-btn' + (t.id === active ? ' active' : '')}
            aria-selected={t.id === active}
            aria-controls={panelId(t.id)}
            tabIndex={t.id === active ? 0 : -1}
            onClick={() => setActive(t.id)}
          >
            {t.label}
          </button>
        ))}
      </div>
      <div id={panelId(active)} role="tabpanel" aria-labelledby={tabId(active)} tabIndex={0} className="home-preview-panel">
        <p className="home-preview-label">{d.figureLabel}</p>
        <p className="home-preview-figure">{nzd(d.figure)}</p>
        <p className="home-preview-summary">{d.summary}</p>
        <div className="home-bar" role="img" aria-label={`${d.barLabel}: ${d.rows.map((r) => `${r.label} ${nzd(r.amount)}`).join(', ')}`}>
          {d.rows.map((r) => (
            <span key={r.label} className={`home-bar-seg home-tone-${r.tone}`} style={{ flexGrow: r.amount / total }} />
          ))}
        </div>
        <ul className="home-preview-rows">
          {d.rows.map((r) => (
            <li key={r.label}>
              <span className={`home-swatch home-tone-${r.tone}`} aria-hidden="true" />
              <span className="home-row-label">{r.label}</span>
              <span className="home-row-amount">{nzd(r.amount)}</span>
            </li>
          ))}
        </ul>
        <p className="home-preview-note">Made-up figures to show the layout.</p>
      </div>
    </section>
  );
}
