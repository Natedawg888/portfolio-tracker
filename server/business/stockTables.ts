/**
 * Stock, suppliers, sales, wages and budget tables (KAN-107). Every row carries user_id and
 * business_id, so deleting a business or an account is one DELETE per table. Children come
 * before their parents, which account deletion relies on for its order.
 */
export const BUSINESS_STOCK_TABLES = [
  'business_sale_lines',
  'business_sales',
  'business_supplier_invoice_batches',
  'business_supplier_invoices',
  'business_suppliers',
  'business_stock_adjustments',
  'business_stock_batches',
  'business_stock_items',
  'business_wage_payments',
  'business_budget_plans',
  'business_budget_categories',
] as const;
