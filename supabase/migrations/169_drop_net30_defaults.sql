-- 169: no payment terms until someone sets them.
--
-- WHY. Migration 077 added customers.payment_terms with DEFAULT 'net30', which filled
-- every customer that existed then and every one created since: 870 of 877 customers
-- read net30, almost none of them by anyone's choice. It became load-bearing when the
-- quote form started setting a quote's terms from the linked customer - so a quote
-- inherited Net 30 by accident, and a mobile shop that collects on receipt waited
-- thirty days. 077 gave hd_quotes.payment_terms the same 'net30' default.
--
-- WHAT THIS DOES. Drops BOTH column defaults. A new customer or quote has no terms
-- (NULL) until someone sets them. The code defaults were removed in the same pass
-- (/api/customers, the Intel Hub customer form, the HD quote form, the HD new-invoice
-- form, quote-to-invoice).
--
-- WHAT THIS DOES NOT DO. No existing row is changed - not one. The 870 stored net30
-- values stay as they are: 829 belong to another shop's import and may be real agreed
-- terms. The CHECK on customers.payment_terms (net15 / net30 / net45, migration 077)
-- already allows NULL and is left alone.
--
-- Schema only, no data. Ends in ROLLBACK: run it, read the checks, then change the
-- last line to COMMIT and run it again.
--
-- Preview and production share one database. Applying this applies it to both.

BEGIN;

-- Check 1 (before). The defaults as they stand: expect 'net30'::text on both.
SELECT table_name, column_name, column_default
  FROM information_schema.columns
 WHERE table_schema = 'public'
   AND column_name = 'payment_terms'
   AND table_name IN ('customers', 'hd_quotes')
 ORDER BY table_name;

-- Check 2 (before). Row counts by stored value, to compare after.
SELECT 'customers' AS tbl, coalesce(payment_terms, '(null)') AS terms, count(*) AS n
  FROM public.customers GROUP BY payment_terms
UNION ALL
SELECT 'hd_quotes', coalesce(payment_terms, '(null)'), count(*)
  FROM public.hd_quotes GROUP BY payment_terms
 ORDER BY 1, 2;

ALTER TABLE public.customers ALTER COLUMN payment_terms DROP DEFAULT;
ALTER TABLE public.hd_quotes ALTER COLUMN payment_terms DROP DEFAULT;

COMMENT ON COLUMN public.customers.payment_terms IS
  'Migration 169: no default. NULL = no terms set for this customer; never assume Net 30.';
COMMENT ON COLUMN public.hd_quotes.payment_terms IS
  'Migration 169: no default. NULL = no terms on this quote; prints nothing.';

-- Check 3 (after). Row counts again: must be IDENTICAL to check 2 - nothing was touched.
SELECT 'customers' AS tbl, coalesce(payment_terms, '(null)') AS terms, count(*) AS n
  FROM public.customers GROUP BY payment_terms
UNION ALL
SELECT 'hd_quotes', coalesce(payment_terms, '(null)'), count(*)
  FROM public.hd_quotes GROUP BY payment_terms
 ORDER BY 1, 2;

-- Check 4 (after, last, so it is the result the editor shows). Expect 2 rows, both
-- column_default NULL.
SELECT table_name, column_name, column_default, is_nullable
  FROM information_schema.columns
 WHERE table_schema = 'public'
   AND column_name = 'payment_terms'
   AND table_name IN ('customers', 'hd_quotes')
 ORDER BY table_name;

ROLLBACK;
