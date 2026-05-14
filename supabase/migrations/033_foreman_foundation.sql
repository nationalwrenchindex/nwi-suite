-- Foreman: AI virtual receptionist add-on — Session 1 foundation

-- Track the add-on on profiles (separate from base subscription tier)
ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS foreman_addon_active           BOOLEAN DEFAULT false NOT NULL,
  ADD COLUMN IF NOT EXISTS foreman_stripe_subscription_id TEXT;

-- One settings row per Foreman subscriber
CREATE TABLE IF NOT EXISTS public.foreman_settings (
  id                  UUID        DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id             UUID        REFERENCES auth.users(id) ON DELETE CASCADE UNIQUE NOT NULL,
  is_enabled          BOOLEAN     DEFAULT false,
  phone_number        TEXT,
  vapi_assistant_id   TEXT,
  greeting_name       TEXT,
  business_name       TEXT,
  mechanic_first_name TEXT,
  mechanic_phone      TEXT,
  working_hours_start TIME        DEFAULT '08:00',
  working_hours_end   TIME        DEFAULT '18:00',
  working_days        TEXT[]      DEFAULT ARRAY['Mon','Tue','Wed','Thu','Fri'],
  after_hours_message TEXT        DEFAULT 'Sorry we missed you — please call back during business hours.',
  created_at          TIMESTAMPTZ DEFAULT NOW(),
  updated_at          TIMESTAMPTZ DEFAULT NOW()
);

-- Call history — populated by Vapi webhook in Session 2
CREATE TABLE IF NOT EXISTS public.foreman_calls (
  id                    UUID        DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id               UUID        REFERENCES auth.users(id) ON DELETE CASCADE NOT NULL,
  caller_name           TEXT,
  caller_phone          TEXT,
  call_duration_seconds INTEGER,
  call_summary          TEXT,
  appointment_booked    BOOLEAN     DEFAULT false,
  job_id                UUID,
  vapi_call_id          TEXT,
  recording_url         TEXT,
  status                TEXT        DEFAULT 'completed',
  created_at            TIMESTAMPTZ DEFAULT NOW()
);

ALTER TABLE public.foreman_settings ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.foreman_calls    ENABLE ROW LEVEL SECURITY;

CREATE POLICY "foreman_settings own" ON public.foreman_settings
  FOR ALL USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "foreman_calls own" ON public.foreman_calls
  FOR ALL USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

CREATE INDEX IF NOT EXISTS foreman_calls_user_id
  ON public.foreman_calls(user_id, created_at DESC);
