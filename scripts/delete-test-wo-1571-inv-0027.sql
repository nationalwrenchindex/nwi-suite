-- =============================================================================
-- Delete test data: INV-2026-0027 and WO-2026-1571 (Brock's account). Run as ONE file.
-- =============================================================================
--
-- Both are test rows at the wrong figures: INV-2026-0027 bills $366.13 where the job
-- should have come to $647.36 (the drive time and mileage typed on the work order were
-- never saved - the bug fixed in d3a46b7e).
--
-- RUN ORDER, inside this one transaction: the INVOICE first, then the WORK ORDER.
--   hd_invoices.work_order_id points at the work order (ON DELETE SET NULL), so deleting
--   the work order first would leave the invoice behind with its link silently blanked.
--
-- What a read on Nov 6, 2026 found hanging off them:
--   WO-2026-1571 06060e1e-2d3f-45f6-ac04-4254d0c04649   status completed
--     hd_work_order_line_items 4  (CASCADE - deleted with it; all four say "test")
--     hd_work_order_jobs       2  (CASCADE - deleted with it)
--     photos, segments, DOT / aerial / equipment inspections, PM checklists: 0
--   INV-2026-0027 7bf7b9ca-f139-4d83-a0d9-33e61e29642e  status unpaid, never sent, never paid
--     stock_movement 0, stock_allocation 0 - no inventory was deducted, nothing to put back
--
-- The checks refuse the whole file if either row is not exactly what was read: same id,
-- number, account, total, unpaid, never sent.
--
-- ENDS IN ROLLBACK. Read what it prints, then change the last line to COMMIT.

BEGIN;

DO $$
DECLARE n BIGINT;
BEGIN
  IF (SELECT count(*) FROM public.hd_invoices
       WHERE id = '7bf7b9ca-f139-4d83-a0d9-33e61e29642e'
         AND invoice_number = 'INV-2026-0027'
         AND user_id = '4a8c046f-7db3-42bb-8422-fd47efb7678c'
         AND work_order_id = '06060e1e-2d3f-45f6-ac04-4254d0c04649'
         AND total = 366.13
         AND paid_at IS NULL AND sent_at IS NULL) <> 1 THEN
    RAISE EXCEPTION 'INV-2026-0027 is not the unpaid, unsent $366.13 test invoice read on Nov 6 - nothing deleted';
  END IF;
  IF (SELECT count(*) FROM public.hd_work_orders
       WHERE id = '06060e1e-2d3f-45f6-ac04-4254d0c04649'
         AND work_order_number = 'WO-2026-1571'
         AND user_id = '4a8c046f-7db3-42bb-8422-fd47efb7678c') <> 1 THEN
    RAISE EXCEPTION 'WO-2026-1571 is not the test work order read on Nov 6 - nothing deleted';
  END IF;
  IF (SELECT count(*) FROM public.hd_invoices WHERE work_order_id = '06060e1e-2d3f-45f6-ac04-4254d0c04649') <> 1 THEN
    RAISE EXCEPTION 'WO-2026-1571 has a second invoice now - nothing deleted';
  END IF;
  IF EXISTS (SELECT 1 FROM public.stock_movement WHERE source_id IN ('7bf7b9ca-f139-4d83-a0d9-33e61e29642e', '06060e1e-2d3f-45f6-ac04-4254d0c04649')) THEN
    RAISE EXCEPTION 'a stock movement now points at these rows - put the stock back first; nothing deleted';
  END IF;

  -- 1. The invoice.
  DELETE FROM public.hd_invoices WHERE id = '7bf7b9ca-f139-4d83-a0d9-33e61e29642e';
  GET DIAGNOSTICS n = ROW_COUNT;
  IF n <> 1 THEN RAISE EXCEPTION 'deleted % invoices, not 1 - nothing deleted', n; END IF;

  -- 2. The work order (its 4 line items and 2 jobs cascade).
  DELETE FROM public.hd_work_orders WHERE id = '06060e1e-2d3f-45f6-ac04-4254d0c04649';
  GET DIAGNOSTICS n = ROW_COUNT;
  IF n <> 1 THEN RAISE EXCEPTION 'deleted % work orders, not 1 - nothing deleted', n; END IF;
END $$;

-- After: every count must be 0.
SELECT 'hd_invoices' AS tbl, count(*) AS left_behind FROM public.hd_invoices WHERE id = '7bf7b9ca-f139-4d83-a0d9-33e61e29642e'
UNION ALL SELECT 'hd_work_orders', count(*) FROM public.hd_work_orders WHERE id = '06060e1e-2d3f-45f6-ac04-4254d0c04649'
UNION ALL SELECT 'hd_work_order_line_items', count(*) FROM public.hd_work_order_line_items WHERE work_order_id = '06060e1e-2d3f-45f6-ac04-4254d0c04649'
UNION ALL SELECT 'hd_work_order_jobs', count(*) FROM public.hd_work_order_jobs WHERE work_order_id = '06060e1e-2d3f-45f6-ac04-4254d0c04649';

COMMIT;
