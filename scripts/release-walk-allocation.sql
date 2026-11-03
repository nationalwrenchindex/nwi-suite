-- release-walk-allocation.sql
--
-- Releases ONE stock allocation left live by the billable-extras walk on Nov 3, 2026
-- (scripts/walk-hd-extras.ts). The walk saved a fuel filter, 11-9098 x 2, on a test
-- work order; the line save reserved 2 from your stock, and deleting the test work
-- order in the walk's finally did not release the reservation (stock_allocation has no
-- cascade to hd_work_orders). So 2 of that part read as reserved against a work order
-- that no longer exists.
--
-- This RELEASES it, the way the ledger does (released_at + a reason) - the row stays.
-- Nothing is deleted. The walk now uses part lines that touch no stock.
--
-- Checks: exactly one row, still live, its work order gone, quantity 2. Ends in
-- ROLLBACK - change the last line to COMMIT to apply. ASCII only.

BEGIN;

-- Before.
SELECT id, part_id, work_order_id, quantity, released_at, created_at,
       EXISTS (SELECT 1 FROM public.hd_work_orders w WHERE w.id = a.work_order_id) AS work_order_exists
  FROM public.stock_allocation a
 WHERE id = 'd0eab3ae-a996-44c9-baf6-4db76fa60ced';

DO $$
DECLARE n int;
BEGIN
  SELECT count(*) INTO n FROM public.stock_allocation a
   WHERE a.id = 'd0eab3ae-a996-44c9-baf6-4db76fa60ced'
     AND a.released_at IS NULL
     AND a.quantity = 2
     AND a.work_order_kind = 'hd'
     AND a.work_order_id = '5e0d678c-602d-49e4-82bc-50eff70b5f89'
     AND NOT EXISTS (SELECT 1 FROM public.hd_work_orders w WHERE w.id = a.work_order_id);
  IF n <> 1 THEN RAISE EXCEPTION 'expected exactly 1 live allocation on the deleted test work order, found % - nothing changed', n; END IF;
END $$;

UPDATE public.stock_allocation
   SET released_at = now(), released_reason = 'test_work_order_deleted', updated_at = now()
 WHERE id = 'd0eab3ae-a996-44c9-baf6-4db76fa60ced'
   AND released_at IS NULL;

DO $$
DECLARE n int;
BEGIN
  SELECT count(*) INTO n FROM public.stock_allocation
   WHERE work_order_id = '5e0d678c-602d-49e4-82bc-50eff70b5f89' AND released_at IS NULL;
  IF n <> 0 THEN RAISE EXCEPTION 'still % live allocation(s) on the test work order - nothing changed', n; END IF;
END $$;

-- After: released_at set, reason test_work_order_deleted.
SELECT id, quantity, released_at, released_reason FROM public.stock_allocation
 WHERE id = 'd0eab3ae-a996-44c9-baf6-4db76fa60ced';

ROLLBACK;
