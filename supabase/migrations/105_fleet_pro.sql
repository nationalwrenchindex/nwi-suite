-- Migration 105: NWI Fleet Pro — a read-mostly portal that lets a fleet customer
-- (sheriff's department, utility co-op) see the service their mechanic performed.
--
-- This is the first multi-user surface in the app. Every other table in the schema
-- is single-tenant: `user_id = auth.uid()` means "the mechanic owns this row". Fleet
-- Pro introduces a second party who reads a subset of the mechanic's rows, scoped to
-- one hd_fleet_accounts row, at one of three permission levels.
--
-- The existing owner policies are left exactly as they are. Postgres OR's multiple
-- permissive policies together, so the SELECT policies added here widen access for
-- fleet members without loosening anything for the mechanic.


-- ── 1. Fleet Pro subscription lives on the fleet account ─────────────────────
-- Billing is per fleet account, not per member: the department pays $299/mo and
-- seats its own people. Kept off `subscriptions` because that table is keyed
-- one-row-per-user and a fleet account is not a user.
ALTER TABLE public.hd_fleet_accounts
  ADD COLUMN IF NOT EXISTS fleet_pro_enabled                BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS fleet_pro_status                 TEXT,
  ADD COLUMN IF NOT EXISTS fleet_pro_stripe_customer_id     TEXT,
  ADD COLUMN IF NOT EXISTS fleet_pro_stripe_subscription_id TEXT,
  ADD COLUMN IF NOT EXISTS fleet_pro_activated_at           TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS fleet_pro_current_period_end     TIMESTAMPTZ;

ALTER TABLE public.hd_fleet_accounts DROP CONSTRAINT IF EXISTS hd_fleet_accounts_fleet_pro_status_check;
ALTER TABLE public.hd_fleet_accounts ADD CONSTRAINT hd_fleet_accounts_fleet_pro_status_check
  CHECK (fleet_pro_status IS NULL OR fleet_pro_status IN ('active','trialing','past_due','canceled','inactive'));

CREATE UNIQUE INDEX IF NOT EXISTS idx_hd_fleet_accounts_fp_sub
  ON public.hd_fleet_accounts (fleet_pro_stripe_subscription_id)
  WHERE fleet_pro_stripe_subscription_id IS NOT NULL;


-- ── 2. Members — the new identity layer ──────────────────────────────────────
-- A row exists from the moment someone is invited, before any auth.users row is
-- linked, so `user_id` is nullable and `email` is the durable key. On accept the
-- invite binds user_id and flips status to 'active'.
--
-- Roles:
--   manager    — sees everything, edits units, manages PM schedules, invites others
--   supervisor — sees everything, no writes
--   viewer     — sees everything except cost figures, no writes
CREATE TABLE IF NOT EXISTS public.fleet_pro_members (
  id                UUID        DEFAULT gen_random_uuid() PRIMARY KEY,
  fleet_account_id  UUID        NOT NULL REFERENCES public.hd_fleet_accounts(id) ON DELETE CASCADE,
  user_id           UUID        REFERENCES auth.users(id) ON DELETE SET NULL,
  email             TEXT        NOT NULL,
  full_name         TEXT,
  role              TEXT        NOT NULL DEFAULT 'viewer'
                                CHECK (role IN ('manager','supervisor','viewer')),
  status            TEXT        NOT NULL DEFAULT 'invited'
                                CHECK (status IN ('invited','active','revoked')),
  invite_token      TEXT        UNIQUE,
  invite_expires_at TIMESTAMPTZ,
  invited_by        UUID        REFERENCES auth.users(id) ON DELETE SET NULL,
  invited_at        TIMESTAMPTZ DEFAULT NOW(),
  accepted_at       TIMESTAMPTZ,
  created_at        TIMESTAMPTZ DEFAULT NOW() NOT NULL,
  updated_at        TIMESTAMPTZ DEFAULT NOW() NOT NULL
);

-- One membership per email per fleet. Case-insensitive because invites are typed by hand.
CREATE UNIQUE INDEX IF NOT EXISTS idx_fleet_pro_members_account_email
  ON public.fleet_pro_members (fleet_account_id, lower(email));
CREATE INDEX IF NOT EXISTS idx_fleet_pro_members_user
  ON public.fleet_pro_members (user_id) WHERE user_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_fleet_pro_members_account
  ON public.fleet_pro_members (fleet_account_id, status);


-- ── 3. PM scheduling — date-based, deliberately not the HD hours model ───────
-- HD tracks PM in engine hours (hd_units.next_pm_due_hours). A fleet customer
-- budgets in calendar time and the requirement is a 30-day warning, so Fleet Pro
-- keeps its own date-based interval per unit. The two coexist: the HD side keeps
-- driving hours-based PM for the mechanic, this drives the portal's red flags.
CREATE TABLE IF NOT EXISTS public.fleet_pro_pm_schedules (
  id                 UUID        DEFAULT gen_random_uuid() PRIMARY KEY,
  fleet_account_id   UUID        NOT NULL REFERENCES public.hd_fleet_accounts(id) ON DELETE CASCADE,
  unit_id            UUID        NOT NULL REFERENCES public.hd_units(id) ON DELETE CASCADE,
  interval_days      INTEGER     NOT NULL CHECK (interval_days > 0 AND interval_days <= 3650),
  last_service_date  DATE,
  next_due_date      DATE,
  service_description TEXT,
  -- Dedupe guard: without it a unit sitting 25 days out is emailed every morning
  -- for a month. Cleared whenever next_due_date moves.
  alert_sent_at      TIMESTAMPTZ,
  alert_sent_for     DATE,
  created_by         UUID        REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at         TIMESTAMPTZ DEFAULT NOW() NOT NULL,
  updated_at         TIMESTAMPTZ DEFAULT NOW() NOT NULL
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_fleet_pro_pm_unit ON public.fleet_pro_pm_schedules (unit_id);
CREATE INDEX IF NOT EXISTS idx_fleet_pro_pm_due
  ON public.fleet_pro_pm_schedules (fleet_account_id, next_due_date);


-- ── 4. Close the invoice → fleet/unit gap ────────────────────────────────────
-- hd_invoices carries free-text unit fields and (since 102) a work_order_id, but no
-- structural link to a unit or a fleet. Requirement 6 — an invoice Kurt sends
-- appearing on the customer's dashboard — has nothing to key on without these, and
-- per-unit cost reporting is impossible.
ALTER TABLE public.hd_invoices
  ADD COLUMN IF NOT EXISTS unit_id          UUID REFERENCES public.hd_units(id)          ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS fleet_account_id UUID REFERENCES public.hd_fleet_accounts(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_hd_invoices_unit  ON public.hd_invoices (unit_id)          WHERE unit_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_hd_invoices_fleet ON public.hd_invoices (fleet_account_id) WHERE fleet_account_id IS NOT NULL;

-- Backfill what can be recovered: an invoice tied to a work order inherits that
-- work order's unit and fleet. Invoices with no work_order_id (everything billed
-- before migration 102) cannot be attributed and stay NULL — they will not appear
-- on any Fleet Pro dashboard until linked by hand.
UPDATE public.hd_invoices i
SET    unit_id          = COALESCE(i.unit_id,          wo.unit_id),
       fleet_account_id = COALESCE(i.fleet_account_id, wo.fleet_account_id)
FROM   public.hd_work_orders wo
WHERE  i.work_order_id = wo.id
  AND  (i.unit_id IS NULL OR i.fleet_account_id IS NULL);

-- Second pass: recover what the work-order join could not. In practice no existing
-- invoice carries a work_order_id (that FK only arrived in 102), so without this the
-- backfill above attributes nothing at all and every historical invoice is invisible
-- to the portal.
--
-- Matches on serial number, and ONLY when exactly one unit matches. An ambiguous
-- serial resolves to nothing rather than a guess: attributing an invoice to the wrong
-- unit puts one department's spend on another department's dashboard, which is a data
-- leak, not a display bug. Same rule the runtime resolver applies.
UPDATE public.hd_invoices i
SET    unit_id          = u.id,
       fleet_account_id = u.fleet_account_id
FROM   public.hd_units u
WHERE  i.unit_id IS NULL
  AND  i.unit_serial IS NOT NULL
  AND  btrim(i.unit_serial) <> ''
  AND  u.user_id = i.user_id
  AND  lower(btrim(u.serial_number)) = lower(btrim(i.unit_serial))
  AND  (
         SELECT count(*)
         FROM   public.hd_units u2
         WHERE  u2.user_id = i.user_id
           AND  u2.serial_number IS NOT NULL
           AND  lower(btrim(u2.serial_number)) = lower(btrim(i.unit_serial))
       ) = 1;


-- ── 5. Membership lookup helpers ─────────────────────────────────────────────
-- SECURITY DEFINER so the policies below can read fleet_pro_members without the
-- caller needing a policy on that table — and so the members policies themselves
-- do not recurse. STABLE, not VOLATILE, so the planner can hoist it out of loops.
CREATE OR REPLACE FUNCTION public.fleet_pro_account_ids()
RETURNS SETOF UUID
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  SELECT m.fleet_account_id
  FROM   public.fleet_pro_members m
  JOIN   public.hd_fleet_accounts a ON a.id = m.fleet_account_id
  WHERE  m.user_id = auth.uid()
    AND  m.status  = 'active'
    -- Access dies with the subscription. A lapsed department loses the portal.
    AND  a.fleet_pro_enabled = true
    AND  COALESCE(a.fleet_pro_status, '') IN ('active','trialing','past_due');
$$;

REVOKE ALL ON FUNCTION public.fleet_pro_account_ids() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.fleet_pro_account_ids() TO authenticated;

-- Same set, narrowed to accounts where the caller is the manager.
CREATE OR REPLACE FUNCTION public.fleet_pro_managed_account_ids()
RETURNS SETOF UUID
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  SELECT m.fleet_account_id
  FROM   public.fleet_pro_members m
  JOIN   public.hd_fleet_accounts a ON a.id = m.fleet_account_id
  WHERE  m.user_id = auth.uid()
    AND  m.status  = 'active'
    AND  m.role    = 'manager'
    AND  a.fleet_pro_enabled = true
    AND  COALESCE(a.fleet_pro_status, '') IN ('active','trialing','past_due');
$$;

REVOKE ALL ON FUNCTION public.fleet_pro_managed_account_ids() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.fleet_pro_managed_account_ids() TO authenticated;


-- ── 6. RLS ───────────────────────────────────────────────────────────────────

ALTER TABLE public.fleet_pro_members     ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.fleet_pro_pm_schedules ENABLE ROW LEVEL SECURITY;

-- Members: the mechanic who owns the fleet account manages the roster; a fleet
-- member may read the roster of their own fleet. Invite creation and role changes
-- go through API routes on the service client, which enforce role explicitly —
-- these policies are the backstop, not the gate.
DROP POLICY IF EXISTS "fleet pro members: owner manages" ON public.fleet_pro_members;
CREATE POLICY "fleet pro members: owner manages" ON public.fleet_pro_members
  FOR ALL TO authenticated
  USING (EXISTS (
    SELECT 1 FROM public.hd_fleet_accounts a
    WHERE a.id = fleet_pro_members.fleet_account_id AND a.user_id = auth.uid()
  ))
  WITH CHECK (EXISTS (
    SELECT 1 FROM public.hd_fleet_accounts a
    WHERE a.id = fleet_pro_members.fleet_account_id AND a.user_id = auth.uid()
  ));

DROP POLICY IF EXISTS "fleet pro members: read own roster" ON public.fleet_pro_members;
CREATE POLICY "fleet pro members: read own roster" ON public.fleet_pro_members
  FOR SELECT TO authenticated
  USING (fleet_account_id IN (SELECT public.fleet_pro_account_ids()));

-- PM schedules: mechanic owns, managers write, everyone else in the fleet reads.
DROP POLICY IF EXISTS "fleet pro pm: owner manages" ON public.fleet_pro_pm_schedules;
CREATE POLICY "fleet pro pm: owner manages" ON public.fleet_pro_pm_schedules
  FOR ALL TO authenticated
  USING (EXISTS (
    SELECT 1 FROM public.hd_fleet_accounts a
    WHERE a.id = fleet_pro_pm_schedules.fleet_account_id AND a.user_id = auth.uid()
  ))
  WITH CHECK (EXISTS (
    SELECT 1 FROM public.hd_fleet_accounts a
    WHERE a.id = fleet_pro_pm_schedules.fleet_account_id AND a.user_id = auth.uid()
  ));

DROP POLICY IF EXISTS "fleet pro pm: members read" ON public.fleet_pro_pm_schedules;
CREATE POLICY "fleet pro pm: members read" ON public.fleet_pro_pm_schedules
  FOR SELECT TO authenticated
  USING (fleet_account_id IN (SELECT public.fleet_pro_account_ids()));

DROP POLICY IF EXISTS "fleet pro pm: managers write" ON public.fleet_pro_pm_schedules;
CREATE POLICY "fleet pro pm: managers write" ON public.fleet_pro_pm_schedules
  FOR ALL TO authenticated
  USING (fleet_account_id IN (SELECT public.fleet_pro_managed_account_ids()))
  WITH CHECK (fleet_account_id IN (SELECT public.fleet_pro_managed_account_ids()));


-- Read access to the mechanic's service data, scoped to the member's fleet.
-- Additive: the existing "user_id = auth.uid()" owner policies are untouched.
DROP POLICY IF EXISTS "fleet pro: read fleet account" ON public.hd_fleet_accounts;
CREATE POLICY "fleet pro: read fleet account" ON public.hd_fleet_accounts
  FOR SELECT TO authenticated
  USING (id IN (SELECT public.fleet_pro_account_ids()));

DROP POLICY IF EXISTS "fleet pro: read units" ON public.hd_units;
CREATE POLICY "fleet pro: read units" ON public.hd_units
  FOR SELECT TO authenticated
  USING (fleet_account_id IN (SELECT public.fleet_pro_account_ids()));

-- Managers may correct their own unit records (requirement: manager can add/edit
-- units). UPDATE and INSERT only — deleting a unit would orphan compliance records,
-- so removal stays with the mechanic.
DROP POLICY IF EXISTS "fleet pro: managers update units" ON public.hd_units;
CREATE POLICY "fleet pro: managers update units" ON public.hd_units
  FOR UPDATE TO authenticated
  USING (fleet_account_id IN (SELECT public.fleet_pro_managed_account_ids()))
  WITH CHECK (fleet_account_id IN (SELECT public.fleet_pro_managed_account_ids()));

DROP POLICY IF EXISTS "fleet pro: read work orders" ON public.hd_work_orders;
CREATE POLICY "fleet pro: read work orders" ON public.hd_work_orders
  FOR SELECT TO authenticated
  USING (fleet_account_id IN (SELECT public.fleet_pro_account_ids()));

DROP POLICY IF EXISTS "fleet pro: read invoices" ON public.hd_invoices;
CREATE POLICY "fleet pro: read invoices" ON public.hd_invoices
  FOR SELECT TO authenticated
  USING (fleet_account_id IN (SELECT public.fleet_pro_account_ids()));

DROP POLICY IF EXISTS "fleet pro: read dot inspections" ON public.hd_dot_inspections;
CREATE POLICY "fleet pro: read dot inspections" ON public.hd_dot_inspections
  FOR SELECT TO authenticated
  USING (fleet_account_id IN (SELECT public.fleet_pro_account_ids()));

DROP POLICY IF EXISTS "fleet pro: read aerial inspections" ON public.hd_aerial_inspections;
CREATE POLICY "fleet pro: read aerial inspections" ON public.hd_aerial_inspections
  FOR SELECT TO authenticated
  USING (fleet_account_id IN (SELECT public.fleet_pro_account_ids()));

DROP POLICY IF EXISTS "fleet pro: read equipment inspections" ON public.hd_equipment_inspections;
CREATE POLICY "fleet pro: read equipment inspections" ON public.hd_equipment_inspections
  FOR SELECT TO authenticated
  USING (fleet_account_id IN (SELECT public.fleet_pro_account_ids()));

-- hd_pm_checklists has no fleet_account_id column; reach the fleet through the unit.
DROP POLICY IF EXISTS "fleet pro: read pm checklists" ON public.hd_pm_checklists;
CREATE POLICY "fleet pro: read pm checklists" ON public.hd_pm_checklists
  FOR SELECT TO authenticated
  USING (EXISTS (
    SELECT 1 FROM public.hd_units u
    WHERE u.id = hd_pm_checklists.unit_id
      AND u.fleet_account_id IN (SELECT public.fleet_pro_account_ids())
  ));
