-- 192_fleet_pro_member_money_reads.sql
--
-- OPTIONAL. NOT NEEDED BY THE FLEET MANAGER DASHBOARD. Brock decides.
--
-- WHAT IS WRONG. Migration 105 gives every ACTIVE Fleet Pro member, at ANY role, SELECT
-- on WHOLE ROWS of hd_work_orders and hd_invoices for their fleet:
--   "fleet pro: read work orders"  ON hd_work_orders  USING (fleet_account_id IN (SELECT fleet_pro_account_ids()))
--   "fleet pro: read invoices"     ON hd_invoices     USING (fleet_account_id IN (SELECT fleet_pro_account_ids()))
-- Proved live Nov 23, 2026 (scratch probe, no SQL): a throwaway VIEWER - the role 105
-- describes as "sees everything except cost figures" - read straight from PostgREST,
-- with his own token: labor_rate, total, subtotal_labor, subtotal_parts, tax_amount,
-- parts_cost, parts_sell, parts_markup_percent, internal_notes, customer_email,
-- customer_phone, travel_rate, mileage_rate, discount, and line_items with each part's
-- unit_cost, unit_cost_base and markup_percent. The portal hides cost from a viewer;
-- the database hands it over to anyone who asks it directly.
--
-- WHY DROPPING THEM BREAKS NOTHING. No Fleet Pro screen or route reads hd_work_orders
-- or hd_invoices through the member's session: every read in src/app/fleet-pro,
-- src/app/api/fleet-pro and src/lib/fleet-pro goes through the service client after
-- getFleetProMembership (checked by grep, Nov 23). The only session read of an hd_*
-- table there is /api/fleet-pro/units/[id]/pm-items, which reads hd_units scoped to
-- user_id = the caller - the shop owner's own policy, untouched here.
--
-- WHAT THIS DOES.
--   1. Drops those two policies. Nothing else.
--   - The owner policies (user_id = auth.uid()) are not touched: the mechanic reads
--     exactly what he reads now.
--   - hd_units, hd_fleet_accounts and the inspection tables keep their 105 member
--     policies. hd_units still exposes estimated_value to a member; Fleet Pro shows unit
--     value to managers by design, so that is left for Brock to call.
--   - No view replaces them: nothing reads through them, so nothing needs a substitute.
--     If a member-facing direct read is ever wanted, it should be a security_invoker
--     view naming its columns (CLAUDE.md, views rule), not these whole-row policies.
--
-- THE CHECK refuses - rolling everything back - unless, after the drop, neither policy
-- exists AND no remaining policy on either table lets anyone but the row's owner read it
-- (every remaining SELECT/ALL policy's USING must mention auth.uid() = user_id). It also
-- prints the remaining policies so the result can be read in the editor.
--
-- UNDO: re-run section 6 of 105_fleet_pro.sql for these two policies.
--
-- COMMIT-ARMED, per Brock's instruction for this build. Plain ASCII. NOT APPLIED.

BEGIN;

DROP POLICY IF EXISTS "fleet pro: read work orders" ON public.hd_work_orders;
DROP POLICY IF EXISTS "fleet pro: read invoices"    ON public.hd_invoices;

DO $$
DECLARE
  r RECORD;
  bad INTEGER := 0;
BEGIN
  IF EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = 'public'
               AND policyname IN ('fleet pro: read work orders', 'fleet pro: read invoices')) THEN
    RAISE EXCEPTION '192: a fleet pro member read policy is still present';
  END IF;

  FOR r IN
    SELECT tablename, policyname, cmd, roles::TEXT AS roles, COALESCE(qual, '') AS qual
      FROM pg_policies
     WHERE schemaname = 'public' AND tablename IN ('hd_work_orders', 'hd_invoices')
     ORDER BY tablename, policyname
  LOOP
    RAISE NOTICE '192 remaining: % | % | % | % | %', r.tablename, r.policyname, r.cmd, r.roles, r.qual;
    IF r.cmd IN ('SELECT', 'ALL') AND r.qual NOT LIKE '%auth.uid()%' THEN
      bad := bad + 1;
    END IF;
  END LOOP;

  IF bad > 0 THEN
    RAISE EXCEPTION '192: % remaining read policy(ies) on hd_work_orders / hd_invoices do not test auth.uid(); read the NOTICE lines above', bad;
  END IF;
END $$;

COMMIT;
