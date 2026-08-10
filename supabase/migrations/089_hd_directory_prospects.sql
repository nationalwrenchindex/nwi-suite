-- HD directory auto-population agent: heavy-duty service providers found on
-- Google Places. Mirror of 087_directory_prospects.sql (the light-duty agent)
-- with one addition: service_category, because HD outreach copy and the BD
-- profession field both depend on what kind of provider this is.
--
-- Status lifecycle is identical to LD:
--   pending -> contacted -> yes | no | optout
--
-- No RLS: internal admin-only table, written exclusively by the service-role
-- key from /api/hd-directory-agent/* and read only by the founder admin page.

CREATE TABLE IF NOT EXISTS public.hd_directory_prospects (
  id                 UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  -- E.164 (+1XXXXXXXXXX). Unique so a provider listed under several Places
  -- entries — or found by several search terms — is only messaged once.
  phone              TEXT NOT NULL UNIQUE,
  business_name      TEXT,
  rating             NUMERIC,
  google_place_id    TEXT UNIQUE,
  city               TEXT,
  state              TEXT,
  address            TEXT,
  website            TEXT,
  email              TEXT,
  -- Derived from the search term that surfaced the business. trailer, glass and
  -- locksmith have no automated search terms yet; they are allowed so entries
  -- can be recategorized by hand without a migration.
  service_category   TEXT
                       CHECK (service_category IN (
                         'truck', 'trailer', 'reefer', 'tire', 'fuel',
                         'towing', 'washout', 'glass', 'locksmith', 'shop'
                       )),
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
CREATE INDEX IF NOT EXISTS hd_directory_prospects_pending_idx
  ON public.hd_directory_prospects (status, rating DESC NULLS LAST);

-- The follow-up cron's hot path: contacted, never followed up, aged out.
CREATE INDEX IF NOT EXISTS hd_directory_prospects_follow_up_idx
  ON public.hd_directory_prospects (contacted_at)
  WHERE status = 'contacted' AND follow_up_sent_at IS NULL;

-- Admin table ordering and the dashboard's per-category breakdown.
CREATE INDEX IF NOT EXISTS hd_directory_prospects_created_idx
  ON public.hd_directory_prospects (created_at DESC);

CREATE INDEX IF NOT EXISTS hd_directory_prospects_category_idx
  ON public.hd_directory_prospects (service_category);
