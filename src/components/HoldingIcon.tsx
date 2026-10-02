/**
 * Holding / fund card icon with cascade:
 *   Crypto: preferred → CoinGecko well-known → cryptocurrency-icons CDN → letters
 *   Stock:  preferred (Akahu/Sharesies) → FMP → Parqet → IEX → logo.dev → Clearbit → letters
 * Icons only — never used for prices.
 */
import { useEffect, useMemo, useState, type SyntheticEvent } from 'react';
import {
  buildCryptoIconChain,
  buildStockIconChain,
  letterChars,
} from '../lib/holdingIcons';

function holdingIconChain(
  ticker: string,
  assetClass: string,
  preferredUrl?: string | null,
): string[] {
  if (assetClass === 'crypto') return buildCryptoIconChain(ticker, preferredUrl);
  if (assetClass === 'stock') return buildStockIconChain(ticker, preferredUrl);
  if (assetClass === 'real_estate' || assetClass === 'collectable' || assetClass === 'art') {
    return preferredUrl?.trim() ? [preferredUrl.trim()] : [];
  }
  return preferredUrl?.trim() ? [preferredUrl.trim()] : [];
}

export function HoldingIcon({
  ticker,
  assetClass,
  iconUrl,
}: {
  ticker: string;
  assetClass: string;
  /** Optional Akahu / CoinGecko / photo thumb — tried first in the cascade. */
  iconUrl?: string | null;
}) {
  const chain = useMemo(
    () => holdingIconChain(ticker, assetClass, iconUrl),
    [ticker, assetClass, iconUrl],
  );
  const [failed, setFailed] = useState<Set<string>>(() => new Set());
  /** True only after a candidate paints a real (non-placeholder) bitmap. */
  const [imgOk, setImgOk] = useState(false);

  // Reset cascade when ticker / preferred URL changes
  useEffect(() => {
    setFailed(new Set());
    setImgOk(false);
  }, [ticker, assetClass, iconUrl]);

  const url = chain.find((u) => !failed.has(u)) ?? null;

  // Always render the letter avatar underneath. Ad blockers often "succeed" with a
  // 1×1 transparent GIF so onError never fires — without the avatar, cards look empty.
  return (
    <span
      className={`holding-icon-wrap holding-avatar asset-${assetClass}`}
      aria-hidden
    >
      {!imgOk ? letterChars(ticker) : null}
      {url ? (
        <img
          key={url}
          className="holding-icon-img"
          src={url}
          alt=""
          width={36}
          height={36}
          loading="eager"
          decoding="async"
          onLoad={(e: SyntheticEvent<HTMLImageElement>) => {
            const img = e.currentTarget;
            // Reject tracker-blocker placeholders / broken tiny bitmaps.
            if (img.naturalWidth >= 8 && img.naturalHeight >= 8) {
              setImgOk(true);
              return;
            }
            setImgOk(false);
            setFailed((prev) => {
              if (prev.has(url)) return prev;
              const next = new Set(prev);
              next.add(url);
              return next;
            });
          }}
          onError={(_e: SyntheticEvent<HTMLImageElement>) => {
            setImgOk(false);
            setFailed((prev) => {
              if (prev.has(url)) return prev;
              const next = new Set(prev);
              next.add(url);
              return next;
            });
          }}
          style={{ display: imgOk ? 'block' : 'none' }}
        />
      ) : null}
    </span>
  );
}
