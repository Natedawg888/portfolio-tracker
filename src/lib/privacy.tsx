/**
 * App-wide preference to hide monetary values (privacy / shoulder-surfing).
 * Persisted in localStorage. formatNzd() / formatMoney() read the live flag.
 *
 * Toggle updates React via useSyncExternalStore + MoneyHiddenProvider so money
 * displays refresh without window.location.reload().
 */
import { createContext, useContext, useSyncExternalStore, type ReactNode } from 'react';

export const MONEY_HIDDEN_STORAGE_KEY = 'portfolio-tracker-money-hidden';

/** Unicode bullets used when amounts are masked. */
export const MONEY_MASK = '•••';

let moneyHidden = readInitial();
const listeners = new Set<() => void>();

function readInitial(): boolean {
  try {
    return localStorage.getItem(MONEY_HIDDEN_STORAGE_KEY) === '1';
  } catch {
    return false;
  }
}

function persist(hidden: boolean): void {
  try {
    localStorage.setItem(MONEY_HIDDEN_STORAGE_KEY, hidden ? '1' : '0');
  } catch {
    /* private mode / blocked storage */
  }
}

export function isMoneyHidden(): boolean {
  return moneyHidden;
}

export function setMoneyHidden(hidden: boolean): void {
  if (moneyHidden === hidden) return;
  moneyHidden = hidden;
  persist(hidden);
  listeners.forEach((l) => l());
}

export function toggleMoneyHidden(): boolean {
  setMoneyHidden(!moneyHidden);
  return moneyHidden;
}

export function subscribeMoneyHidden(onStoreChange: () => void): () => void {
  listeners.add(onStoreChange);
  return () => {
    listeners.delete(onStoreChange);
  };
}

/** Subscribe in React so toggling re-renders. */
export function useMoneyHidden(): boolean {
  return useSyncExternalStore(subscribeMoneyHidden, isMoneyHidden, () => false);
}

const MoneyHiddenContext = createContext<boolean>(false);

/**
 * Provides money-hidden state. Masking is applied in formatNzd during render,
 * so this must not remount children or touch the page cache. Layout passes a
 * changing moneyHidden prop into the routed page so that render runs again.
 */
export function MoneyHiddenProvider({ children }: { children: ReactNode }) {
  const hidden = useMoneyHidden();
  return (
    <MoneyHiddenContext.Provider value={hidden}>
      <div
        className="money-privacy-root"
        data-money-hidden={hidden ? '1' : '0'}
        style={{ display: 'contents' }}
      >
        {children}
      </div>
    </MoneyHiddenContext.Provider>
  );
}

/** Context value from nearest MoneyHiddenProvider (defaults false). */
export function useMoneyHiddenContext(): boolean {
  return useContext(MoneyHiddenContext);
}
