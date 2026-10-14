-- 158: carry the fleet link, the unit link and the payment terms from quote to
-- work order to invoice.
--
-- Measured against the live database (scripts/probe-carry-columns.ts) on 2026-10-14:
--
--                     hd_quotes   hd_work_orders   hd_invoices
--   fleet_account_id  MISSING     yes              yes
--   unit_id           MISSING     yes              yes
--   unit_number       yes         yes              yes
--   payment_terms     yes         MISSING          yes
--
-- So picking a fleet account on a quote filled the fields and threw the link away
-- (the work order showed Fleet as a dash), and the work order had nowhere to hold
-- the quote's terms - the invoice took hd_invoices' column DEFAULT, 'Due on receipt'.
--
-- Additive and nullable. Every write path retries without these columns until this
-- is applied, so the code can deploy first. No backfill: a quote saved without a
-- link did not record one, and guessing it from a name is how the wrong fleet gets
-- billed. The work order converter does resolve unit_id from a serial that matches
-- exactly one of the shop's units, at conversion time.
--
-- ON DELETE SET NULL, matching hd_work_orders: deleting a fleet account or a unit
-- must not delete the paperwork that mentions it.

BEGIN;

ALTER TABLE hd_quotes
  ADD COLUMN IF NOT EXISTS fleet_account_id UUID
    REFERENCES hd_fleet_accounts(id) ON DELETE SET NULL;

ALTER TABLE hd_quotes
  ADD COLUMN IF NOT EXISTS unit_id UUID
    REFERENCES hd_units(id) ON DELETE SET NULL;

-- Free text, the same as hd_quotes.payment_terms and hd_invoices.payment_terms.
-- No DEFAULT: a work order that recorded no terms must read as absent, so the
-- invoice converter can fall back to the quote instead of to a made-up value.
ALTER TABLE hd_work_orders
  ADD COLUMN IF NOT EXISTS payment_terms TEXT;

CREATE INDEX IF NOT EXISTS hd_quotes_fleet_account_id_idx
  ON hd_quotes (fleet_account_id) WHERE fleet_account_id IS NOT NULL;

-- Checks. Each should return one row.
SELECT 'hd_quotes.fleet_account_id' AS col FROM information_schema.columns
 WHERE table_name = 'hd_quotes' AND column_name = 'fleet_account_id';
SELECT 'hd_quotes.unit_id' AS col FROM information_schema.columns
 WHERE table_name = 'hd_quotes' AND column_name = 'unit_id';
SELECT 'hd_work_orders.payment_terms' AS col FROM information_schema.columns
 WHERE table_name = 'hd_work_orders' AND column_name = 'payment_terms';

-- Re-read the API schema so PostgREST sees the new columns without a restart.
NOTIFY pgrst, 'reload schema';

COMMIT;
