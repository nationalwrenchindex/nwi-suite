-- Directory auto-population agent: prospects discovered on Google Places.
--
-- One row per mobile-mechanic business we found and may invite to a free
-- nationalwrenchindex.com listing. The lifecycle is:
--   pending   -> found on Places, never messaged
--   contacted -> permission SMS sent
--   yes       -> replied YES (BD listing attempted; see bd_listing_created)
--   no        -> replied with a plain decline
--   optout    -> replied STOP/UNSUBSCRIBE/etc (also written to directory_optouts)
--
-- No RLS: internal admin-only table, written exclusively by the service-role
-- key from /api/directory-agent/* and read only by the founder admin page.

CREATE TABLE IF NOT EXISTS public.directory_prospects (
  id                 UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  -- E.164 (+1XXXXXXXXXX). Unique so a business listed under several Places
  -- entries is only ever messaged once.
  phone              TEXT NOT NULL UNIQUE,
  business_name      TEXT,
  rating             NUMERIC,
  google_place_id    TEXT UNIQUE,
  city               TEXT,
  state              TEXT,
  address            TEXT,
  website            TEXT,
  email              TEXT,
  status             TEXT NOT NULL DEFAULT 'pending'
                       CHECK (status IN ('pending', 'contacted', 'yes', 'no', 'optout')),
  contacted_at       TIMESTAMPTZ,
  responded_at       TIMESTAMPTZ,
  follow_up_sent_at  TIMESTAMPTZ,
  bd_listing_created BOOLEAN DEFAULT FALSE,
  bd_listing_url     TEXT,
  created_at         TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- The invite cron's hot path: highest-rated pending prospects first.
CREATE INDEX IF NOT EXISTS directory_prospects_pending_idx
  ON public.directory_prospects (status, rating DESC NULLS LAST);

-- The follow-up cron's hot path: contacted, never followed up, aged out.
CREATE INDEX IF NOT EXISTS directory_prospects_follow_up_idx
  ON public.directory_prospects (contacted_at)
  WHERE status = 'contacted' AND follow_up_sent_at IS NULL;

-- Admin table ordering.
CREATE INDEX IF NOT EXISTS directory_prospects_created_idx
  ON public.directory_prospects (created_at DESC);
