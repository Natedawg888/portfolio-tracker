/**
 * Portfolio header: small label, total, "Updated … · prices from …", an ⓘ for
 * the metal-spot note, and one "Refresh all prices" button with progress.
 */
import type { ReactNode } from 'react';
import { formatAuckland, formatNzd } from '../../api/client';
import { InfoTip } from '../InfoTip';

export type RefreshProgress = { label: string; step: number; steps: number };

export function PortfolioHeader({
  total,
  asOf,
  sources,
  info,
  progress,
  onRefreshAll,
}: {
  total: number | null;
  asOf: string | null;
  sources: string[];
  info: ReactNode;
  progress: RefreshProgress | null;
  onRefreshAll: () => void;
}) {
  return (
    <section className="hero-card portfolio-header" aria-labelledby="portfolio-title">
      <div className="portfolio-header-main">
        <h2 id="portfolio-title" className="eyebrow page-title">
          Portfolio
          <InfoTip label="About portfolio prices">{info}</InfoTip>
        </h2>
        <p className="hero-value">{total == null ? '—' : formatNzd(total)}</p>
        <p className="muted small portfolio-header-line">
          {asOf ? `Updated ${formatAuckland(asOf)} NZT` : 'Loading…'}
          {sources.length > 0 ? ` · prices from ${sources.join(', ')}` : ''}
        </p>
      </div>
      <div className="portfolio-header-refresh">
        <button type="button" className="btn small" onClick={onRefreshAll} disabled={progress != null}>
          {progress ? 'Refreshing…' : 'Refresh all prices'}
        </button>
        <p className="muted small portfolio-refresh-status" role="status" aria-live="polite">
          {progress ? `${progress.label} (${progress.step} of ${progress.steps})` : ''}
        </p>
        {progress ? (
          <div
            className="portfolio-refresh-bar"
            role="progressbar"
            aria-label="Refreshing prices"
            aria-valuemin={0}
            aria-valuemax={progress.steps}
            aria-valuenow={progress.step - 1}
          >
            <span style={{ width: `${((progress.step - 1) / progress.steps) * 100}%` }} />
          </div>
        ) : null}
      </div>
    </section>
  );
}
