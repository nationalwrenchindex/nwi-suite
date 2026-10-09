-- =============================================================================
-- 149  parts.vendor_price - because the catalog has to cost something
-- =============================================================================
--
-- ADDITIVE ONLY. Two nullable columns on public.parts. No data is touched.
--
-- -- WHY THIS IS A SECOND MIGRATION AND NOT PART OF 148 ----------------------
--
-- 148 built the five tables to the spec it was given, and that spec listed no price
-- on parts. Then the data arrived: parts.csv carries vendor_price_usd on all 105
-- rows, and "the chosen part lands on the work order with the right number and the
-- right price, markup applied per the shop's settings" cannot happen without a cost
-- to mark up.
--
-- inventory.last_cost is the wrong home for it. That table is per shop, and a
-- vendor list price is a property of the PART - the same number for every
-- subscriber. Writing it into inventory would mean inventing a stock row for all 30
-- shops for a part none of them has on the shelf, and then maintaining 30 copies of
-- one fact.
--
-- So the list price lives on the part, and inventory.last_cost stays what it says:
-- what THIS shop last actually paid. When a shop has paid for one, their number
-- wins. When they have not, the list price is what the markup applies to.

BEGIN;

ALTER TABLE public.parts
  ADD COLUMN IF NOT EXISTS vendor_price        NUMERIC(10, 2),
  ADD COLUMN IF NOT EXISTS vendor_price_source TEXT;

ALTER TABLE public.parts
  DROP CONSTRAINT IF EXISTS parts_vendor_price_not_negative;

ALTER TABLE public.parts
  ADD CONSTRAINT parts_vendor_price_not_negative
  CHECK (vendor_price IS NULL OR vendor_price >= 0);

COMMENT ON COLUMN public.parts.vendor_price IS
  'Vendor list price, the same for every subscriber. NULL means we do not have one - which must read as "no price known", never as free. A shop that has actually bought one has inventory.last_cost, and that wins.';

COMMENT ON COLUMN public.parts.vendor_price_source IS
  'Which listing the price came from, and therefore how stale it may be. A price with no provenance cannot be quoted to a customer with a straight face.';

-- -----------------------------------------------------------------------------
-- Check it
-- -----------------------------------------------------------------------------
-- Expect two rows: vendor_price numeric, vendor_price_source text, both nullable.
SELECT column_name, data_type, is_nullable
FROM   information_schema.columns
WHERE  table_schema = 'public'
  AND  table_name   = 'parts'
  AND  column_name IN ('vendor_price', 'vendor_price_source')
ORDER  BY column_name;

-- Expect one row: the CHECK constraint.
SELECT conname, pg_get_constraintdef(oid) AS definition
FROM   pg_constraint
WHERE  conrelid = 'public.parts'::regclass
  AND  conname  = 'parts_vendor_price_not_negative';

COMMIT;
