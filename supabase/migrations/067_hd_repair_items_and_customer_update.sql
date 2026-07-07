-- Migration 067: HD repair items catalog + customer company_name

-- Add company_name to customers table
ALTER TABLE public.customers
  ADD COLUMN IF NOT EXISTS company_name TEXT;

-- HD repair items catalog
CREATE TABLE IF NOT EXISTS public.hd_repair_items (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id UUID REFERENCES auth.users(id),
  description TEXT NOT NULL,
  category TEXT,
  applies_to TEXT CHECK (applies_to IN ('truck','trailer','both')) DEFAULT 'both',
  mobile_hours DECIMAL(4,2),
  shop_hours DECIMAL(4,2),
  requires_refrigeration BOOLEAN DEFAULT false,
  refrigeration_service TEXT CHECK (refrigeration_service IN ('A','B','C','D')),
  refrigeration_hours DECIMAL(4,2),
  notes TEXT,
  is_master BOOLEAN DEFAULT false,
  active BOOLEAN DEFAULT true,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_hd_repair_items_user
  ON public.hd_repair_items(user_id);
CREATE INDEX IF NOT EXISTS idx_hd_repair_items_master
  ON public.hd_repair_items(is_master) WHERE is_master = true;

ALTER TABLE public.hd_repair_items ENABLE ROW LEVEL SECURITY;

-- Master items visible to all authenticated users
CREATE POLICY "read master repair items" ON public.hd_repair_items
  FOR SELECT TO authenticated
  USING (is_master = true OR user_id = auth.uid());

-- Users manage their own custom items
CREATE POLICY "manage own repair items" ON public.hd_repair_items
  FOR ALL TO authenticated
  USING (user_id = auth.uid())
  WITH CHECK (user_id = auth.uid());

-- Master items inserted server-side via service role only
-- (no user insert policy on is_master = true rows)
