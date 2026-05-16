-- Grace period tracking: when a Foreman subscription is cancelled, the Twilio
-- and Vapi phone numbers are retained for FOREMAN_GRACE_PERIOD_DAYS (30) before
-- release. The nightly cron job processes rows with release_scheduled_for <= NOW().

CREATE TABLE IF NOT EXISTS public.foreman_grace_period (
  id                    UUID        DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id               UUID        REFERENCES auth.users(id) ON DELETE CASCADE,
  phone_number          TEXT        NOT NULL,
  vapi_phone_number_id  TEXT,
  cancellation_date     TIMESTAMPTZ DEFAULT NOW(),
  release_scheduled_for TIMESTAMPTZ NOT NULL,
  released              BOOLEAN     DEFAULT false
);

CREATE INDEX foreman_grace_period_user    ON public.foreman_grace_period(user_id);
CREATE INDEX foreman_grace_period_release ON public.foreman_grace_period(release_scheduled_for)
  WHERE released = false;

ALTER TABLE public.foreman_grace_period ENABLE ROW LEVEL SECURITY;

-- Only service role (cron job) can access this table.
CREATE POLICY "foreman_grace_period admin only" ON public.foreman_grace_period
  FOR ALL USING (auth.uid() = '4a8c046f-7db3-42bb-8422-fd47efb7678c'::uuid);
