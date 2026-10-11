/**
 * "+ Add cost" in place of a return when a holding has no cost. Opens a small
 * labelled input and saves through the existing holding update.
 */
import { useId, useState, type FormEvent } from 'react';

export function AddCostButton({
  name,
  onSave,
}: {
  name: string;
  /** Resolves true when saved. */
  onSave: (costNzd: number) => Promise<boolean>;
}) {
  const id = useId();
  const [open, setOpen] = useState(false);
  const [value, setValue] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(e: FormEvent) {
    e.preventDefault();
    const n = Number(value);
    if (!value.trim() || !Number.isFinite(n) || n <= 0) {
      setError('Enter what you paid, in NZD.');
      return;
    }
    setBusy(true);
    setError(null);
    const ok = await onSave(Math.round(n * 100) / 100);
    setBusy(false);
    if (ok) {
      setOpen(false);
      setValue('');
    }
  }

  if (!open) {
    return (
      <button type="button" className="add-cost-btn" onClick={() => setOpen(true)}>
        + Add cost<span className="sr-only"> for {name}</span>
      </button>
    );
  }
  return (
    <form
      className="add-cost-form"
      onSubmit={submit}
      onKeyDown={(e) => {
        if (e.key === 'Escape') setOpen(false);
      }}
    >
      <label htmlFor={id} className="sr-only">
        Cost of {name} (NZD)
      </label>
      <input
        id={id}
        type="number"
        inputMode="decimal"
        min="0.01"
        step="0.01"
        placeholder="NZD paid"
        value={value}
        onChange={(e) => setValue(e.target.value)}
        disabled={busy}
        autoFocus
      />
      <button type="submit" className="btn small primary" disabled={busy}>
        {busy ? 'Saving…' : 'Save'}
      </button>
      <button type="button" className="btn small ghost" disabled={busy} onClick={() => setOpen(false)}>
        Cancel
      </button>
      {error ? (
        <span className="add-cost-error" role="alert">
          {error}
        </span>
      ) : null}
    </form>
  );
}
