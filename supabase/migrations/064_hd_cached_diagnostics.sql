-- Migration 064: HD cached diagnostics
-- Response cache for QuickWrench reefer + truck-engine diagnostics. A cache hit
-- returns a previously generated AI/web-search answer with no new model call.
-- Contains NO private customer data — keyed on manufacturer/model/code only.
-- Any authenticated user may READ; all WRITES go through the service-role
-- client server-side (no user write policy).

CREATE TABLE IF NOT EXISTS public.hd_cached_diagnostics (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  cache_key TEXT NOT NULL UNIQUE,
  manufacturer TEXT, alarm_code TEXT, unit_model TEXT,
  engine_brand TEXT, engine_model TEXT, spn TEXT, fmi TEXT,
  result_html TEXT NOT NULL,
  source TEXT DEFAULT 'ai_web_search',
  search_count INTEGER DEFAULT 1,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  last_accessed TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_hd_cached_diagnostics_key ON public.hd_cached_diagnostics(cache_key);

ALTER TABLE public.hd_cached_diagnostics ENABLE ROW LEVEL SECURITY;

CREATE POLICY "read cache" ON public.hd_cached_diagnostics
  FOR SELECT TO authenticated
  USING (true);
-- All cache WRITES use createServiceClient() (@/lib/supabase/service) server-side. No user write policy.

-- Atomic hit counter: a single UPDATE (search_count = search_count + 1), not a
-- read-then-write. Called via the service-role client on every cache hit.
CREATE OR REPLACE FUNCTION public.increment_hd_cache_hit(p_cache_key TEXT)
RETURNS void
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  UPDATE public.hd_cached_diagnostics
     SET search_count  = search_count + 1,
         last_accessed = NOW()
   WHERE cache_key = p_cache_key;
$$;
