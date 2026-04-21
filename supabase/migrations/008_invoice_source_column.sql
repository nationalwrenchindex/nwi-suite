-- QuickWrench → Financials integration columns
ALTER TABLE public.invoices ADD COLUMN IF NOT EXISTS source       TEXT DEFAULT 'manual';
ALTER TABLE public.invoices ADD COLUMN IF NOT EXISTS job_category TEXT;
ALTER TABLE public.invoices ADD COLUMN IF NOT EXISTS job_subtype  TEXT;
ALTER TABLE public.invoices ADD COLUMN IF NOT EXISTS vehicle_id   UUID REFERENCES public.vehicles(id) ON DELETE SET NULL;

-- Index for source-based filtering
CREATE INDEX IF NOT EXISTS idx_invoices_source ON public.invoices(user_id, source);
