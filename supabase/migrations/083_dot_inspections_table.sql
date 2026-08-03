-- Migration 083: guarantee the hd_dot_inspections table + columns exist.
-- Originally created in 049. This idempotent migration ensures the table exists even
-- if 049 never ran (the likely cause of the "database error when signing"), and adds
-- free-text customer/unit context + invoice_id so a DOT inspection started from an
-- invoice/PM interval can carry that info without requiring a linked hd_unit.

CREATE TABLE IF NOT EXISTS public.hd_dot_inspections (
  id                    UUID        DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id               UUID        REFERENCES auth.users(id) ON DELETE CASCADE,
  unit_id               UUID        REFERENCES public.hd_units(id),
  fleet_account_id      UUID        REFERENCES public.hd_fleet_accounts(id),
  inspection_date       DATE        NOT NULL,
  inspector_name        TEXT,
  inspector_cert_number TEXT,
  odometer_hours        TEXT,
  location              TEXT,
  inspection_data       JSONB       NOT NULL,
  violations            JSONB,
  overall_result        TEXT        DEFAULT 'pass',
  signature_data        TEXT,
  locked                BOOLEAN     DEFAULT false,
  locked_at             TIMESTAMPTZ,
  inspection_id         TEXT UNIQUE,
  customer_name         TEXT,
  unit_manufacturer     TEXT,
  unit_model            TEXT,
  unit_serial           TEXT,
  invoice_id            UUID        REFERENCES public.hd_invoices(id) ON DELETE SET NULL,
  created_at            TIMESTAMPTZ DEFAULT NOW()
);

-- Backfill the newer context columns onto an existing table.
ALTER TABLE public.hd_dot_inspections
  ADD COLUMN IF NOT EXISTS customer_name     TEXT,
  ADD COLUMN IF NOT EXISTS unit_manufacturer TEXT,
  ADD COLUMN IF NOT EXISTS unit_model        TEXT,
  ADD COLUMN IF NOT EXISTS unit_serial       TEXT,
  ADD COLUMN IF NOT EXISTS invoice_id        UUID REFERENCES public.hd_invoices(id) ON DELETE SET NULL;

ALTER TABLE public.hd_dot_inspections ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "own dot inspections" ON public.hd_dot_inspections;
CREATE POLICY "own dot inspections" ON public.hd_dot_inspections
  FOR ALL TO authenticated
  USING (user_id = auth.uid())
  WITH CHECK (user_id = auth.uid());

CREATE INDEX IF NOT EXISTS idx_hd_dot_inspections_user ON public.hd_dot_inspections (user_id);
CREATE INDEX IF NOT EXISTS idx_hd_dot_inspections_unit ON public.hd_dot_inspections (unit_id);
