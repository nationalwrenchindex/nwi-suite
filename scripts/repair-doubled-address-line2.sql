-- =============================================================================
-- Address line 2 holding a second copy of line 1. Clears line 2 on those rows only.
-- =============================================================================
--
-- INV-2026-0029 printed "123 sesame st., 123 sesame st., Winston salem, NC, 27105".
-- The template was right: the customer record (2079e57b, "brock fleeman test") holds
-- "123 sesame st." in BOTH address_line1 and address_line2, and the work orders and
-- invoices made for it copied that faithfully. A read on Nov 6, 2026 found EVERY
-- non-blank address_line2 in these tables is such a copy - 7 rows, all of them this
-- one customer's:
--
--   customers        1   2079e57b-ac4c-40fa-a5d8-5e8a13e85c2e
--   hd_work_orders   4   WO-2026-0005, WO-2026-0006, WO-2026-0007, WO-2026-1572
--   hd_invoices      2   INV-2026-0002, INV-2026-0029
--   hd_quotes        0
--
-- The code fix (lib/hd/address-print) already stops it printing, parsing or being
-- written again. This only clears the stored copies so the record itself is right.
-- address_line2 is set to NULL where it equals line 1 ignoring case, spaces and
-- punctuation. Nothing else changes. No INSERT, no DELETE.
--
-- The count check refuses the whole file if the set is not exactly 1 / 4 / 2 / 0.
--
-- ENDS IN ROLLBACK. Read the counts it prints, then change the last line to COMMIT.
-- Preview and production share one database.

BEGIN;

CREATE OR REPLACE FUNCTION pg_temp.k(t TEXT) RETURNS TEXT LANGUAGE sql IMMUTABLE
AS $$ SELECT regexp_replace(lower(coalesce(t, '')), '[^a-z0-9]', '', 'g') $$;

DO $$
BEGIN
  IF (SELECT count(*) FROM public.customers      WHERE pg_temp.k(address_line1) <> '' AND pg_temp.k(address_line1) = pg_temp.k(address_line2)) <> 1
  OR (SELECT count(*) FROM public.hd_work_orders WHERE pg_temp.k(address_line1) <> '' AND pg_temp.k(address_line1) = pg_temp.k(address_line2)) <> 4
  OR (SELECT count(*) FROM public.hd_invoices    WHERE pg_temp.k(address_line1) <> '' AND pg_temp.k(address_line1) = pg_temp.k(address_line2)) <> 2
  OR (SELECT count(*) FROM public.hd_quotes      WHERE pg_temp.k(address_line1) <> '' AND pg_temp.k(address_line1) = pg_temp.k(address_line2)) <> 0
  THEN
    RAISE EXCEPTION 'doubled line 2: the rows are not the 1 / 4 / 2 / 0 read on Nov 6 - nothing applied';
  END IF;
END $$;

UPDATE public.customers      SET address_line2 = NULL WHERE pg_temp.k(address_line1) <> '' AND pg_temp.k(address_line1) = pg_temp.k(address_line2);
UPDATE public.hd_work_orders SET address_line2 = NULL WHERE pg_temp.k(address_line1) <> '' AND pg_temp.k(address_line1) = pg_temp.k(address_line2);
UPDATE public.hd_invoices    SET address_line2 = NULL WHERE pg_temp.k(address_line1) <> '' AND pg_temp.k(address_line1) = pg_temp.k(address_line2);

-- After: every count must be 0.
SELECT 'customers' AS tbl, count(*) AS still_doubled FROM public.customers WHERE pg_temp.k(address_line1) <> '' AND pg_temp.k(address_line1) = pg_temp.k(address_line2)
UNION ALL SELECT 'hd_work_orders', count(*) FROM public.hd_work_orders WHERE pg_temp.k(address_line1) <> '' AND pg_temp.k(address_line1) = pg_temp.k(address_line2)
UNION ALL SELECT 'hd_invoices', count(*) FROM public.hd_invoices WHERE pg_temp.k(address_line1) <> '' AND pg_temp.k(address_line1) = pg_temp.k(address_line2);

ROLLBACK;
