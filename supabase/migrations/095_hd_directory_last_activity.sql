-- Sort key for the HD tab of /admin/directory-agent.
--
-- The dashboard wants "most recently acted on" ordering:
--   COALESCE(follow_up_sent_at, contacted_at, created_at) DESC
--
-- PostgREST cannot express COALESCE in an order clause, and chaining
-- .order(follow_up_sent_at).order(contacted_at).order(created_at) is NOT
-- equivalent — that buckets every followed-up row ahead of every merely
-- contacted one regardless of date, so a follow-up from January would outrank
-- a first text from June. A stored generated column gives the real expression
-- and can be indexed.
--
-- HD only. The LD tab keeps created_at ordering, which is what it has always
-- had and what its much smaller table reads well with.

ALTER TABLE public.hd_directory_prospects
  ADD COLUMN IF NOT EXISTS last_activity_at TIMESTAMPTZ
  GENERATED ALWAYS AS (COALESCE(follow_up_sent_at, contacted_at, created_at)) STORED;

CREATE INDEX IF NOT EXISTS hd_directory_prospects_activity_idx
  ON public.hd_directory_prospects (last_activity_at DESC);
