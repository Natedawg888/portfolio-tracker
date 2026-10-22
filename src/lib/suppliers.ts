/**
 * Suppliers and the bills they send (KAN-107). A bill is for goods ('stock') or freight
 * ('delivery'); its freight part goes into stock cost or is an expense (deliveryTreatment).
 * Paid, unpaid and overdue are derived from paidOn and dueDate, never stored.
 */
export type BillKind = 'stock' | 'delivery';
export type BillStatus = 'paid' | 'unpaid' | 'overdue';
export type DeliveryTreatment = 'capitalise' | 'expense';

export interface Supplier {
  id: string;
  businessId: string;
  name: string;
  contactPerson: string;
  email: string;
  phone: string;
  address: string;
  nzbn: string;
  gstNumber: string;
  notes: string;
  billCount: number;
  /** Total of the supplier's bills not yet paid. */
  unpaidNzd: number;
  createdAt: string;
  updatedAt: string;
}

export interface SupplierBill {
  id: string;
  businessId: string;
  supplierId: string;
  supplierName: string;
  kind: BillKind;
  /** The supplier's own invoice number. */
  reference: string;
  invoiceDate: string;
  dueDate: string;
  amountNzd: number;
  /** Freight part of amountNzd: all of a delivery bill, the freight line of a goods bill. */
  deliveryNzd: number;
  deliveryTreatment: DeliveryTreatment;
  paidOn: string | null;
  /** The bank debit that paid it, when the user linked one. */
  transactionId: string | null;
  status: BillStatus;
  notes: string;
  file: { url: string; name: string; uploadedAt: string | null } | null;
  /** Stock batches this bill covers (same business). */
  batchIds: string[];
  createdAt: string;
  updatedAt: string;
}

export function isBillKind(v: unknown): v is BillKind {
  return v === 'stock' || v === 'delivery';
}

export function isDeliveryTreatment(v: unknown): v is DeliveryTreatment {
  return v === 'capitalise' || v === 'expense';
}

/** Overdue: unpaid and the due date has passed. Due today is still just unpaid. */
export function billStatus(paidOn: string | null, dueDate: string, today: string): BillStatus {
  if (paidOn) return 'paid';
  return dueDate < today ? 'overdue' : 'unpaid';
}
