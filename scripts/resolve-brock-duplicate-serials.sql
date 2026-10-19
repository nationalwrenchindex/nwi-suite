-- Two more duplicate serials, on Brock's own account. FOUND 2026-10-19, read-only.
--
-- STEP 2 OF 3. Run BEFORE migration 161 - its unique serial index refuses to build
-- while either pair is still active. Run AFTER step 1.
--
-- PREVIEW AND PRODUCTION SHARE ONE DATABASE.
--
-- These are NOT like Kurt's pair, and neither is merged blindly here.
-- DECIDED BY BROCK 2026-10-19: Pair A -> A1 (rename the test unit's serial; it keeps
-- its work orders). Pair B -> B2 (53126 is a double entry of 53116; retire it).
-- A1 and B2 are the live statements below; A2 and B1 stay commented. Read the checks,
-- then change ROLLBACK to COMMIT. Nothing is deleted.
--
-- PAIR A - serial 6001241923
--   3e6dd3bd-4680-4947-bc63-29d93eaa8ae1  unit 53177   TK C-600M  LTL Pros INC
--       created 2026-08-24; 1 work order, 1 invoice. A real customer unit.
--   bc654152-4ce6-4f09-abfd-c2d785218235  unit test001 TK s-600   brock fleeman test
--       created 2026-10-14; 2 work orders, 2 quotes, 1 invoice (Q-2026-0010 ->
--       WO-2026-1563 -> INV-2026-0020). A TEST unit that reused 53177's serial.
--   Different fleets: merging would put test jobs on a customer's unit. Do not merge.
--
-- PAIR B - serial 6001391390
--   d608a410-4564-4bb7-9e58-fb37e9c4dbd5  unit 53116  TK S-610M 2022  LTL Pros INC
--       created 2026-09-12 22:55; BM 902927; 1 work order.
--   325cb0df-5f1e-4d10-9705-63bead0e5f8a  unit 53126  TK S-610M 2022  LTL Pros INC
--       created 2026-09-12 22:59, four minutes later; BM 902927M; no references.
--   Same model, year, hours (10192) and last PM date, different unit number. Either
--   53126 was entered as a copy of 53116 and is really the same unit (merge), or it is
--   a second real unit whose serial was copied by mistake (correct its serial).

BEGIN;

-- Before: all four rows.
SELECT id, unit_number, model, serial_number, bm_number, status, active,
       (SELECT count(*) FROM hd_work_orders w WHERE w.unit_id = u.id) AS work_orders,
       (SELECT count(*) FROM hd_invoices   i WHERE i.unit_id = u.id) AS invoices
  FROM hd_units u
 WHERE id IN ('3e6dd3bd-4680-4947-bc63-29d93eaa8ae1', 'bc654152-4ce6-4f09-abfd-c2d785218235',
              'd608a410-4564-4bb7-9e58-fb37e9c4dbd5', '325cb0df-5f1e-4d10-9705-63bead0e5f8a')
 ORDER BY serial_number, created_at;

-- ===== PAIR A: pick ONE =====================================================

-- A1 (RECOMMENDED). Give the test unit a serial that is plainly a test value. It stays
-- usable for testing and keeps its quotes, work orders and invoice.
UPDATE hd_units
   SET serial_number = 'TEST-6001241923', updated_at = now(),
       notes = btrim(coalesce(notes, '') || ' Serial changed 2026-10-19 from 6001241923, which belongs to unit 53177; this is a test unit.')
 WHERE id = 'bc654152-4ce6-4f09-abfd-c2d785218235' AND serial_number = '6001241923';

-- A2. Retire the test unit instead (inactive; the index skips inactive units).
-- UPDATE hd_units
--    SET active = false, status = 'inactive', updated_at = now(),
--        notes = btrim(coalesce(notes, '') || ' Retired 2026-10-19: test unit that reused serial 6001241923 of unit 53177.')
--  WHERE id = 'bc654152-4ce6-4f09-abfd-c2d785218235';

-- ===== PAIR B: pick ONE =====================================================

-- B1. 53126 is a SECOND REAL UNIT with a mistyped serial. Put the serial off its data
-- plate in place of REPLACE_WITH_REAL_SERIAL. Leaving the placeholder is refused below.
-- UPDATE hd_units
--    SET serial_number = 'REPLACE_WITH_REAL_SERIAL', updated_at = now()
--  WHERE id = '325cb0df-5f1e-4d10-9705-63bead0e5f8a' AND serial_number = '6001391390';

-- B2. 53126 is the SAME unit as 53116, entered twice. Retire it; it has no references,
-- so there is nothing to repoint.
UPDATE hd_units
   SET active = false, status = 'inactive', updated_at = now(),
       notes = btrim(coalesce(notes, '') || ' Merged into unit d608a410-4564-4bb7-9e58-fb37e9c4dbd5 (53116) on 2026-10-19: duplicate entry of serial 6001391390.')
 WHERE id = '325cb0df-5f1e-4d10-9705-63bead0e5f8a';

-- ============================================================================

-- Refuse the B1 placeholder if it was uncommented without being edited.
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM hd_units WHERE serial_number = 'REPLACE_WITH_REAL_SERIAL') THEN
    RAISE EXCEPTION 'B1 still has the placeholder serial - put the real one in';
  END IF;
END;
$$;

-- After: expect NO rows. Any row here is a serial still active on two units, and
-- migration 161 will refuse until it is gone. Checks every account, not just these.
SELECT user_id, upper(btrim(serial_number)) AS serial, count(*) AS active_units
  FROM hd_units
 WHERE serial_number IS NOT NULL AND active IS NOT FALSE
 GROUP BY 1, 2
HAVING count(*) > 1;

ROLLBACK;
