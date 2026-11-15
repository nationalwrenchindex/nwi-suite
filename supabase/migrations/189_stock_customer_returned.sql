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
-- The app refuses a customer return until this is applied (it never writes an
-- ambiguous 'returned' row in its place).
--
-- The constraint is found by its definition, not trusted by name: migration 151 made it
-- inline, so Postgres named it stock_movement_reason_check, but a hand-run change could
-- have renamed it. The block refuses to run if it does not find exactly one.
--
-- Plain ASCII. Ends in ROLLBACK so a dry run changes nothing.

BEGIN;

-- Before: every movement and every reason it uses, to compare after.
CREATE TEMP TABLE _mv_before ON COMMIT DROP AS
  SELECT reason, count(*) AS n FROM public.stock_movement GROUP BY reason;

DO $$
DECLARE
  found_name TEXT;
  found_count INTEGER;
BEGIN
  SELECT count(*), min(conname)
    INTO found_count, found_name
  FROM pg_constraint
  WHERE conrelid = 'public.stock_movement'::regclass
    AND contype = 'c'
    AND pg_get_constraintdef(oid) LIKE '%reason%'
    AND pg_get_constraintdef(oid) LIKE '%opening%';

  IF found_count <> 1 THEN
    RAISE EXCEPTION '189: expected exactly one reason CHECK on stock_movement, found %', found_count;
  END IF;

  RAISE NOTICE '189: replacing %', found_name;
  EXECUTE format('ALTER TABLE public.stock_movement DROP CONSTRAINT %I', found_name);
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
  def TEXT;
  n INTEGER;
  changed INTEGER;
BEGIN
  SELECT count(*), min(pg_get_constraintdef(oid)) INTO n, def
  FROM pg_constraint
  WHERE conrelid = 'public.stock_movement'::regclass
    AND contype = 'c'
    AND pg_get_constraintdef(oid) LIKE '%reason%'
    AND pg_get_constraintdef(oid) LIKE '%opening%';
  IF n <> 1 THEN RAISE EXCEPTION '189 self-check: % reason CHECKs, expected 1', n; END IF;
  IF def NOT LIKE '%customer_returned%' THEN RAISE EXCEPTION '189 self-check: customer_returned missing: %', def; END IF;
  IF def NOT LIKE '%''received''%' OR def NOT LIKE '%''used''%' OR def NOT LIKE '%''adjusted''%'
     OR def NOT LIKE '%''transferred_in''%' OR def NOT LIKE '%''transferred_out''%'
     OR def NOT LIKE '%''returned''%' OR def NOT LIKE '%''opening''%' THEN
    RAISE EXCEPTION '189 self-check: an old reason was lost: %', def;
  END IF;

  -- Every existing row still passes and nothing moved.
  SELECT count(*) INTO changed FROM (
    SELECT reason, count(*) AS n FROM public.stock_movement GROUP BY reason
    EXCEPT SELECT reason, n FROM _mv_before
  ) d;
  IF changed <> 0 THEN RAISE EXCEPTION '189 self-check: ledger rows changed'; END IF;

  RAISE NOTICE '189 ok: %', def;
END $$;

-- Ends in ROLLBACK so a dry run changes nothing. Change to COMMIT to apply.
ROLLBACK;
