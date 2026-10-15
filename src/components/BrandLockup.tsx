/**
 * KoruLedger logo lockup (KAN-49): the koru icon, the "Koru Ledger" wordmark and the
 * "Track · Plan · Grow" tagline underneath. The wordmark's "Koru" is cream in the
 * original artwork, so light theme uses a copy with dark text; CSS shows the one
 * matching data-theme. Assets: public/brand/ (made from the koru-*.png sources).
 */
export const BRAND_NAME = 'KoruLedger';
export const BRAND_TAGLINE = 'Track · Plan · Grow';

export function BrandLockup({
  size = 'md',
  icon = true,
  tagline,
  className = '',
}: {
  size?: 'sm' | 'md' | 'lg';
  icon?: boolean;
  /** Defaults to on for md / lg. At sm the tagline would be a few pixels tall. */
  tagline?: boolean;
  className?: string;
}) {
  const showTagline = tagline ?? size !== 'sm';
  return (
    <span className={`brand-lockup brand-lockup--${size} ${className}`.trim()}>
      {icon ? <img className="brand-lockup-icon" src="/brand/koru-icon-192.png" alt="" width="192" height="192" /> : null}
      <span className="brand-lockup-text">
        <img className="brand-wordmark brand-wordmark--light" src="/brand/koru-wordmark-light.png" alt={BRAND_NAME} width="480" height="81" />
        <img className="brand-wordmark brand-wordmark--dark" src="/brand/koru-wordmark-dark.png" alt={BRAND_NAME} width="480" height="81" />
        {showTagline ? <img className="brand-tagline" src="/brand/koru-tagline.png" alt={BRAND_TAGLINE} width="480" height="21" /> : null}
      </span>
    </span>
  );
}
