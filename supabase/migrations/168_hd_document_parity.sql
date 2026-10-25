-- 168: HD document parity - the discount (LD 165) and the terms block (LD 164) on
--      HD quotes, work orders and invoices.
--
-- PER DOCUMENT, on hd_quotes, hd_work_orders and hd_invoices:
--
--   discount jsonb - the SAME shape LD stores (src/lib/document-discount.ts), so the
--   shared engine, reader and printer work unchanged:
--     {version 1, type flat|percent, value, scope labor|parts|document, reason,
--      labor_amount, parts_amount, amount, subtotal_before, tax_before,
--      pre_tax_breakdown}
--   The discount is RECORDED with the amounts it produced. There is no discount
--   setting, so nothing in Settings can change a document's discount. It carries
--   quote -> work order -> invoice. The money columns keep their meaning:
--   total / total_amount is what the customer pays after the discount and its tax;
--   tax_amount and tax_breakdown are the post-discount figures.
--
--   terms_snapshot jsonb - the SAME shape LD stores (src/lib/document-terms.ts):
--   warranty text, customer-supplied parts clause, payment terms, how to pay /
--   remit, pay link. RECORDED VALUES BEAT CURRENT SETTINGS: the document prints the
--   terms it recorded, never the shop's terms today. The work order column carries
--   the quote's recorded terms through to the invoice.
--
--   NULL means none - every existing row. Such a document prints and totals exactly
--   as it does today: no discount row, no terms block. Existing rows are not touched.
--
-- SHOP SETTINGS: nothing to add. HD reads the same profiles row as LD, which
-- already has warranty_terms, customer_supplied_parts_clause, pay_link_url (164),
-- default_payment_terms and default_payment_instructions (143).
--
-- NET 3: the payment terms list is a TypeScript constant (PAYMENT_TERMS in
-- src/lib/hd/payment-terms.ts), shared by LD and HD. No database constraint governs
-- document payment terms, so Net 3 is added in the app, not here.
--
-- Nullable, no defaults, nothing backfilled. Additive only.
-- RLS: the three tables keep their existing row policies (user_id = auth.uid()),
-- which cover new columns. Nothing to add.
--
-- Preview and production share one database. Applying this applies it to both.

BEGIN;

ALTER TABLE public.hd_quotes      ADD COLUMN IF NOT EXISTS discount       jsonb;
ALTER TABLE public.hd_work_orders ADD COLUMN IF NOT EXISTS discount       jsonb;
ALTER TABLE public.hd_invoices    ADD COLUMN IF NOT EXISTS discount       jsonb;

ALTER TABLE public.hd_quotes      ADD COLUMN IF NOT EXISTS terms_snapshot jsonb;
ALTER TABLE public.hd_work_orders ADD COLUMN IF NOT EXISTS terms_snapshot jsonb;
ALTER TABLE public.hd_invoices    ADD COLUMN IF NOT EXISTS terms_snapshot jsonb;

COMMENT ON COLUMN public.hd_quotes.discount IS
  'Migration 168. The discount recorded on this quote (type, value, scope, reason, amounts applied). NULL = no discount.';
COMMENT ON COLUMN public.hd_work_orders.discount IS
  'Migration 168. The discount carried from the quote or set on the work order. NULL = no discount.';
COMMENT ON COLUMN public.hd_invoices.discount IS
  'Migration 168. The discount on this invoice, with the amounts it produced. NULL = no discount.';
COMMENT ON COLUMN public.hd_quotes.terms_snapshot IS
  'Migration 168. The shop terms recorded on this quote. NULL = none recorded; prints no terms block.';
COMMENT ON COLUMN public.hd_work_orders.terms_snapshot IS
  'Migration 168. The terms carried from the quote, through to the invoice. NULL = none recorded.';
COMMENT ON COLUMN public.hd_invoices.terms_snapshot IS
  'Migration 168. The shop terms recorded on this invoice. NULL = none recorded; prints no terms block.';

-- Check 1. Nothing was backfilled. Should return six zeros.
SELECT (SELECT count(*) FROM public.hd_quotes      WHERE discount       IS NOT NULL) AS quotes_with_discount,
       (SELECT count(*) FROM public.hd_work_orders WHERE discount       IS NOT NULL) AS work_orders_with_discount,
       (SELECT count(*) FROM public.hd_invoices    WHERE discount       IS NOT NULL) AS invoices_with_discount,
       (SELECT count(*) FROM public.hd_quotes      WHERE terms_snapshot IS NOT NULL) AS quotes_with_terms,
       (SELECT count(*) FROM public.hd_work_orders WHERE terms_snapshot IS NOT NULL) AS work_orders_with_terms,
       (SELECT count(*) FROM public.hd_invoices    WHERE terms_snapshot IS NOT NULL) AS invoices_with_terms;

-- Check 2 (last, so it is the result the editor shows). Should return 6 rows, every
-- one data_type jsonb, is_nullable YES, column_default NULL.
SELECT table_name, column_name, data_type, is_nullable, column_default
  FROM information_schema.columns
 WHERE table_schema = 'public'
   AND table_name IN ('hd_quotes', 'hd_work_orders', 'hd_invoices')
   AND column_name IN ('discount', 'terms_snapshot')
 ORDER BY table_name, column_name;

NOTIFY pgrst, 'reload schema';

COMMIT;
