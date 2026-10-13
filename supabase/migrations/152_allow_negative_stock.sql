-- =============================================================================
-- 152  Allow negative stock
-- =============================================================================
--
-- ONE STATEMENT. Drops a CHECK constraint. No table, column, index, policy or row is
-- touched.
--
-- -- WHY THIS IS NEEDED, AND WHOSE FAULT IT IS -------------------------------
--
-- Migration 148 declared:
--
--     on_hand INTEGER NOT NULL DEFAULT 0 CHECK (on_hand >= 0)
--
-- That was wrong, and it was mine. The rule is the opposite:
--
--     "Negative stock is allowed but flagged. A tech grabs a part off the truck he
--      never recorded; refusing the job is worse than an inaccurate count. Show it as
--      negative and surface it for correction."
--
-- With the constraint in place every REDUCTION fails. Verified against the live
-- database before writing this: receiving 6 worked, and then deducting, counting down
-- and transferring out all wrote ZERO movements, each one failing with
--
--     23514  new row for relation "inventory" violates check constraint
--            "inventory_on_hand_check"
--
-- The movement insert and the trigger that applies it are in one statement, so the
-- CHECK failing rolled the whole thing back and the ledger stayed empty. Eight of the
-- rules in the brief were unimplementable until this comes off, and migration 151 did
-- not notice it.
--
-- -- WHAT REPLACES IT --------------------------------------------------------
--
-- Nothing, by design. A negative on_hand is REAL information - it means parts left the
-- shelf without being recorded, which is the exact situation the shop needs to see.
-- inventory_position already exposes it:
--
--     CASE WHEN i.on_hand < 0 THEN TRUE ELSE FALSE END AS negative
--
-- so the counter and the low-stock screen can surface it for correction. Flagged, not
-- forbidden.
--
-- min_qty keeps its own CHECK (min_qty IS NULL OR min_qty >= 0), and last_cost and
-- sell_price keep theirs. A negative MINIMUM or a negative PRICE really is nonsense;
-- a negative COUNT is a fact about the world.

BEGIN;

ALTER TABLE public.inventory
  DROP CONSTRAINT IF EXISTS inventory_on_hand_check;

COMMENT ON COLUMN public.inventory.on_hand IS
  'Units on the shelf at this location. MAY BE NEGATIVE: a part taken without being recorded shows as negative so it can be found and corrected, rather than the deduction being refused and the job blocked. inventory_position.negative flags it. Only apply_stock_movement may change this value - see migration 151.';

-- -----------------------------------------------------------------------------
-- Check it
-- -----------------------------------------------------------------------------
-- Expect ZERO rows. Any row here means on_hand is still constrained and every
-- deduction will keep failing with 23514.
SELECT conname, pg_get_constraintdef(oid) AS definition
FROM   pg_constraint
WHERE  conrelid = 'public.inventory'::regclass
  AND  pg_get_constraintdef(oid) ILIKE '%on_hand%';

-- Expect the OTHER checks to survive: min_qty, last_cost, sell_price and the
-- vehicle-is-named rule from 148.
SELECT conname, pg_get_constraintdef(oid) AS definition
FROM   pg_constraint
WHERE  conrelid = 'public.inventory'::regclass
  AND  contype = 'c'
ORDER  BY conname;

-- Expect 0 - this migration changes no data.
SELECT count(*) AS inventory_rows FROM public.inventory;

COMMIT;
