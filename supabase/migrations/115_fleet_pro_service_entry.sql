-- Migration 115: technician service entry from the QR page.
--
-- 106 gave the QR sticker to the DRIVER: a walkaround, no account, one row per morning.
-- This is the same sticker used by the TECHNICIAN: he photographs the repair invoice he
-- is holding, a vision model reads it, he corrects it on screen, and it lands here as a
-- dated cost record against that unit.
--
-- Two things follow from "no account", and both are enforced below rather than in the UI:
--   * fleet_account_id is written by the server from the unit row, never by the client.
--   * there is NO RLS write policy at all. The tech has no session; the insert happens
--     on the service role inside /api/inspect/service-entry. Read policies mirror the
--     pre-trip table in 106 — mechanic owner, fleet member, reseller partner.


-- ── 1. The table ─────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.fleet_pro_service_entries (
  id                UUID        DEFAULT gen_random_uuid() PRIMARY KEY,
  unit_id           UUID        NOT NULL REFERENCES public.hd_units(id) ON DELETE CASCADE,
  -- Denormalized from the unit so the fleet-scoped read policies below are a plain
  -- column comparison instead of a join on every row.
  fleet_account_id  UUID        REFERENCES public.hd_fleet_accounts(id) ON DELETE SET NULL,

  technician_name   TEXT,
  vendor_name       TEXT,
  invoice_number    TEXT,
  service_date      DATE        NOT NULL DEFAULT CURRENT_DATE,
  labor_description TEXT,
  -- [{ name, qty, cost }]. JSONB rather than a child table: these lines are read as a
  -- block with the entry and never queried across entries.
  parts             JSONB       NOT NULL DEFAULT '[]'::jsonb,

  labor_cost        NUMERIC(10,2),
  parts_cost        NUMERIC(10,2),
  tax               NUMERIC(10,2),
  total             NUMERIC(10,2),

  image_url         TEXT,
  -- What the vision model returned BEFORE the tech corrected it. This is the audit
  -- trail: without it there is no way to ever tell a machine-read figure from a
  -- human-typed one, which is exactly the question that matters if a number is wrong.
  extracted_raw     JSONB,

  source            TEXT        NOT NULL DEFAULT 'qr_tech_entry',

  -- IDEMPOTENCY. Minted on the device before the first send and reused by every retry;
  -- the route treats a 23505 here as SUCCESS. A phone on one bar in a yard WILL retry,
  -- and without this that becomes five copies of one repair in the unit's cost history.
  -- NULLs are distinct under a UNIQUE constraint, which is fine: an entry that somehow
  -- arrived with no client_uuid is still a real repair and must not be refused.
  client_uuid       TEXT        UNIQUE,

  created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

COMMENT ON TABLE public.fleet_pro_service_entries IS
  'Repair/service records entered by a technician through the public QR page. Written only by the service role.';


-- ── 2. Indexes ───────────────────────────────────────────────────────────────
-- Both access paths are "newest first for one scope": the unit timeline, and the
-- fleet-wide spend/history view.
CREATE INDEX IF NOT EXISTS idx_fleet_pro_service_entries_unit_date
  ON public.fleet_pro_service_entries (unit_id, service_date DESC);

CREATE INDEX IF NOT EXISTS idx_fleet_pro_service_entries_account_date
  ON public.fleet_pro_service_entries (fleet_account_id, service_date DESC);


-- ── 3. RLS ───────────────────────────────────────────────────────────────────
ALTER TABLE public.fleet_pro_service_entries ENABLE ROW LEVEL SECURITY;

-- Same three audiences as fleet_pro_pretrip_inspections in 106, using the helpers that
-- migration already defined. They are reused, not redefined — redefining them here
-- would fork the membership rules (lapsed-subscription checks included) into two files.

-- The mechanic who owns the unit.
DROP POLICY IF EXISTS "service entry: owner reads" ON public.fleet_pro_service_entries;
CREATE POLICY "service entry: owner reads" ON public.fleet_pro_service_entries
  FOR SELECT TO authenticated
  USING (EXISTS (
    SELECT 1 FROM public.hd_units u
    WHERE u.id = fleet_pro_service_entries.unit_id AND u.user_id = auth.uid()
  ));

-- Anyone on the fleet's roster, while that fleet's subscription is live.
DROP POLICY IF EXISTS "service entry: fleet members read" ON public.fleet_pro_service_entries;
CREATE POLICY "service entry: fleet members read" ON public.fleet_pro_service_entries
  FOR SELECT TO authenticated
  USING (fleet_account_id IN (SELECT public.fleet_pro_account_ids()));

-- The partner who resells this fleet account.
DROP POLICY IF EXISTS "service entry: partner reads" ON public.fleet_pro_service_entries;
CREATE POLICY "service entry: partner reads" ON public.fleet_pro_service_entries
  FOR SELECT TO authenticated
  USING (fleet_account_id IN (SELECT public.fleet_pro_partner_account_ids()));

-- NO INSERT / UPDATE / DELETE POLICY, deliberately.
-- The technician standing at the truck has no session at all, so there is no role to
-- write one for. Adding a permissive write policy here to "make it easier" would open
-- the table to every authenticated user in the system. Writes go through the service
-- role in /api/inspect/service-entry, which derives fleet_account_id from the unit and
-- caps every field before the insert.
