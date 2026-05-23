-- Migration 047: HD Fleet and Unit Management Tables
-- Supports NWI HD Suite — heavy duty diesel and transport refrigeration vertical

-- ── Fleet accounts (commercial fleet customers) ──────────────────────────────
CREATE TABLE IF NOT EXISTS public.hd_fleet_accounts (
  id            UUID        DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id       UUID        REFERENCES auth.users(id) ON DELETE CASCADE NOT NULL,
  fleet_name    TEXT        NOT NULL,
  contact_name  TEXT,
  contact_phone TEXT,
  contact_email TEXT,
  address       TEXT,
  notes         TEXT,
  created_at    TIMESTAMPTZ DEFAULT NOW()
);

ALTER TABLE public.hd_fleet_accounts ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users manage own fleet accounts"
  ON public.hd_fleet_accounts
  FOR ALL USING (auth.uid() = user_id);

CREATE INDEX IF NOT EXISTS idx_hd_fleet_accounts_user
  ON public.hd_fleet_accounts (user_id);

-- ── Fleet units (individual refrigerated units / trucks) ──────────────────────
CREATE TABLE IF NOT EXISTS public.hd_units (
  id                  UUID         DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id             UUID         REFERENCES auth.users(id) ON DELETE CASCADE NOT NULL,
  fleet_account_id    UUID         REFERENCES public.hd_fleet_accounts(id) ON DELETE SET NULL,
  unit_number         TEXT         NOT NULL,
  truck_trailer_number TEXT,
  manufacturer        TEXT         NOT NULL,
  model               TEXT         NOT NULL,
  serial_number       TEXT,
  year                INTEGER,
  unit_type           TEXT         DEFAULT 'trailer',  -- truck | trailer
  refrigerant_type    TEXT         DEFAULT 'R-404A',
  total_hours         DECIMAL(10,2) DEFAULT 0,
  engine_hours        DECIMAL(10,2) DEFAULT 0,
  electric_hours      DECIMAL(10,2) DEFAULT 0,
  last_pm_date        DATE,
  last_pm_hours       DECIMAL(10,2),
  last_pm_type        TEXT,
  next_pm_due_hours   DECIMAL(10,2),
  notes               TEXT,
  status              TEXT         DEFAULT 'active',   -- active | inactive | out_of_service
  created_at          TIMESTAMPTZ  DEFAULT NOW()
);

ALTER TABLE public.hd_units ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users manage own hd units"
  ON public.hd_units
  FOR ALL USING (auth.uid() = user_id);

CREATE INDEX IF NOT EXISTS idx_hd_units_user
  ON public.hd_units (user_id);
CREATE INDEX IF NOT EXISTS idx_hd_units_fleet_account
  ON public.hd_units (fleet_account_id);
CREATE INDEX IF NOT EXISTS idx_hd_units_status
  ON public.hd_units (status);

-- ── Work orders ───────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.hd_work_orders (
  id                 UUID         DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id            UUID         REFERENCES auth.users(id) ON DELETE CASCADE NOT NULL,
  unit_id            UUID         REFERENCES public.hd_units(id) ON DELETE SET NULL,
  fleet_account_id   UUID         REFERENCES public.hd_fleet_accounts(id) ON DELETE SET NULL,
  work_order_number  TEXT,
  service_type       TEXT,
  status             TEXT         DEFAULT 'open',  -- open | in_progress | completed | invoiced
  current_setpoint   TEXT,
  location           TEXT,
  service_requests   TEXT,
  comments           TEXT,
  tech_name          TEXT,
  started_at         TIMESTAMPTZ,
  completed_at       TIMESTAMPTZ,
  labor_hours        DECIMAL(10,2),
  labor_rate         DECIMAL(10,2),
  total_amount       DECIMAL(10,2),
  flagged_items      JSONB,
  created_at         TIMESTAMPTZ  DEFAULT NOW()
);

ALTER TABLE public.hd_work_orders ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users manage own hd work orders"
  ON public.hd_work_orders
  FOR ALL USING (auth.uid() = user_id);

CREATE INDEX IF NOT EXISTS idx_hd_work_orders_user
  ON public.hd_work_orders (user_id);
CREATE INDEX IF NOT EXISTS idx_hd_work_orders_unit
  ON public.hd_work_orders (unit_id);
CREATE INDEX IF NOT EXISTS idx_hd_work_orders_status
  ON public.hd_work_orders (status);

-- ── PM checklists ─────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.hd_pm_checklists (
  id                        UUID         DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id                   UUID         REFERENCES auth.users(id) ON DELETE CASCADE NOT NULL,
  work_order_id             UUID         REFERENCES public.hd_work_orders(id) ON DELETE SET NULL,
  unit_id                   UUID         REFERENCES public.hd_units(id) ON DELETE SET NULL,
  pm_type                   TEXT         NOT NULL,  -- dry | 3000hr | full_belts_trailer | full_belts_truck | 12month | 24month
  checklist_data            JSONB        NOT NULL DEFAULT '{}',
  safety_acknowledged       BOOLEAN      DEFAULT false,
  safety_acknowledged_at    TIMESTAMPTZ,
  safety_initials           TEXT,
  alarm_codes_found         TEXT,
  alarm_codes_cleared       TEXT,
  battery_cca               INTEGER,
  flagged_items             JSONB,
  signature_base64          TEXT,
  tech_name                 TEXT,
  completed_at              TIMESTAMPTZ,
  created_at                TIMESTAMPTZ  DEFAULT NOW()
);

ALTER TABLE public.hd_pm_checklists ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users manage own hd pm checklists"
  ON public.hd_pm_checklists
  FOR ALL USING (auth.uid() = user_id);

CREATE INDEX IF NOT EXISTS idx_hd_pm_checklists_user
  ON public.hd_pm_checklists (user_id);
CREATE INDEX IF NOT EXISTS idx_hd_pm_checklists_unit
  ON public.hd_pm_checklists (unit_id);

-- ── EPA 608 refrigerant log ────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.hd_epa_log (
  id                        UUID         DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id                   UUID         REFERENCES auth.users(id) ON DELETE CASCADE NOT NULL,
  unit_id                   UUID         REFERENCES public.hd_units(id) ON DELETE SET NULL,
  date                      DATE         NOT NULL,
  refrigerant_type          TEXT         NOT NULL,
  action                    TEXT         NOT NULL,  -- recovered | added | charged | leak_check
  pounds                    DECIMAL(10,2) NOT NULL,
  reason                    TEXT,
  tech_certification_number TEXT,
  created_at                TIMESTAMPTZ  DEFAULT NOW()
);

ALTER TABLE public.hd_epa_log ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users manage own hd epa log"
  ON public.hd_epa_log
  FOR ALL USING (auth.uid() = user_id);

CREATE INDEX IF NOT EXISTS idx_hd_epa_log_user
  ON public.hd_epa_log (user_id);
CREATE INDEX IF NOT EXISTS idx_hd_epa_log_date
  ON public.hd_epa_log (date DESC);
