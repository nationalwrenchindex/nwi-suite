-- Permanent do-not-contact list for the HD directory agent. Mirror of
-- 088_directory_optouts.sql.
--
-- Kept separate from the LD list on purpose: the two agents text from different
-- numbers under different campaigns, so an opt-out from one is not automatically
-- an opt-out from the other. Separate from hd_directory_prospects for the same
-- reason as LD — the opt-out must survive the prospect row being deleted or the
-- business being rediscovered on a later Places sweep.
--
-- No RLS: internal admin-only table, service-role writes only.

CREATE TABLE IF NOT EXISTS public.hd_directory_optouts (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  -- E.164 (+1XXXXXXXXXX), matching hd_directory_prospects.phone.
  phone         TEXT NOT NULL UNIQUE,
  opted_out_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
