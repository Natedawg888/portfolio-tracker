/**
 * Personal / Business pill. Reused by the linked-account list and, later, the header switcher.
 * Colours follow the saved theme (html[data-theme]), in both the light linen palette and the dark one.
 */
export function AccountTypePill({ type }: { type: 'personal' | 'business' }) {
  return <span className={`account-type-pill account-type-pill--${type}`}>{type === 'personal' ? 'Personal' : 'Business'}</span>;
}
