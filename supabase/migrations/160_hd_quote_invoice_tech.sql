-- 160: who is doing the work, on the HD quote and the HD invoice.
--
-- The HD quote form never asked, so a work order converted from a quote arrived with
-- Tech blank. hd_work_orders has had tech_name TEXT since migration 047.
--
--                 hd_quotes   hd_work_orders   hd_invoices
--   tech_name     MISSING     yes (047)        MISSING
--
-- SAME NOTION OF A TECH AS THE WORK ORDER: free text, the same name and type. There is
-- no techs or employees table (an account is one user, profiles.hd_tech_name is the
-- default name), so there is nothing for a tech_id to reference and this does not
-- invent a second notion of a tech. A real techs table, if multi-tech shops need one,
-- is a separate design; tech_name would then stay as the snapshot on each document.
--
-- WHAT READS IT LATER. The business health score (labor spent vs labor billed) and the
-- insurance audit report (payroll by equipment class) both need tech attached to work.
-- With this, billed labor per tech is the invoice's labor lines grouped by
-- hd_invoices.tech_name. Labor SPENT per tech needs time entries that do not exist
-- yet - that is the separate design, not this migration.
--
-- Additive and nullable, no default, no backfill. Every write path retries without the
-- column until this is applied, so the code can deploy first.

BEGIN;

ALTER TABLE hd_quotes   ADD COLUMN IF NOT EXISTS tech_name TEXT;
ALTER TABLE hd_invoices ADD COLUMN IF NOT EXISTS tech_name TEXT;

-- For the per-tech rollups above.
CREATE INDEX IF NOT EXISTS hd_invoices_user_tech_idx
  ON hd_invoices (user_id, tech_name) WHERE tech_name IS NOT NULL;
CREATE INDEX IF NOT EXISTS hd_work_orders_user_tech_idx
  ON hd_work_orders (user_id, tech_name) WHERE tech_name IS NOT NULL;

-- Check. Should return two rows.
SELECT table_name, column_name FROM information_schema.columns
 WHERE column_name = 'tech_name' AND table_name IN ('hd_quotes', 'hd_invoices')
 ORDER BY table_name;

NOTIFY pgrst, 'reload schema';

COMMIT;
