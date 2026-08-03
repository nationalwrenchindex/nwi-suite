-- Migration 081: guarantee the hd_units (fleet units) table + RLS exist.
-- hd_units is originally created in migration 047; this migration is idempotent and
-- ensures the table exists even if 047 was never applied, so "Save Unit" works.
--
-- DEVIATION (documented): the ticket proposed column names current_hours / refrigerant /
-- active, but the running app reads & writes total_hours, refrigerant_type and status
-- (fleet-units page, PM checklist, scheduler). Renaming those would break live code, so
-- this keeps the existing 047 column names and adds `active` + `updated_at` as extras.

CREATE TABLE IF NOT EXISTS public.hd_units (
  id                   UUID          DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id              UUID          NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  fleet_account_id     UUID          REFERENCES public.hd_fleet_accounts(id) ON DELETE SET NULL,
  unit_number          TEXT          NOT NULL,
  truck_trailer_number TEXT,
  manufacturer         TEXT          NOT NULL,
  model                TEXT,
  serial_number        TEXT,
  year                 INTEGER,
  unit_type            TEXT          DEFAULT 'trailer',
  refrigerant_type     TEXT          DEFAULT 'R-404A',
  total_hours          DECIMAL(10,2) DEFAULT 0,
  engine_hours         DECIMAL(10,2) DEFAULT 0,
  electric_hours       DECIMAL(10,2) DEFAULT 0,
  last_pm_date         DATE,
  last_pm_hours        DECIMAL(10,2),
  last_pm_type         TEXT,
  next_pm_due_hours    DECIMAL(10,2),
  notes                TEXT,
  status               TEXT          DEFAULT 'active',
  active               BOOLEAN       DEFAULT true,
  created_at           TIMESTAMPTZ   DEFAULT NOW(),
  updated_at           TIMESTAMPTZ   DEFAULT NOW()
);

-- Converge a partially-migrated table toward the full column set the app expects.
ALTER TABLE public.hd_units
  ADD COLUMN IF NOT EXISTS fleet_account_id  UUID REFERENCES public.hd_fleet_accounts(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS refrigerant_type  TEXT DEFAULT 'R-404A',
  ADD COLUMN IF NOT EXISTS total_hours       DECIMAL(10,2) DEFAULT 0,
  ADD COLUMN IF NOT EXISTS next_pm_due_hours DECIMAL(10,2),
  ADD COLUMN IF NOT EXISTS status            TEXT DEFAULT 'active',
  ADD COLUMN IF NOT EXISTS active            BOOLEAN DEFAULT true,
  ADD COLUMN IF NOT EXISTS updated_at        TIMESTAMPTZ DEFAULT NOW();

ALTER TABLE public.hd_units ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "own units" ON public.hd_units;
CREATE POLICY "own units" ON public.hd_units
  FOR ALL TO authenticated
  USING (user_id = auth.uid())
  WITH CHECK (user_id = auth.uid());

CREATE INDEX IF NOT EXISTS idx_hd_units_user          ON public.hd_units (user_id);
CREATE INDEX IF NOT EXISTS idx_hd_units_fleet_account ON public.hd_units (fleet_account_id);
CREATE INDEX IF NOT EXISTS idx_hd_units_status        ON public.hd_units (status);
