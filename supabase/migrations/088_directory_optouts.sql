-- Permanent do-not-contact list for the directory auto-population agent.
--
-- Separate from directory_prospects on purpose: an opt-out must survive the
-- prospect row being deleted or re-discovered on a later Places sweep. The
-- search route checks this table before inserting anything new, so a STOP is
-- honored forever regardless of what Google returns next Monday.
--
-- No RLS: internal admin-only table, service-role writes only.

CREATE TABLE IF NOT EXISTS public.directory_optouts (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  -- E.164 (+1XXXXXXXXXX), matching directory_prospects.phone.
  phone         TEXT NOT NULL UNIQUE,
  opted_out_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
