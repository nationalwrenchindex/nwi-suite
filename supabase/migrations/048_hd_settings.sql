-- HD settings columns on profiles
ALTER TABLE profiles
  ADD COLUMN IF NOT EXISTS hd_tech_name       TEXT,
  ADD COLUMN IF NOT EXISTS hd_epa_cert_number TEXT;

-- Scheduler timing columns on hd_work_orders
ALTER TABLE hd_work_orders
  ADD COLUMN IF NOT EXISTS scheduled_at   TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS on_the_way_at  TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS arrived_at     TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS labor_hours    NUMERIC,
  ADD COLUMN IF NOT EXISTS labor_minutes  INTEGER,
  ADD COLUMN IF NOT EXISTS unit_id        UUID REFERENCES hd_units(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS fleet_account_id UUID REFERENCES hd_fleet_accounts(id) ON DELETE SET NULL;
