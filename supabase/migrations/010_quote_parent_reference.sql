-- Phase 1.5: Add parent_quote_id for clone-to-new-version traceability
ALTER TABLE public.quotes
  ADD COLUMN IF NOT EXISTS parent_quote_id UUID REFERENCES public.quotes(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_quotes_parent ON public.quotes(parent_quote_id);
