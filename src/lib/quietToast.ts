/**
 * Quiet, non-blocking toast for background sync / quote soft-failures.
 * Keeps page data visible — never clears tables.
 */
export type QuietToastKind = 'info' | 'warn';

export type QuietToastDetail = {
  message: string;
  kind?: QuietToastKind;
  /** Auto-dismiss ms (default 6s). */
  ttlMs?: number;
};

const EVENT = 'pt:quiet-toast';

export function showQuietToast(message: string, opts: Omit<QuietToastDetail, 'message'> = {}): void {
  if (typeof window === 'undefined') return;
  const detail: QuietToastDetail = {
    message,
    kind: opts.kind ?? 'warn',
    ttlMs: opts.ttlMs ?? 6000,
  };
  window.dispatchEvent(new CustomEvent<QuietToastDetail>(EVENT, { detail }));
}

export function subscribeQuietToast(handler: (detail: QuietToastDetail) => void): () => void {
  if (typeof window === 'undefined') return () => {};
  const listener = (ev: Event) => {
    const ce = ev as CustomEvent<QuietToastDetail>;
    if (ce.detail?.message) handler(ce.detail);
  };
  window.addEventListener(EVENT, listener);
  return () => window.removeEventListener(EVENT, listener);
}
