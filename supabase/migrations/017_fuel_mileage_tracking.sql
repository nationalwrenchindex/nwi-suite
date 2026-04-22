-- Phase 7: Fuel / Mileage Expense Calculator
-- Adds vehicle MPG + fuel-type to profiles and fuel tracking columns to invoices.

-- ── profiles ────────────────────────────────────────────────────────────────

ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS average_mpg   NUMERIC(5,2),
  ADD COLUMN IF NOT EXISTS fuel_type     TEXT DEFAULT 'gasoline';

COMMENT ON COLUMN public.profiles.average_mpg IS
  'Tech''s average MPG for their work vehicle (van or truck). Used for per-job fuel cost calculation.';

COMMENT ON COLUMN public.profiles.fuel_type IS
  'Fuel type for the tech''s work vehicle. Values: gasoline, diesel. Affects which EIA price is fetched.';

-- ── invoices ────────────────────────────────────────────────────────────────

ALTER TABLE public.invoices
  ADD COLUMN IF NOT EXISTS miles_driven          NUMERIC(6,1),
  ADD COLUMN IF NOT EXISTS fuel_price_per_gallon NUMERIC(5,3),
  ADD COLUMN IF NOT EXISTS fuel_cost             NUMERIC(8,2) DEFAULT 0,
  ADD COLUMN IF NOT EXISTS fuel_posted           BOOLEAN      DEFAULT false;

COMMENT ON COLUMN public.invoices.miles_driven IS
  'One-way miles driven to this job, entered manually at Mark as Paid.';
COMMENT ON COLUMN public.invoices.fuel_price_per_gallon IS
  'Fuel price per gallon (EIA API or fallback) at the time the invoice was marked paid.';
COMMENT ON COLUMN public.invoices.fuel_cost IS
  'Calculated fuel cost: (miles_driven / average_mpg) × fuel_price_per_gallon. 0 if not tracked.';
COMMENT ON COLUMN public.invoices.fuel_posted IS
  'True once a fuel expense has been auto-created for this invoice.';

CREATE INDEX IF NOT EXISTS idx_invoices_fuel_posted
  ON public.invoices(user_id, fuel_posted);
