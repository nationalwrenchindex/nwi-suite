-- Repair the one labor library row saved with 0 billable hours.
--
-- "test labor" (id f086b183-c370-4681-a7ed-16109e9a0349) has shop_hours 1.5 and
-- mobile_hours 0, so every pick pre-filled 0 hrs x $135.00 = $0.00. It is the only row
-- of 28 with that shape (counted read-only on 2026-10-17). Sets the billed hours to its
-- own book figure, 1.5.
--
-- Ends in ROLLBACK. Read the checks, then change ROLLBACK to COMMIT to keep it.

BEGIN;

-- Before: expect one row, mobile_hours 0, shop_hours 1.5.
SELECT id, description, mobile_hours, shop_hours
  FROM hd_repair_items
 WHERE id = 'f086b183-c370-4681-a7ed-16109e9a0349';

UPDATE hd_repair_items SET mobile_hours = 1.5, updated_at = NOW() WHERE id = 'f086b183-c370-4681-a7ed-16109e9a0349' AND mobile_hours = 0;

-- After: expect one row, mobile_hours 1.5.
SELECT id, description, mobile_hours, shop_hours
  FROM hd_repair_items
 WHERE id = 'f086b183-c370-4681-a7ed-16109e9a0349';

-- Expect 0: no other row bills 0 or no hours while having book hours.
SELECT count(*) AS still_zero
  FROM hd_repair_items
 WHERE (mobile_hours IS NULL OR mobile_hours = 0) AND shop_hours > 0;

ROLLBACK;
