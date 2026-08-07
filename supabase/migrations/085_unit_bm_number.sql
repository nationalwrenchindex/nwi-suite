-- Migration 085: BM number on fleet units.
ALTER TABLE public.hd_units
  ADD COLUMN IF NOT EXISTS bm_number TEXT;
