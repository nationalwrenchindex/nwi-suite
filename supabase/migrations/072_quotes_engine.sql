-- Migration 072: store the vehicle engine on QuickWrench quotes so reopening a
-- quote restores full vehicle context (engine was previously lost on reopen).

ALTER TABLE public.quotes
  ADD COLUMN IF NOT EXISTS vehicle_engine TEXT;
