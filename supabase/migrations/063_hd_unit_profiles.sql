-- Migration 063: HD Unit Profiles + global BM/build-number map
-- Two separate tables with deliberately different trust models:
--   hd_unit_profiles — PRIVATE customer data, scoped to the owning user (RLS
--                      auth.uid() = user_id), exactly like every other table.
--   hd_bm_map        — GLOBAL shared knowledge. A BM/build number → unit model,
--                      refrigerant, and known parts. Contains NO customer data.
--                      Any authenticated user can READ it; writes happen
--                      server-side via the service-role client only.

-- ── Private per-user unit profiles ───────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.hd_unit_profiles (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id UUID NOT NULL REFERENCES auth.users(id),
  manufacturer TEXT NOT NULL CHECK (manufacturer IN ('TK','Carrier')),
  serial_number TEXT,
  bm_number TEXT,
  model_number TEXT,
  unit_model TEXT,
  refrigerant_type TEXT,
  engine_hours DECIMAL(10,2),
  notes TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE UNIQUE INDEX IF NOT EXISTS hd_unit_profiles_user_manuf_serial
  ON public.hd_unit_profiles (user_id, manufacturer, serial_number)
  WHERE serial_number IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_hd_unit_profiles_user
  ON public.hd_unit_profiles (user_id);

ALTER TABLE public.hd_unit_profiles ENABLE ROW LEVEL SECURITY;

CREATE POLICY "own unit profiles" ON public.hd_unit_profiles
  FOR ALL TO authenticated
  USING (user_id = auth.uid())
  WITH CHECK (user_id = auth.uid());

-- ── Global BM / build-number map (shared knowledge, no customer data) ─────────
CREATE TABLE IF NOT EXISTS public.hd_bm_map (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  manufacturer TEXT NOT NULL CHECK (manufacturer IN ('TK','Carrier')),
  bm_number TEXT NOT NULL,
  unit_model TEXT,
  refrigerant_type TEXT,
  known_parts TEXT,
  first_seen_by UUID REFERENCES auth.users(id),
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE (manufacturer, bm_number)
);

ALTER TABLE public.hd_bm_map ENABLE ROW LEVEL SECURITY;

CREATE POLICY "read bm map" ON public.hd_bm_map
  FOR SELECT TO authenticated
  USING (true);
-- Writes to hd_bm_map happen server-side via the service-role client only; no user write policy.
