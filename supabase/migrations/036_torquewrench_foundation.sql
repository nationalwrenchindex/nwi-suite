-- TorqueWrench: automatic Google review collection
-- Bundled module (Full Suite, QuickWrench, Elite tiers)

CREATE TABLE IF NOT EXISTS public.torquewrench_settings (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE UNIQUE NOT NULL,
  is_enabled BOOLEAN DEFAULT true,
  google_place_id TEXT,
  google_review_url TEXT,
  business_name_override TEXT,
  send_delay_minutes INTEGER DEFAULT 10,
  service_recovery_enabled BOOLEAN DEFAULT true,
  service_recovery_phone TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS public.torquewrench_reviews (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE NOT NULL,
  job_id UUID REFERENCES public.jobs(id) ON DELETE SET NULL,
  customer_name TEXT,
  customer_phone TEXT,
  service_type TEXT,
  status TEXT DEFAULT 'pending',
  rating INTEGER,
  review_left BOOLEAN DEFAULT false,
  service_recovery_triggered BOOLEAN DEFAULT false,
  send_attempted_at TIMESTAMPTZ,
  rated_at TIMESTAMPTZ,
  clicked_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS torquewrench_addon_active BOOLEAN DEFAULT false NOT NULL;

ALTER TABLE public.torquewrench_settings ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.torquewrench_reviews ENABLE ROW LEVEL SECURITY;

CREATE POLICY "torquewrench_settings own" ON public.torquewrench_settings
  FOR ALL USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);

CREATE POLICY "torquewrench_reviews own" ON public.torquewrench_reviews
  FOR ALL USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);

CREATE INDEX torquewrench_reviews_status_pending
  ON public.torquewrench_reviews(status, send_attempted_at)
  WHERE status = 'pending';
