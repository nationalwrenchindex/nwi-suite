-- Outbound directory listings: NWI Suite -> nationalwrenchindex.com (Brilliant Directories)
-- Mirror image of 075_directory_webhook_events.sql, which logs the inbound direction.

-- BD wants structured city/state. Onboarding previously captured location only
-- as the free-text profiles.service_area_description.
ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS city  TEXT,
  ADD COLUMN IF NOT EXISTS state TEXT;

CREATE TABLE IF NOT EXISTS public.directory_listings (
  id            UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  profile_id    UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  bd_user_id    TEXT,
  status        TEXT NOT NULL CHECK (status IN ('created', 'failed', 'skipped')),
  skip_reason   TEXT,
  error_message TEXT,
  request_payload  JSONB,
  response_body    TEXT,
  created_at    TIMESTAMPTZ DEFAULT NOW()
);

-- One successful listing per mechanic — the guard against double-publishing if
-- onboarding is replayed. Partial so failed/skipped attempts stay appendable.
CREATE UNIQUE INDEX IF NOT EXISTS directory_listings_one_success_per_profile
  ON public.directory_listings (profile_id)
  WHERE status = 'created';

CREATE INDEX IF NOT EXISTS directory_listings_profile_idx
  ON public.directory_listings (profile_id, created_at DESC);

ALTER TABLE public.directory_listings ENABLE ROW LEVEL SECURITY;

-- Mechanics may read their own listing status; the service-role key used by the
-- onboarding route bypasses RLS for writes.
DROP POLICY IF EXISTS "Owner can read own listing" ON public.directory_listings;
CREATE POLICY "Owner can read own listing"
  ON public.directory_listings
  FOR SELECT TO authenticated
  USING (auth.uid() = profile_id);
