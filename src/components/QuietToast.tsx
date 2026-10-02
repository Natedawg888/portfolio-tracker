import { useEffect, useState } from 'react';
import {
  subscribeQuietToast,
  type QuietToastDetail,
  type QuietToastKind,
} from '../lib/quietToast';

type ToastState = {
  id: number;
  message: string;
  kind: QuietToastKind;
};

let seq = 0;

export function QuietToast() {
  const [toast, setToast] = useState<ToastState | null>(null);

  useEffect(() => {
    let timer: ReturnType<typeof setTimeout> | null = null;
    const unsub = subscribeQuietToast((detail: QuietToastDetail) => {
      if (timer) clearTimeout(timer);
      const id = ++seq;
      setToast({
        id,
        message: detail.message,
        kind: detail.kind ?? 'warn',
      });
      timer = setTimeout(() => {
        setToast((cur) => (cur?.id === id ? null : cur));
      }, detail.ttlMs ?? 6000);
    });
    return () => {
      unsub();
      if (timer) clearTimeout(timer);
    };
  }, []);

  if (!toast) return null;

  return (
    <div
      className={'quiet-toast' + (toast.kind === 'warn' ? ' quiet-toast--warn' : '')}
      role="status"
      aria-live="polite"
    >
      <span className="quiet-toast-msg">{toast.message}</span>
      <button
        type="button"
        className="quiet-toast-dismiss"
        aria-label="Dismiss"
        onClick={() => setToast(null)}
      >
        ×
      </button>
    </div>
  );
}
