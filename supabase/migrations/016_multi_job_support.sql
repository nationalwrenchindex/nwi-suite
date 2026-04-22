-- Phase 8: Multi-Job support
-- Adds jobs JSONB column to quotes and invoices.
-- Backwards compatible: empty array means legacy single-job record using line_items.

ALTER TABLE public.quotes
  ADD COLUMN IF NOT EXISTS jobs JSONB DEFAULT '[]'::jsonb;

ALTER TABLE public.invoices
  ADD COLUMN IF NOT EXISTS jobs JSONB DEFAULT '[]'::jsonb;

COMMENT ON COLUMN public.quotes.jobs IS
  'Multi-job array. Each element: {id, category, subtype, labor_hours, labor_rate, parts: [{name, qty, unit_cost, unit_price}], notes}. Empty = legacy single-job record using line_items.';

COMMENT ON COLUMN public.invoices.jobs IS
  'Multi-job array copied verbatim from source quote jobs column. Same structure as quotes.jobs.';
