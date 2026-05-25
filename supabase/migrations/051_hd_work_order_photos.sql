CREATE TABLE IF NOT EXISTS public.hd_work_order_photos (
  id            UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id       UUID REFERENCES auth.users(id) ON DELETE CASCADE,
  work_order_id UUID REFERENCES public.hd_work_orders(id) ON DELETE CASCADE,
  category      TEXT NOT NULL,
  file_url      TEXT NOT NULL,
  file_name     TEXT,
  caption       TEXT,
  taken_at      TIMESTAMPTZ DEFAULT NOW(),
  created_at    TIMESTAMPTZ DEFAULT NOW()
);

ALTER TABLE public.hd_work_order_photos ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users manage own work order photos"
  ON public.hd_work_order_photos FOR ALL
  USING (auth.uid() = user_id);

CREATE INDEX IF NOT EXISTS idx_hd_wo_photos_work_order
  ON public.hd_work_order_photos (work_order_id);

-- NOTE: Create storage bucket "hd-work-order-photos" in Supabase dashboard
-- Storage > New Bucket > Name: hd-work-order-photos > Private (not public)
-- Add RLS policy: users can read/write objects where owner = auth.uid()::text
