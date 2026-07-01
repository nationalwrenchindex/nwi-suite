-- Migration 065: cache review flag + Gemini grounding citations
-- Gemini 2.5 Flash is now the primary diagnostic AI. Hazardous electrical
-- content is flagged needs_review so a founder verifies it before it is trusted;
-- grounding source URLs are stored so the frontend can render source links.

ALTER TABLE public.hd_cached_diagnostics
  ADD COLUMN IF NOT EXISTS needs_review BOOLEAN DEFAULT false;

ALTER TABLE public.hd_cached_diagnostics
  ADD COLUMN IF NOT EXISTS reviewed_by UUID REFERENCES auth.users(id);

ALTER TABLE public.hd_cached_diagnostics
  ADD COLUMN IF NOT EXISTS reviewed_at TIMESTAMPTZ;

ALTER TABLE public.hd_cached_diagnostics
  ADD COLUMN IF NOT EXISTS citations TEXT[];

-- Fast lookup of the founder review queue.
CREATE INDEX IF NOT EXISTS idx_hd_cached_diagnostics_needs_review
  ON public.hd_cached_diagnostics(needs_review)
  WHERE needs_review = true;
