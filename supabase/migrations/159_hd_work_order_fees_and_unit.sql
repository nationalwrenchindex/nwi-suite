-- 159: give hd_work_orders the fee and unit columns its quote and invoice already have.
--
--                     hd_quotes   hd_work_orders   hd_invoices
--   diagnostic_fee    yes         MISSING          yes
--   road_call_fee     yes         MISSING          yes
--   unit_year         yes         MISSING          yes
--   truck_make        yes         MISSING          yes
--   truck_model       yes         MISSING          yes
--   truck_year        yes         MISSING          yes
--   vin               yes         MISSING          yes
--
-- THE FEES. A quote with a $35.00 road call fee converted to a work order with
-- nowhere to put it, and the invoice was built from the work order - so the fee
-- dropped out of the total while the quote's tax, which had taxed it in the labor
-- bucket, was copied through. INV-2026-0020 taxed a fee it did not charge and came
-- out $35.00 under the quote it was approved from.
--
-- THE UNIT. The work order carried manufacturer, model and serial off the quote but
-- not the year, the truck fields or the VIN, so the screen read the year off the
-- linked hd_units row instead. WO-2026-1563 shows 2017; the quote said 2018. The
-- document's recorded value wins, same rule as the rates, the tax and the terms.
--
-- Additive and nullable, NO DEFAULT. A work order made before this has no recorded
-- fee, and NULL is what lets the invoice converter fall back to the quote instead of
-- to a made-up zero. Every write path retries without these columns until this is
-- applied, so the code can deploy first. No backfill.
--
-- Text types match hd_quotes and hd_invoices (migration 057) exactly.

BEGIN;

ALTER TABLE hd_work_orders ADD COLUMN IF NOT EXISTS diagnostic_fee NUMERIC(10,2);
ALTER TABLE hd_work_orders ADD COLUMN IF NOT EXISTS road_call_fee  NUMERIC(10,2);

ALTER TABLE hd_work_orders ADD COLUMN IF NOT EXISTS unit_year   TEXT;
ALTER TABLE hd_work_orders ADD COLUMN IF NOT EXISTS truck_make  TEXT;
ALTER TABLE hd_work_orders ADD COLUMN IF NOT EXISTS truck_model TEXT;
ALTER TABLE hd_work_orders ADD COLUMN IF NOT EXISTS truck_year  TEXT;
ALTER TABLE hd_work_orders ADD COLUMN IF NOT EXISTS vin         TEXT;

-- Check. Should return seven rows.
SELECT column_name FROM information_schema.columns
 WHERE table_name = 'hd_work_orders'
   AND column_name IN ('diagnostic_fee', 'road_call_fee', 'unit_year',
                       'truck_make', 'truck_model', 'truck_year', 'vin')
 ORDER BY column_name;

-- Re-read the API schema so PostgREST sees the new columns without a restart.
NOTIFY pgrst, 'reload schema';

COMMIT;
