-- 157_hd_invoice_po_number.sql
--
-- The customer's PO number on an HD invoice.
--
-- THIS ONE FIXES A LIVE BREAK, not just a gap.
--
-- Migration 153 added customer_po_number to hd_quotes and hd_work_orders, so the PO
-- travels quote -> work order. hd_invoices never got one: 135 added po_number to LD's
-- quotes and invoices, and nothing ever added either name to hd_invoices. Verified
-- against the live database with scripts/probe-hd-invoice-po.ts:
--
--   absent   hd_invoices.po_number
--   absent   hd_invoices.customer_po_number
--   EXISTS   hd_quotes.customer_po_number
--   EXISTS   hd_work_orders.customer_po_number
--   EXISTS   invoices.po_number
--
-- Meanwhile the work-order-to-invoice converter puts `po_number` in every invoice
-- payload it builds (src/lib/hd/wo-to-invoice.ts, invoiceIdentityFromWorkOrder). The
-- key is always present, null or not, so the insert fails for EVERY conversion with
-- "could not find the 'po_number' column" - not only the ones that have a PO. That is
-- my error from the previous pass, and the code change that goes with this migration
-- renames the field and adds the missing-column retry that should have been there.
--
-- WHY customer_po_number AND NOT po_number. It matches hd_quotes and hd_work_orders,
-- which is the chain this value travels down, and the converter copies it by name.
-- LD's invoices.po_number keeps its own name; LD is a separate table with separate
-- readers and renaming it would be a migration with no benefit.
--
-- A PO IS THE CUSTOMER'S WORDS, not a number the shop makes up. It is nullable with no
-- default, and blank is stored as NULL so the invoice prints a PO row only when the
-- customer actually gave one.
--
-- SAFE TO RUN TWICE. IF NOT EXISTS. Additive only.
--
-- ASCII ONLY, per the standing rule.

ALTER TABLE public.hd_invoices
  ADD COLUMN IF NOT EXISTS customer_po_number TEXT;

COMMENT ON COLUMN public.hd_invoices.customer_po_number IS
  'The customer PO this invoice bills against, copied from the work order (and before that the approved quote). A fleet that pays on PO does not pay an invoice without one, so it has to reach the bill. NULL = the customer did not give one.';

-- Finding every unpaid invoice for one PO is the question a fleet's accounts payable
-- actually asks. Partial, so it covers only the invoices that have a PO.
CREATE INDEX IF NOT EXISTS hd_invoices_customer_po_idx
  ON public.hd_invoices (user_id, customer_po_number)
  WHERE customer_po_number IS NOT NULL;

-- Verification. Expect one row, then one row.
--
--   SELECT column_name, data_type, is_nullable
--     FROM information_schema.columns
--    WHERE table_schema = 'public'
--      AND table_name   = 'hd_invoices'
--      AND column_name  = 'customer_po_number';
--
--   SELECT indexname FROM pg_indexes
--    WHERE schemaname = 'public' AND indexname = 'hd_invoices_customer_po_idx';
