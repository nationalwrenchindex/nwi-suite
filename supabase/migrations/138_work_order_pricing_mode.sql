-- How a work order is priced, decided explicitly and up front.
--
-- 137 built segments and the guard that keeps a work order from being parent-priced
-- and segment-priced at once. What it did not build was a door: the New Work Order
-- form requires a line item or labour time, so every record was created with parent
-- money on it, which made every record parent-priced, which made the guard refuse
-- every attempt to add a segment. The feature was reachable only by inserting a row
-- by hand.
--
-- The fix is to stop inferring the mode from whether money happens to be present and
-- to record the tech's choice instead.
--
--   'single'    Parts & Labor on the work order itself. What every work order did
--               before segments existed, unchanged.
--   'segments'  No parent money at all — NULL, not zero, because zero is a priced
--               job that costs nothing and null is a job priced somewhere else. Each
--               complaint becomes a segment with its own lines, tax and approval.
--   NULL        Created before this migration. Inferred exactly as 137 did: parent
--               line items mean parent-priced. Nothing about these records changes,
--               and no backfill runs against them — many are already invoiced.
ALTER TABLE public.work_orders
  ADD COLUMN IF NOT EXISTS pricing_mode TEXT
    CHECK (pricing_mode IS NULL OR pricing_mode IN ('single', 'segments'));

-- HD's column ships here unused, same as its segment FK in 137, so the HD phase adds
-- no migration of substance.
ALTER TABLE public.hd_work_orders
  ADD COLUMN IF NOT EXISTS pricing_mode TEXT
    CHECK (pricing_mode IS NULL OR pricing_mode IN ('single', 'segments'));

-- The work order list wants "which of these are segmented" without reading every
-- record's line items.
CREATE INDEX IF NOT EXISTS idx_work_orders_pricing_mode
  ON public.work_orders (user_id, pricing_mode);

-- NOTE ON SWITCHING MODES: allowed only while the record has money on NEITHER side —
-- no parent line items and no segments. Enforced in the API (PATCH
-- /api/work-orders/[id]), because the check has to look at another table and a refusal
-- needs to explain itself. Once either side holds money the 137 guard takes over and
-- the mode is fixed; moving a priced work order across is the separate, deliberate
-- "convert to segments" action.
