-- Migration 114: Fleet Pro — vehicle registration / plate tracking.
--
-- A fleet manager's second recurring deadline after PM. The plate on a unit expires
-- on a date, renewing it costs money every year, and a truck pulled over on an
-- expired tag is off the road — so this is a compliance record, not a note field.
--
-- Deliberately its own table rather than columns on hd_units:
--   * hd_units is the MECHANIC's equipment record. Registration is the FLEET's
--     administrative record about the same asset, written by a different party.
--   * The dashboard needs an index on (fleet, expiry) to sort the renewal queue.
--     A partial index over a nullable column on hd_units would carry every unit the
--     mechanic owns, fleet or not.
--   * A unit may be sold or re-plated; the registration row can be cleared without
--     touching the equipment history.
--
-- One row per unit, enforced by a unique index rather than a PK on unit_id, so the
-- surrogate id stays consistent with every other fleet_pro_* table.


-- ── 1. The registration record ───────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.fleet_pro_unit_registration (
  id               UUID        DEFAULT gen_random_uuid() PRIMARY KEY,
  unit_id          UUID        NOT NULL REFERENCES public.hd_units(id) ON DELETE CASCADE,
  -- Nullable + SET NULL, matching fleet_pro_unit_meter_readings (106): a unit can
  -- exist on the mechanic's books before it is attached to a fleet account, and
  -- deleting the fleet must not destroy the plate history of the trucks.
  fleet_account_id UUID        REFERENCES public.hd_fleet_accounts(id) ON DELETE SET NULL,

  license_plate    TEXT,
  -- State / province / IRP base jurisdiction. NOT a CHECK enum on the fifty US
  -- states: Canadian provinces (AB, BC, ON), Mexican states, and IRP apportioned
  -- plates all legitimately appear on a US fleet, and a constraint that rejects
  -- them would block a real renewal from being recorded. Length only.
  jurisdiction     TEXT        CHECK (jurisdiction IS NULL OR char_length(btrim(jurisdiction)) BETWEEN 2 AND 8),

  expires_on       DATE,
  annual_cost      NUMERIC(10,2) CHECK (annual_cost IS NULL OR annual_cost >= 0),
  notes            TEXT,

  created_by       UUID        REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at       TIMESTAMPTZ DEFAULT NOW() NOT NULL,
  updated_at       TIMESTAMPTZ DEFAULT NOW() NOT NULL
);

-- One registration per unit. This is also the upsert target the API route names in
-- onConflict — without it the PUT would insert a second row on every save.
CREATE UNIQUE INDEX IF NOT EXISTS idx_fleet_pro_registration_unit
  ON public.fleet_pro_unit_registration (unit_id);

-- The renewal queue: "every plate in my fleet, soonest expiry first". Same shape as
-- idx_fleet_pro_pm_due in 105, which the PM dashboard sorts by.
CREATE INDEX IF NOT EXISTS idx_fleet_pro_registration_due
  ON public.fleet_pro_unit_registration (fleet_account_id, expires_on);


-- ── 2. RLS ───────────────────────────────────────────────────────────────────
-- Same four-audience shape as 105/106. The two SECURITY DEFINER helpers
-- (fleet_pro_account_ids, fleet_pro_managed_account_ids from 105;
-- fleet_pro_partner_account_ids from 106) already exist and are reused as-is —
-- redefining them here would silently fork the subscription-liveness rule.
ALTER TABLE public.fleet_pro_unit_registration ENABLE ROW LEVEL SECURITY;

-- The mechanic who owns the unit. Reached through hd_units rather than a user_id
-- column of its own: this table's row is about a unit, and the unit already knows
-- who owns it. A local copy could drift after a unit is transferred.
DROP POLICY IF EXISTS "fleet pro registration: owner manages" ON public.fleet_pro_unit_registration;
CREATE POLICY "fleet pro registration: owner manages" ON public.fleet_pro_unit_registration
  FOR ALL TO authenticated
  USING (EXISTS (
    SELECT 1 FROM public.hd_units u
    WHERE u.id = fleet_pro_unit_registration.unit_id AND u.user_id = auth.uid()
  ))
  WITH CHECK (EXISTS (
    SELECT 1 FROM public.hd_units u
    WHERE u.id = fleet_pro_unit_registration.unit_id AND u.user_id = auth.uid()
  ));

-- Everyone in the fleet reads: a supervisor needs to see an expiring tag even
-- though they may not fix it.
DROP POLICY IF EXISTS "fleet pro registration: members read" ON public.fleet_pro_unit_registration;
CREATE POLICY "fleet pro registration: members read" ON public.fleet_pro_unit_registration
  FOR SELECT TO authenticated
  USING (fleet_account_id IN (SELECT public.fleet_pro_account_ids()));

-- Only the fleet manager writes.
DROP POLICY IF EXISTS "fleet pro registration: managers write" ON public.fleet_pro_unit_registration;
CREATE POLICY "fleet pro registration: managers write" ON public.fleet_pro_unit_registration
  FOR ALL TO authenticated
  USING (fleet_account_id IN (SELECT public.fleet_pro_managed_account_ids()))
  WITH CHECK (fleet_account_id IN (SELECT public.fleet_pro_managed_account_ids()));

-- The reselling partner reads every fleet he bills for. Read only here, same as the
-- pre-trip and meter policies in 106 — the partner's write path is the API route,
-- which runs on the service client after its own ownership check.
DROP POLICY IF EXISTS "fleet pro registration: partner reads" ON public.fleet_pro_unit_registration;
CREATE POLICY "fleet pro registration: partner reads" ON public.fleet_pro_unit_registration
  FOR SELECT TO authenticated
  USING (fleet_account_id IN (SELECT public.fleet_pro_partner_account_ids()));
