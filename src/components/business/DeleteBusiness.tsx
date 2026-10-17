/**
 * "Delete business…" from the overview card's menu or the business page's menu. A business with
 * no invoices is deleted outright. Invoices are kept on record, so a business with invoices is
 * archived instead: hidden from Business, net worth and the pickers, kept with everything, and
 * restorable from the Archived list.
 */
import { useState } from 'react';
import { api } from '../../api/client';
import { ConfirmInline } from '../security/ConfirmInline';
import { errorText } from './BusinessUi';

export function DeleteBusinessConfirm({ id, name, invoiceCount, onDone, onCancel }: {
  id: string;
  name: string;
  invoiceCount: number;
  /** After it is deleted or archived; the message to show. */
  onDone: (message: string, archived: boolean) => void;
  onCancel: () => void;
}) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const archive = invoiceCount > 0;
  const invoices = `${invoiceCount} invoice${invoiceCount === 1 ? '' : 's'}`;

  async function confirm() {
    setBusy(true);
    setError(null);
    try {
      if (archive) {
        await api.business.archive(id);
        onDone(`${name} archived. Restore it any time from Archived on Business.`, true);
      } else {
        await api.business.remove(id);
        onDone(`${name} deleted.`, false);
      }
    } catch (e) {
      setError(errorText(e, archive ? 'Could not archive it.' : 'Could not delete it.'));
      setBusy(false);
    }
  }

  return archive ? (
    <ConfirmInline
      title={`Archive ${name}?`}
      confirmLabel="Archive business"
      confirmAriaLabel={`Archive ${name}`}
      cancelLabel="Keep it"
      tone="warn"
      focus="cancel"
      busy={busy}
      error={error}
      onConfirm={() => void confirm()}
      onCancel={onCancel}
    >
      <p>
        {name} has {invoices}. Invoices are kept on record, so it can’t be deleted. Archiving hides it from Business, your net
        worth and the invoice and client pickers.
      </p>
      <p>
        <strong>Kept:</strong> its invoices, assets, clients, employees and tagged money. You can restore it any time.
      </p>
    </ConfirmInline>
  ) : (
    <ConfirmInline
      title={`Delete ${name}?`}
      confirmLabel="Delete business"
      confirmAriaLabel={`Delete ${name}`}
      cancelLabel="Keep it"
      tone="danger"
      focus="cancel"
      busy={busy}
      error={error}
      onConfirm={() => void confirm()}
      onCancel={onCancel}
    >
      <p>
        <strong>Removed:</strong> its assets and their history, its clients, its employees and its logo.
      </p>
      <p>
        <strong>Kept:</strong> transactions and income tagged to it stay in Budget and Income, and produce stays on Portfolio, all
        untagged. This can’t be undone.
      </p>
    </ConfirmInline>
  );
}
