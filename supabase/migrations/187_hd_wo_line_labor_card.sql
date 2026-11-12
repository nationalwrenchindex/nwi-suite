-- 187_hd_wo_line_labor_card.sql
--
-- WHAT IS WRONG. A work order labor line records its hours, but not which labor card
-- it was. The labor guide is meant to learn "this job took N hours" from completed
-- work, and with no link from a line to its card there is nothing to learn from: a
-- line named "R&R alternator" could be the card, or a different job with the same
-- words.
--
-- WHAT THIS DOES. Adds hd_work_order_line_items.repair_item_id: the hd_repair_items
-- card the line came from (the shop's own card or an NWI catalog card), or NULL.
--   - Set by the app only: picked in the ADD LABOR LINE modal on the work order, or
--     carried from a quote line picked the same way when the quote is approved.
--   - Held only while the line keeps the card's name. A renamed line is a different
--     job, and the app clears the link.
--   - ON DELETE SET NULL: deleting or retiring a card never deletes or blocks a line.
--   - Nothing is backfilled. Existing lines stay NULL: guessing a card from a
--     description is exactly the mistake this column exists to avoid.
--
-- No money column is touched; the self-check compares every line total.
--
-- Until this is applied the code saves lines exactly as before and simply does not
-- record the card.
--
-- Plain ASCII. Ends in ROLLBACK: run it once to see the checks pass, then change the
-- last line to COMMIT and run it again to apply. Any failed check raises.

BEGIN;

CREATE TEMP TABLE _lines_before ON COMMIT DROP AS
  SELECT id, total, quantity, unit_price FROM public.hd_work_order_line_items;

ALTER TABLE public.hd_work_order_line_items
  ADD COLUMN IF NOT EXISTS repair_item_id UUID
  REFERENCES public.hd_repair_items(id) ON DELETE SET NULL;

-- For the learning read: every completed line of one card.
CREATE INDEX IF NOT EXISTS idx_hd_wo_line_items_repair_item
  ON public.hd_work_order_line_items (repair_item_id)
  WHERE repair_item_id IS NOT NULL;

-- Self-check.
DO $$
DECLARE
  changed integer;
  filled  integer;
  lost    integer;
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'hd_work_order_line_items' AND column_name = 'repair_item_id'
  ) THEN
    RAISE EXCEPTION '187: hd_work_order_line_items.repair_item_id was not created';
  END IF;

  -- The foreign key is ON DELETE SET NULL, never CASCADE or RESTRICT.
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint c
    WHERE c.conrelid = 'public.hd_work_order_line_items'::regclass
      AND c.contype = 'f'
      AND c.confrelid = 'public.hd_repair_items'::regclass
      AND c.confdeltype = 'n'
  ) THEN
    RAISE EXCEPTION '187: the repair_item_id foreign key is not ON DELETE SET NULL';
  END IF;

  SELECT count(*) INTO filled FROM public.hd_work_order_line_items WHERE repair_item_id IS NOT NULL;
  IF filled <> 0 THEN
    RAISE EXCEPTION '187: expected no line linked to a card yet, found %', filled;
  END IF;

  SELECT count(*) INTO lost FROM _lines_before b
  WHERE NOT EXISTS (SELECT 1 FROM public.hd_work_order_line_items l WHERE l.id = b.id);
  SELECT count(*) INTO changed FROM _lines_before b
  JOIN public.hd_work_order_line_items l ON l.id = b.id
  WHERE l.total IS DISTINCT FROM b.total
     OR l.quantity IS DISTINCT FROM b.quantity
     OR l.unit_price IS DISTINCT FROM b.unit_price;
  IF lost <> 0 OR changed <> 0 THEN
    RAISE EXCEPTION '187: % line(s) lost and % changed - nothing should move', lost, changed;
  END IF;

  RAISE NOTICE '187 ok: repair_item_id added (ON DELETE SET NULL), 0 linked, % line(s) unchanged',
    (SELECT count(*) FROM _lines_before);
END $$;

-- Ends in ROLLBACK so a dry run changes nothing. Change to COMMIT to apply.
ROLLBACK;
