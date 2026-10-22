-- 164: the terms block on LD quotes and invoices
--      (docs/NWI-ESTIMATE-DOCUMENT-SPEC.md section 2.8, build-order item 3).
--
-- SHOP LEVEL, set once in Settings (profiles):
--   warranty_terms                  e.g. 90 days / 4,000 miles on workmanship
--   customer_supplied_parts_clause  a customer's own part is not warranted and a
--                                   re-diagnosis is billable - in writing
--   pay_link_url                    an https link the customer pays at
-- Payment terms (default_payment_terms) and how to pay / remit address
-- (default_payment_instructions) already exist and are reused, not duplicated.
--
-- PER DOCUMENT (quotes, invoices): terms_snapshot jsonb.
--   RECORDED VALUES BEAT CURRENT SETTINGS. A quote records the shop's terms when it is
--   SENT and an invoice when it is FINALIZED; the customer's copy prints what was
--   recorded. Changing the warranty in Settings next year cannot rewrite a document a
--   customer already holds.
--   NULL means the document predates this - it prints exactly as it did, with no
--   terms block. Existing rows are not touched by this migration.
--
-- All columns nullable, no defaults, nothing backfilled. Additive only.
-- RLS: profiles, quotes and invoices keep their existing row policies, which cover
-- new columns. Nothing to add.
--
-- Preview and production share one database. Applying this applies it to both.
-- The app does not wait for it: every read and write of these columns tolerates them
-- being absent, and Settings says plainly that this migration is needed.

BEGIN;

ALTER TABLE public.profiles ADD COLUMN IF NOT EXISTS warranty_terms                 text;
ALTER TABLE public.profiles ADD COLUMN IF NOT EXISTS customer_supplied_parts_clause text;
ALTER TABLE public.profiles ADD COLUMN IF NOT EXISTS pay_link_url                   text;

ALTER TABLE public.quotes   ADD COLUMN IF NOT EXISTS terms_snapshot jsonb;
ALTER TABLE public.invoices ADD COLUMN IF NOT EXISTS terms_snapshot jsonb;

COMMENT ON COLUMN public.profiles.warranty_terms IS
  'Spec 2.8. Shop warranty text printed in the terms block of every LD quote and invoice. Recorded onto each document when sent/finalized.';
COMMENT ON COLUMN public.profiles.customer_supplied_parts_clause IS
  'Spec 2.8. Customer-supplied parts policy printed in the terms block. Recorded onto each document when sent/finalized.';
COMMENT ON COLUMN public.profiles.pay_link_url IS
  'Spec 2.8. https link the customer pays at, printed under How to pay. The app accepts https only.';
COMMENT ON COLUMN public.quotes.terms_snapshot IS
  'The shop terms in force when this quote was first sent. NULL = sent before migration 164; prints no terms block.';
COMMENT ON COLUMN public.invoices.terms_snapshot IS
  'The shop terms in force when this invoice was finalized. NULL = finalized before migration 164; prints no terms block.';

-- Check 1. Should return 5 rows, every one data_type text or jsonb, is_nullable YES.
SELECT table_name, column_name, data_type, is_nullable
  FROM information_schema.columns
 WHERE table_schema = 'public'
   AND ((table_name = 'profiles' AND column_name IN ('warranty_terms', 'customer_supplied_parts_clause', 'pay_link_url'))
     OR (table_name IN ('quotes', 'invoices') AND column_name = 'terms_snapshot'))
 ORDER BY table_name, column_name;

-- Check 2. Nothing was backfilled. Should return 0 and 0.
SELECT (SELECT count(*) FROM public.quotes   WHERE terms_snapshot IS NOT NULL) AS quotes_with_terms,
       (SELECT count(*) FROM public.invoices WHERE terms_snapshot IS NOT NULL) AS invoices_with_terms;

NOTIFY pgrst, 'reload schema';

COMMIT;
