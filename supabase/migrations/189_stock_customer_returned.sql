-- 189_stock_customer_returned.sql
--
-- WHAT IS WRONG. A part billed on an invoice can come back to the shelf two ways, and
-- the ledger writes the same reason for both:
--   - a REFRESH from the work order that now bills fewer (reason 'returned', written by
--     the stock-by-difference logic shipped in a16d5298), and
--   - the CUSTOMER refusing a repair after the invoice went out, the job dismissed or
--     never finished, and the parts physically coming back.
-- They are different events. A refresh is a correction of what was billed; a customer
-- return leaves the bill exactly as it was. The refresh route has to refuse an invoice
-- carrying a customer return (or it would take those parts off the shelf again), and
-- it cannot do that reliably by reading free text in a note.
--
-- WHAT THIS DOES. ONE CHANGE: stock_movement.reason may also be 'customer_returned'.
-- The CHECK is dropped and re-added with every value it had plus the new one.
--   - No row is written, updated or deleted. The ledger is append only and stays so.
--   - No column, index, trigger, policy or view is touched. The on_hand trigger
--     (apply_stock_movement) applies a movement of any reason, so a customer return
--     moves on_hand like any other positive movement.
--   - The one-'used'-per-document index is untouched: it covers reason = 'used' only.
--
-- APPLIED by hand Nov 15, 2026 (dry run in ROLLBACK, then COMMIT; "189 ok" both times).
--
-- The app refused a customer return until this was applied (it never writes an
-- ambiguous 'returned' row in its place).
--
-- The constraint is found by its definition, not trusted by name: migration 151 made it
-- inline, so Postgres named it stock_movement_reason_check, but a hand-run change could
-- have renamed it. The block refuses to run if it does not find exactly one.
--
-- Plain ASCII. Ends in ROLLBACK so a dry run changes nothing.

BEGIN;

-- Before: every reason the ledger uses and how many rows each has, to compare after.
-- NAMING RULE for the two blocks below: every PL/pgSQL variable starts with v_, and
-- every column is qualified by its table alias, so no variable can shadow a column
-- (the first dry run failed with 42702: a variable n collided with _mv_before.n).
CREATE TEMP TABLE _mv_before ON COMMIT DROP AS
  SELECT m.reason AS reason, count(*) AS mv_rows
  FROM public.stock_movement m
  GROUP BY m.reason;

DO $$
DECLARE
  v_found_name  TEXT;
  v_found_count INTEGER;
BEGIN
  SELECT count(*), min(c.conname)
    INTO v_found_count, v_found_name
  FROM pg_constraint c
  WHERE c.conrelid = 'public.stock_movement'::regclass
    AND c.contype = 'c'
    AND pg_get_constraintdef(c.oid) LIKE '%reason%'
    AND pg_get_constraintdef(c.oid) LIKE '%opening%';

  IF v_found_count <> 1 THEN
    RAISE EXCEPTION '189: expected exactly one reason CHECK on stock_movement, found %', v_found_count;
  END IF;

  RAISE NOTICE '189: replacing %', v_found_name;
  EXECUTE format('ALTER TABLE public.stock_movement DROP CONSTRAINT %I', v_found_name);
END $$;

ALTER TABLE public.stock_movement
  ADD CONSTRAINT stock_movement_reason_check CHECK (reason IN (
    'received',           -- bought from a vendor
    'used',               -- billed on an invoice
    'adjusted',           -- a physical count differed, or a refresh billed more
    'transferred_in',     -- arrived from another location
    'transferred_out',    -- left for another location
    'returned',           -- back on the shelf by a refresh or a deleted draft
    'opening',            -- the first count when stock is set up
    'customer_returned'   -- the customer refused the repair and the parts came back
  ));

COMMENT ON CONSTRAINT stock_movement_reason_check ON public.stock_movement IS
  'Migration 189 added customer_returned: parts back on the shelf from a sent, paid, partial, void or overdue invoice whose money is frozen. Distinct from returned (a refresh or a deleted draft) so the refresh route can refuse an invoice carrying one.';

-- Self-check.
DO $$
DECLARE
  v_def    TEXT;
  v_checks INTEGER;
  v_diff   INTEGER;
BEGIN
  SELECT count(*), min(pg_get_constraintdef(c.oid))
    INTO v_checks, v_def
  FROM pg_constraint c
  WHERE c.conrelid = 'public.stock_movement'::regclass
    AND c.contype = 'c'
    AND pg_get_constraintdef(c.oid) LIKE '%reason%'
    AND pg_get_constraintdef(c.oid) LIKE '%opening%';
  IF v_checks <> 1 THEN RAISE EXCEPTION '189 self-check: % reason CHECKs, expected 1', v_checks; END IF;
  IF v_def NOT LIKE '%''customer_returned''%' THEN RAISE EXCEPTION '189 self-check: customer_returned missing: %', v_def; END IF;
  IF v_def NOT LIKE '%''received''%' OR v_def NOT LIKE '%''used''%' OR v_def NOT LIKE '%''adjusted''%'
     OR v_def NOT LIKE '%''transferred_in''%' OR v_def NOT LIKE '%''transferred_out''%'
     OR v_def NOT LIKE '%''returned''%' OR v_def NOT LIKE '%''opening''%' THEN
    RAISE EXCEPTION '189 self-check: an old reason was lost: %', v_def;
  END IF;

  -- Nothing in the ledger moved: the reason counts after are exactly the counts
  -- before, compared BOTH ways, so a reason gained, lost or recounted all fail.
  SELECT count(*) INTO v_diff FROM (
    ( SELECT a.reason, count(*) AS mv_rows
      FROM public.stock_movement a GROUP BY a.reason
      EXCEPT
      SELECT b.reason, b.mv_rows FROM _mv_before b )
    UNION ALL
    ( SELECT b.reason, b.mv_rows FROM _mv_before b
      EXCEPT
      SELECT a.reason, count(*) AS mv_rows
      FROM public.stock_movement a GROUP BY a.reason )
  ) d;
  IF v_diff <> 0 THEN RAISE EXCEPTION '189 self-check: ledger rows changed (% reason counts differ)', v_diff; END IF;

  RAISE NOTICE '189 ok: %', v_def;
END $$;

-- Ends in COMMIT as run Nov 15, 2026. Change to ROLLBACK for a dry run.
COMMIT;
