/** Scrolling to and focusing things a Value Search link points at (add forms, holding rows). */

/** Focus the first blank field in a form, or its first field when all are filled. */
export function focusFirstEmptyField(container: Element): void {
  const fields = [...container.querySelectorAll<HTMLInputElement | HTMLSelectElement>('input, select')].filter(
    (f) => !f.disabled && f.type !== 'file' && f.type !== 'hidden',
  );
  (fields.find((f) => f.value.trim() === '') ?? fields[0])?.focus({ preventScroll: true });
}

/** Open an add `<details>`, scroll to it and focus its first blank field. */
export function revealAddForm(details: HTMLDetailsElement): void {
  details.open = true;
  details.scrollIntoView({ behavior: 'smooth', block: 'start' });
  focusFirstEmptyField(details);
}

/** Scroll to a holding row or card, focus it (rows carry tabIndex -1) and flash it briefly. */
export function revealHolding(el: HTMLElement): void {
  el.scrollIntoView({ behavior: 'smooth', block: 'center' });
  el.focus({ preventScroll: true });
  el.classList.add('holding-flash');
  window.setTimeout(() => el.classList.remove('holding-flash'), 2400);
}

/**
 * Poll for an element that appears once data loads, a tab renders or a modal opens,
 * then act on it. Returns a cancel function for effect cleanup.
 */
export function whenElementAppears(id: string, act: (el: HTMLElement) => void, timeoutMs = 8000): () => void {
  const started = Date.now();
  const timer = window.setInterval(() => {
    const el = document.getElementById(id);
    if (el) {
      window.clearInterval(timer);
      act(el);
    } else if (Date.now() - started > timeoutMs) {
      window.clearInterval(timer);
    }
  }, 100);
  return () => window.clearInterval(timer);
}
