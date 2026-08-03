-- Migration 079: ad-hoc job booking fields on hd_work_orders.
-- The scheduler "+ New Job" flow lets a tech book a job by free-typing the customer
-- and unit (not only by linking an existing hd_unit / fleet_account), so store those
-- denormalized fields directly on the work order. scheduled_at already exists (048).

ALTER TABLE public.hd_work_orders
  ADD COLUMN IF NOT EXISTS customer_name            TEXT,
  ADD COLUMN IF NOT EXISTS customer_phone           TEXT,
  ADD COLUMN IF NOT EXISTS unit_manufacturer        TEXT,
  ADD COLUMN IF NOT EXISTS unit_model               TEXT,
  ADD COLUMN IF NOT EXISTS unit_serial              TEXT,
  ADD COLUMN IF NOT EXISTS estimated_duration_hours DECIMAL(10,2);
