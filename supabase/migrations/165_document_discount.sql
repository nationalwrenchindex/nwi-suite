-- 165: a discount on LD quotes, work orders and invoices.
--
-- PER DOCUMENT: discount jsonb on quotes, work_orders and invoices.
--   {version 1, type flat|percent, value, scope labor|parts|document, reason,
--    labor_amount, parts_amount, amount, subtotal_before, tax_before,
--    pre_tax_breakdown}
--   The discount is RECORDED on the document with the amounts it produced. There is
--   no discount setting, so nothing in Settings can ever change a document's
--   discount. It carries quote -> work order -> invoice with the lines.
--   The document's existing money columns stay what they mean today:
--     grand_total / total   what the customer pays, after the discount and its tax
--     tax_amount            tax on the post-discount bases
--     tax_breakdown         the post-discount bases and their tax
--     invoices.subtotal     the pre-discount subtotal, as before
--   invoices.discount_amount already exists (default 0, nonzero on no row today) and
--   is written with the discount total, so a report that already reads it is right.
--
--   NULL means no discount - every existing row. Such a document prints exactly as
--   it did, with no discount row. Existing rows are not touched by this migration.
--
-- Nullable, no defaults, nothing backfilled. Additive only.
-- RLS: quotes, work_orders and invoices keep their existing row policies, which
-- cover new columns. Nothing to add.
--
-- Preview and production share one database. Applying this applies it to both.
-- The app does not wait for it: a save with no discount writes nothing new, and a
-- save WITH a discount before this is applied is refused with a message that names
-- this migration - never stored as a discounted total with no record of why.

BEGIN;

ALTER TABLE public.quotes      ADD COLUMN IF NOT EXISTS discount jsonb;
ALTER TABLE public.work_orders ADD COLUMN IF NOT EXISTS discount jsonb;
ALTER TABLE public.invoices    ADD COLUMN IF NOT EXISTS discount jsonb;

COMMENT ON COLUMN public.quotes.discount IS
  'Migration 165. The discount recorded on this quote (type, value, scope, reason, amounts applied). NULL = no discount.';
COMMENT ON COLUMN public.work_orders.discount IS
  'Migration 165. The discount carried from the quote or set on the work order. NULL = no discount.';
COMMENT ON COLUMN public.invoices.discount IS
  'Migration 165. The discount on this invoice; discount_amount holds its total. NULL = no discount.';

-- Check 1. Should return 3 rows, every one data_type jsonb, is_nullable YES.
SELECT table_name, column_name, data_type, is_nullable
  FROM information_schema.columns
 WHERE table_schema = 'public'
   AND table_name IN ('quotes', 'work_orders', 'invoices')
   AND column_name = 'discount'
 ORDER BY table_name;

-- Check 2. Nothing was backfilled and no invoice carries an old discount_amount.
-- Should return 0, 0, 0 and 0.
SELECT (SELECT count(*) FROM public.quotes      WHERE discount IS NOT NULL) AS quotes_with_discount,
       (SELECT count(*) FROM public.work_orders WHERE discount IS NOT NULL) AS work_orders_with_discount,
       (SELECT count(*) FROM public.invoices    WHERE discount IS NOT NULL) AS invoices_with_discount,
       (SELECT count(*) FROM public.invoices    WHERE discount_amount <> 0) AS invoices_with_old_discount_amount;

NOTIFY pgrst, 'reload schema';

COMMIT;
