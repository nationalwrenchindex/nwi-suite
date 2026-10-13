-- =============================================================================
-- 154  One invoice per HD work order, enforced by the database
-- =============================================================================
--
-- ONE PARTIAL UNIQUE INDEX. No table, column, policy or row is touched.
--
-- -- READ THIS FIRST: IT WILL FAIL UNTIL ONE EXISTING ROW IS RESOLVED --------
--
-- hd_invoices ALREADY CONTAINS A DOUBLE-BILLED WORK ORDER. Found while building the
-- converter, by checking for duplicates before writing an index that assumes there are
-- none:
--
--   work order WO-2026-1538  (Trailer Source)
--     INV-2026-0003   total 183.18    1 line   sent 2026-09-11   unpaid
--     INV-2026-0005   total 1286.60   9 lines  sent 2026-09-14   unpaid
--
-- Two SENT invoices for one job, three days apart, wildly different totals, neither
-- paid. The customer may hold both.
--
-- CREATE UNIQUE INDEX will fail with 23505 while both rows exist, and because this runs
-- inside a transaction the failure is clean - nothing is half-applied. But it means:
--
--     RESOLVE THAT PAIR FIRST. scripts/resolve-double-billed-wo-1538.sql shows both
--     invoices in full and voids whichever ONE you choose. It does not choose for you.
--     Billing records are not mine to delete.
--
-- Running this migration before that is safe; it will simply refuse and tell you.
--
-- -- WHY AN INDEX AND NOT A CHECK IN THE ROUTE -------------------------------
--
-- Because the route check is what failed. The recon found every double-convert guard
-- in this codebase is an application-level read-then-write with a race window, and the
-- pair above is what that looks like in production: a tech double-clicking, or
-- invoicing from two tabs, three days apart.
--
-- Modelled on stock_movement_one_use_per_source (151) and
-- hd_work_orders_one_per_quote (153). Same shape, same reasoning: the second attempt
-- fails at the database even if the application logic is wrong.

BEGIN;

-- -----------------------------------------------------------------------------
-- STEP 1. Any work order billed more than once. EXPECT ZERO ROWS.
-- -----------------------------------------------------------------------------
-- If this returns anything, the CREATE below will fail. Resolve it first.
SELECT work_order_id,
       count(*)                        AS invoice_count,
       string_agg(invoice_number, ', ' ORDER BY created_at) AS invoices,
       string_agg(status, ', ' ORDER BY created_at)         AS statuses,
       string_agg(total::text, ', ' ORDER BY created_at)    AS totals
FROM   public.hd_invoices
WHERE  work_order_id IS NOT NULL
GROUP  BY work_order_id
HAVING count(*) > 1;

-- -----------------------------------------------------------------------------
-- STEP 2. The guard
-- -----------------------------------------------------------------------------
-- Partial: the 4 invoices with no work_order_id are standalone bills and must not
-- collide with each other.
CREATE UNIQUE INDEX IF NOT EXISTS hd_invoices_one_per_work_order
  ON public.hd_invoices (work_order_id) WHERE work_order_id IS NOT NULL;

COMMENT ON INDEX public.hd_invoices_one_per_work_order IS
  'One invoice per HD work order. Enforced here rather than in a route handler because the route handler is what failed: WO-2026-1538 was billed twice, three days apart, before this existed. A second attempt now fails with 23505 and the converter returns the invoice that already exists.';

-- -----------------------------------------------------------------------------
-- STEP 3. Check it
-- -----------------------------------------------------------------------------
-- Expect one row.
SELECT indexname, indexdef
FROM   pg_indexes
WHERE  schemaname = 'public' AND indexname = 'hd_invoices_one_per_work_order';

-- Expect zero rows. This is the same query as STEP 1 and it must now be empty by
-- construction - the index would not exist otherwise.
SELECT work_order_id, count(*) AS invoice_count
FROM   public.hd_invoices
WHERE  work_order_id IS NOT NULL
GROUP  BY work_order_id
HAVING count(*) > 1;

-- Expect 19 total, 15 linked to a work order, 4 standalone - unchanged by this
-- migration, which adds no rows.
SELECT count(*)                                            AS total_invoices,
       count(*) FILTER (WHERE work_order_id IS NOT NULL)    AS linked_to_work_order,
       count(*) FILTER (WHERE work_order_id IS NULL)        AS standalone
FROM   public.hd_invoices;

COMMIT;
