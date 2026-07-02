-- Migration 066: optional expiry on cached diagnostics
-- Diagnostic cache entries (gemini_web_search, ai_web_search) keep expires_at
-- NULL — they never auto-expire; founder review handles quality. Parts Manager
-- entries (source = 'parts_manager') get a 12-month expiry so parts data is
-- periodically regenerated against current catalogs.

ALTER TABLE public.hd_cached_diagnostics
  ADD COLUMN IF NOT EXISTS expires_at TIMESTAMPTZ DEFAULT NULL;
