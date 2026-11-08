-- =============================================================================
-- Customers carrying the invented surname "Unknown". Clears the surname only.
-- =============================================================================
--
-- Until 6b41bd25 (Nov 5, 2026) a customer typed with one name ("Jesus") was saved
-- with last_name 'Unknown', and every document addressed them as "Jesus Unknown"
-- (QT-2026-0008 prints it). The code now saves the surname as '' (lib/customer-name).
-- These are the rows from before that fix.
--
-- Read on Nov 8, 2026: exactly 29 rows have last_name = 'Unknown' (case-insensitive,
-- no other spelling). 26 belong to a560c8b6, 2 to bbfa6ed5, 1 to 4a8c046f (Jesus,
-- 9398bc26). No customer has first_name 'Unknown'.
--
-- last_name is NOT NULL (001_initial_schema), so it is set to '' - the value the fixed
-- code writes - never NULL. first_name and everything else are left alone.
--
-- WHAT PRINTS AFTERWARDS: LD quotes, work orders and invoices store no copy of the
-- name - they hold customer_id and read the customer row when they render - so the
-- customer copy of every LD document, sent or not, reads "Jesus" from then on. HD
-- documents DO keep their own customer_name; a read on Nov 8 found none containing
-- "Unknown", so nothing on HD changes. No money column is touched.
--
-- The count check refuses the whole file unless the set is exactly 29.
--
-- ENDS IN COMMIT (armed for Brock, Nov 8, 2026). The count checks still refuse the whole file.
-- Preview and production share one database.

BEGIN;

-- Before: must be 29.
SELECT count(*) AS unknown_surnames_before
  FROM public.customers
 WHERE lower(btrim(last_name)) = 'unknown';

DO $$
DECLARE n BIGINT;
BEGIN
  IF (SELECT count(*) FROM public.customers WHERE lower(btrim(last_name)) = 'unknown') <> 29 THEN
    RAISE EXCEPTION 'fabricated surname: not the 29 rows read on Nov 8 - nothing applied';
  END IF;

  UPDATE public.customers
     SET last_name = ''
   WHERE lower(btrim(last_name)) = 'unknown';
  GET DIAGNOSTICS n = ROW_COUNT;
  IF n <> 29 THEN
    RAISE EXCEPTION 'fabricated surname: updated % rows, not 29 - nothing applied', n;
  END IF;
END $$;

-- After: must be 0, and the 29 now have an empty surname with their first name intact.
SELECT count(*) AS unknown_surnames_after
  FROM public.customers
 WHERE lower(btrim(last_name)) = 'unknown';

SELECT id, user_id, first_name, last_name
  FROM public.customers
 WHERE id = '9398bc26-1f94-4935-96d1-e01046b43b28';

COMMIT;
