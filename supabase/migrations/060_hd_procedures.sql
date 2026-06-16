-- Migration 060: HD Procedures Table + safety_type column for alarm codes
-- Standalone procedure cards for field reference (pump down, capacity test, etc.)

-- Add safety_type to alarm codes table for lockout procedure routing
ALTER TABLE public.hd_alarm_codes
  ADD COLUMN IF NOT EXISTS safety_type TEXT;

-- ── HD Procedures ─────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.hd_procedures (
  id             UUID         DEFAULT gen_random_uuid() PRIMARY KEY,
  procedure_name TEXT         NOT NULL,
  category       TEXT         NOT NULL,
  applies_to     TEXT         NOT NULL,
  safety_warnings TEXT,
  prerequisites  TEXT,
  steps          TEXT         NOT NULL,
  notes          TEXT,
  labor_time     DECIMAL(4,2),
  verified       BOOLEAN      DEFAULT true,
  created_at     TIMESTAMPTZ  DEFAULT NOW()
);

ALTER TABLE public.hd_procedures ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Public read procedures"         ON public.hd_procedures FOR SELECT TO public        USING (true);
CREATE POLICY "Authenticated manage procedures" ON public.hd_procedures FOR ALL    TO authenticated USING (true);

CREATE INDEX IF NOT EXISTS idx_hd_procedures_category ON public.hd_procedures(category);
