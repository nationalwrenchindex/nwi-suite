-- Migration 106: Fleet Pro Partner layer + driver pre-trip inspections.
--
-- 105 gave a fleet customer a portal onto their own service records. This adds the
-- layer above it: the mechanic as a RESELLER who runs many fleet accounts, bills
-- $299/mo per account, and white-labels each portal.
--
-- Three separations matter and are enforced here, not just in the UI:
--   partner  -> sees every fleet he owns, plus his own rates/costs/margins
--   fleet    -> sees only its own fleet, and never the partner's cost basis
--   driver   -> no account at all; submits one pre-trip against one unit


-- ── 1. The partner ───────────────────────────────────────────────────────────
-- One row per reselling mechanic. Kurt is the first. Billing for the fleet
-- subscriptions rolls up to this row's Stripe customer, so a partner with nine
-- fleets has one payment method and nine subscriptions.
CREATE TABLE IF NOT EXISTS public.fleet_pro_partners (
  id                 UUID        DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id            UUID        NOT NULL UNIQUE REFERENCES auth.users(id) ON DELETE CASCADE,
  partner_name       TEXT        NOT NULL,
  contact_email      TEXT,
  default_logo_url   TEXT,
  stripe_customer_id TEXT,
  active             BOOLEAN     NOT NULL DEFAULT true,
  created_at         TIMESTAMPTZ DEFAULT NOW() NOT NULL,
  updated_at         TIMESTAMPTZ DEFAULT NOW() NOT NULL
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_fleet_pro_partners_stripe_customer
  ON public.fleet_pro_partners (stripe_customer_id)
  WHERE stripe_customer_id IS NOT NULL;


-- ── 2. Partner ↔ fleet account, with per-account white labelling ─────────────
-- Deliberately does NOT duplicate the subscription columns. Billing state lives on
-- hd_fleet_accounts.fleet_pro_* where migration 105 put it and where the Stripe
-- webhook already writes; a second copy here would be a guaranteed divergence.
-- This table owns the reseller relationship and the branding, nothing else.
CREATE TABLE IF NOT EXISTS public.fleet_pro_reseller_accounts (
  id                 UUID        DEFAULT gen_random_uuid() PRIMARY KEY,
  partner_id         UUID        NOT NULL REFERENCES public.fleet_pro_partners(id)  ON DELETE CASCADE,
  -- UNIQUE: a fleet account belongs to exactly one partner. Two partners billing
  -- for the same fleet would make "who does this portal belong to" unanswerable.
  fleet_account_id   UUID        NOT NULL UNIQUE REFERENCES public.hd_fleet_accounts(id) ON DELETE CASCADE,
  brand_name         TEXT,
  brand_logo_url     TEXT,
  brand_accent_color TEXT,
  notes              TEXT,
  created_at         TIMESTAMPTZ DEFAULT NOW() NOT NULL,
  updated_at         TIMESTAMPTZ DEFAULT NOW() NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_fleet_pro_reseller_partner
  ON public.fleet_pro_reseller_accounts (partner_id);

ALTER TABLE public.fleet_pro_reseller_accounts DROP CONSTRAINT IF EXISTS fleet_pro_reseller_accent_hex_check;
ALTER TABLE public.fleet_pro_reseller_accounts ADD CONSTRAINT fleet_pro_reseller_accent_hex_check
  CHECK (brand_accent_color IS NULL OR brand_accent_color ~* '^#[0-9a-f]{6}$');


-- ── 3. Driver pre-trip inspections ───────────────────────────────────────────
-- Submitted from a QR sticker on the unit with no account. There is no driver
-- identity in this system and inventing one would put a login between a driver and
-- a legally required daily inspection, so the driver types their name and that is
-- the record. Everything is written server-side through the service role.
CREATE TABLE IF NOT EXISTS public.fleet_pro_pretrip_inspections (
  id                UUID        DEFAULT gen_random_uuid() PRIMARY KEY,
  fleet_account_id  UUID        REFERENCES public.hd_fleet_accounts(id) ON DELETE SET NULL,
  unit_id           UUID        NOT NULL REFERENCES public.hd_units(id) ON DELETE CASCADE,
  driver_name       TEXT,
  inspection_date   DATE        NOT NULL DEFAULT CURRENT_DATE,
  odometer          NUMERIC(12,1),
  reefer_hours      NUMERIC(10,2),
  checklist_data    JSONB       NOT NULL DEFAULT '{}',
  defects           JSONB       NOT NULL DEFAULT '[]',
  overall_result    TEXT        NOT NULL DEFAULT 'pass'
                                CHECK (overall_result IN ('pass','fail')),
  signature_data    TEXT,
  -- Idempotency key minted on the device before the first send attempt. A queued
  -- offline submission WILL be replayed — by a retry, a second tab, or the service
  -- worker's sync event — and without this each replay writes another inspection.
  client_uuid       TEXT        UNIQUE,
  submitted_offline BOOLEAN     NOT NULL DEFAULT false,
  submitted_at      TIMESTAMPTZ DEFAULT NOW() NOT NULL,
  created_at        TIMESTAMPTZ DEFAULT NOW() NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_pretrip_unit
  ON public.fleet_pro_pretrip_inspections (unit_id, inspection_date DESC);
CREATE INDEX IF NOT EXISTS idx_pretrip_fleet
  ON public.fleet_pro_pretrip_inspections (fleet_account_id, inspection_date DESC);


-- ── 4. Meter history ─────────────────────────────────────────────────────────
-- hd_units carries only the CURRENT total_hours, so "hours history" had nowhere to
-- live. Every reading that arrives from any source lands here, which is what makes
-- a mileage/hours trend possible on the unit page.
CREATE TABLE IF NOT EXISTS public.fleet_pro_unit_meter_readings (
  id               UUID        DEFAULT gen_random_uuid() PRIMARY KEY,
  unit_id          UUID        NOT NULL REFERENCES public.hd_units(id) ON DELETE CASCADE,
  fleet_account_id UUID        REFERENCES public.hd_fleet_accounts(id) ON DELETE SET NULL,
  reading_date     DATE        NOT NULL DEFAULT CURRENT_DATE,
  odometer         NUMERIC(12,1),
  engine_hours     NUMERIC(10,2),
  source           TEXT        NOT NULL DEFAULT 'manual'
                               CHECK (source IN ('pretrip','work_order','pm','invoice','manual')),
  source_id        UUID,
  created_at       TIMESTAMPTZ DEFAULT NOW() NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_meter_unit_date
  ON public.fleet_pro_unit_meter_readings (unit_id, reading_date DESC);


-- ── 5. Lookup helpers ────────────────────────────────────────────────────────
-- Fleet accounts the caller resells. SECURITY DEFINER for the same reason as 105:
-- the policies below read these tables and must not recurse through their own RLS.
CREATE OR REPLACE FUNCTION public.fleet_pro_partner_account_ids()
RETURNS SETOF UUID
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  SELECT ra.fleet_account_id
  FROM   public.fleet_pro_reseller_accounts ra
  JOIN   public.fleet_pro_partners p ON p.id = ra.partner_id
  WHERE  p.user_id = auth.uid()
    AND  p.active = true;
$$;

REVOKE ALL ON FUNCTION public.fleet_pro_partner_account_ids() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.fleet_pro_partner_account_ids() TO authenticated;


-- ── 6. RLS ───────────────────────────────────────────────────────────────────

ALTER TABLE public.fleet_pro_partners            ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.fleet_pro_reseller_accounts   ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.fleet_pro_pretrip_inspections ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.fleet_pro_unit_meter_readings ENABLE ROW LEVEL SECURITY;

-- Partner rows are the partner's own. Note there is NO policy granting fleet members
-- any access to fleet_pro_partners or fleet_pro_reseller_accounts — the reseller
-- layer is the partner's commercial business and a fleet manager must never read it.
DROP POLICY IF EXISTS "fleet pro partners: own" ON public.fleet_pro_partners;
CREATE POLICY "fleet pro partners: own" ON public.fleet_pro_partners
  FOR ALL TO authenticated
  USING (user_id = auth.uid())
  WITH CHECK (user_id = auth.uid());

DROP POLICY IF EXISTS "fleet pro reseller: own" ON public.fleet_pro_reseller_accounts;
CREATE POLICY "fleet pro reseller: own" ON public.fleet_pro_reseller_accounts
  FOR ALL TO authenticated
  USING (EXISTS (
    SELECT 1 FROM public.fleet_pro_partners p
    WHERE p.id = fleet_pro_reseller_accounts.partner_id AND p.user_id = auth.uid()
  ))
  WITH CHECK (EXISTS (
    SELECT 1 FROM public.fleet_pro_partners p
    WHERE p.id = fleet_pro_reseller_accounts.partner_id AND p.user_id = auth.uid()
  ));

-- Pre-trips: the mechanic who owns the unit, the partner who resells the fleet, and
-- the fleet's own members can read. Nobody writes through RLS — the driver has no
-- session, so inserts go through the service role in the API route.
DROP POLICY IF EXISTS "pretrip: owner reads" ON public.fleet_pro_pretrip_inspections;
CREATE POLICY "pretrip: owner reads" ON public.fleet_pro_pretrip_inspections
  FOR SELECT TO authenticated
  USING (EXISTS (
    SELECT 1 FROM public.hd_units u
    WHERE u.id = fleet_pro_pretrip_inspections.unit_id AND u.user_id = auth.uid()
  ));

DROP POLICY IF EXISTS "pretrip: fleet members read" ON public.fleet_pro_pretrip_inspections;
CREATE POLICY "pretrip: fleet members read" ON public.fleet_pro_pretrip_inspections
  FOR SELECT TO authenticated
  USING (fleet_account_id IN (SELECT public.fleet_pro_account_ids()));

DROP POLICY IF EXISTS "pretrip: partner reads" ON public.fleet_pro_pretrip_inspections;
CREATE POLICY "pretrip: partner reads" ON public.fleet_pro_pretrip_inspections
  FOR SELECT TO authenticated
  USING (fleet_account_id IN (SELECT public.fleet_pro_partner_account_ids()));

-- Meter readings: same three audiences.
DROP POLICY IF EXISTS "meter: owner reads" ON public.fleet_pro_unit_meter_readings;
CREATE POLICY "meter: owner reads" ON public.fleet_pro_unit_meter_readings
  FOR SELECT TO authenticated
  USING (EXISTS (
    SELECT 1 FROM public.hd_units u
    WHERE u.id = fleet_pro_unit_meter_readings.unit_id AND u.user_id = auth.uid()
  ));

DROP POLICY IF EXISTS "meter: fleet members read" ON public.fleet_pro_unit_meter_readings;
CREATE POLICY "meter: fleet members read" ON public.fleet_pro_unit_meter_readings
  FOR SELECT TO authenticated
  USING (fleet_account_id IN (SELECT public.fleet_pro_account_ids()));

DROP POLICY IF EXISTS "meter: partner reads" ON public.fleet_pro_unit_meter_readings;
CREATE POLICY "meter: partner reads" ON public.fleet_pro_unit_meter_readings
  FOR SELECT TO authenticated
  USING (fleet_account_id IN (SELECT public.fleet_pro_partner_account_ids()));

-- The partner also reads the fleet-side tables for every account he resells. 105
-- granted this to fleet MEMBERS; a partner is not a member of his customers' fleets.
DROP POLICY IF EXISTS "fleet pro partner: read accounts" ON public.hd_fleet_accounts;
CREATE POLICY "fleet pro partner: read accounts" ON public.hd_fleet_accounts
  FOR SELECT TO authenticated
  USING (id IN (SELECT public.fleet_pro_partner_account_ids()));

DROP POLICY IF EXISTS "fleet pro partner: read units" ON public.hd_units;
CREATE POLICY "fleet pro partner: read units" ON public.hd_units
  FOR SELECT TO authenticated
  USING (fleet_account_id IN (SELECT public.fleet_pro_partner_account_ids()));

DROP POLICY IF EXISTS "fleet pro partner: read members" ON public.fleet_pro_members;
CREATE POLICY "fleet pro partner: read members" ON public.fleet_pro_members
  FOR SELECT TO authenticated
  USING (fleet_account_id IN (SELECT public.fleet_pro_partner_account_ids()));


-- ── 7. Backfill: seed the partner row from existing fleet ownership ──────────
-- Every mechanic who already has a Fleet-Pro-enabled account becomes a partner, and
-- those accounts become his reseller accounts. Without this the partner dashboard is
-- empty on first load even though the fleets already exist.
INSERT INTO public.fleet_pro_partners (user_id, partner_name, contact_email)
SELECT DISTINCT fa.user_id,
       COALESCE(pr.business_name, pr.full_name, 'NWI Partner'),
       pr.email
FROM   public.hd_fleet_accounts fa
JOIN   public.profiles pr ON pr.id = fa.user_id
WHERE  fa.fleet_pro_enabled = true
ON CONFLICT (user_id) DO NOTHING;

INSERT INTO public.fleet_pro_reseller_accounts (partner_id, fleet_account_id, brand_name)
SELECT p.id, fa.id, fa.fleet_name
FROM   public.hd_fleet_accounts fa
JOIN   public.fleet_pro_partners p ON p.user_id = fa.user_id
WHERE  fa.fleet_pro_enabled = true
ON CONFLICT (fleet_account_id) DO NOTHING;
