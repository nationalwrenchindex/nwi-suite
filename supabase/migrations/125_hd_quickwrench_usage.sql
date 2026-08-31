-- Migration 125: per-request usage log for the AI features inside HD QuickWrench.
--
-- QuickWrench now has several routes that each spend real money on a model call —
-- the reefer and truck diagnostics, the electrical branch, and as of this migration
-- the trailer ABS diagnostic. None of them record that they ran. The consequence is
-- that the only visibility into what the AI costs is the provider's monthly bill,
-- which arrives after the fact, is a single number, and cannot answer the two
-- questions that actually matter: which feature is spending the money, and is any one
-- account driving it. This table answers both.
--
-- It is deliberately a flat append-only log keyed by `feature` rather than a table per
-- route. Every AI route in this product writes the same five facts — who, which
-- feature, which model, how long it took, did it work — and splitting that into one
-- table per feature would mean a migration and a new query every time a feature is
-- added, to store a shape that never changes. `feature` is a plain TEXT column with no
-- CHECK constraint for the same reason 124 left `system` unconstrained: the constraint
-- would need editing on every new feature, and the writer is server-side route code,
-- not user input, so the real gate is the code.
--
-- FAILURES ARE LOGGED TOO, and that is the point of the `success` and `error` columns.
-- A log that only records the happy path understates cost (a call that times out at 55
-- seconds was still paid for) and hides exactly the pattern worth catching early — one
-- account retrying a request that fails every time.

CREATE TABLE IF NOT EXISTS public.hd_quickwrench_usage (
  id                UUID        DEFAULT gen_random_uuid() PRIMARY KEY,
  -- ON DELETE CASCADE rather than SET NULL. Usage rows are per-account telemetry whose
  -- only readers are the owning user (via the policy below) and the founder via the
  -- service role. Under owner-scoped RLS a row whose user_id was nulled out is readable
  -- by nobody and attributable to nobody, so preserving it would keep a cost figure
  -- that can never be traced back to what spent it. It goes with the account.
  user_id           UUID        NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  -- Which AI feature spent the money: 'trailer_abs_diagnostic', 'reefer_diagnostic',
  -- 'truck_diagnostic', 'electrical'. Indexed — "what is this feature costing" is the
  -- query this table exists to serve.
  feature           TEXT        NOT NULL,
  -- The model id actually called, e.g. 'gemini-3.6-flash'. NULL is meaningful and is
  -- not missing data: it records a request that was answered WITHOUT calling a model at
  -- all — a validation rejection, a rate-limit block, an unconfigured API key, or a
  -- clarification the route could return on its own. Those rows cost nothing but still
  -- belong here, because request volume and model spend are different questions and
  -- dividing one by the other is how the cost per useful answer gets measured.
  model             TEXT,
  -- Nullable because the shared Gemini client (src/lib/gemini/client.ts) returns text
  -- and grounding citations only — it does not surface the SDK's usageMetadata. Rather
  -- than write an estimate into a cost table and have it read later as a measurement,
  -- the ABS route leaves these NULL and relies on latency_ms and request counts. These
  -- columns exist now so that whenever the shared client starts returning token counts,
  -- the routes can begin filling them in without a schema change.
  prompt_tokens     INTEGER,
  completion_tokens INTEGER,
  -- Wall-clock milliseconds for the whole request as the route measured it. This is the
  -- practical stand-in for token counts today and it is also the timeout early-warning:
  -- the Gemini client gives up at 55s and Vercel kills the function at 60s, so a rising
  -- p95 here is the signal that a prompt has grown too long, before it starts failing.
  latency_ms        INTEGER,
  -- Whether the route produced its intended answer. NOT the HTTP status: the AI routes
  -- deliberately answer a model outage with a 200 and a documented fallback rather than
  -- a 500, so status code alone cannot tell a real diagnostic from a graceful apology.
  -- A fallback is success = false with the reason in `error`.
  success           BOOLEAN     NOT NULL DEFAULT false,
  -- Short reason string, never a raw stack trace or a user's prompt: this table is read
  -- for cost analysis and does not need the payload. Values are route-authored tags
  -- such as 'gemini_unconfigured', 'gemini_error', 'unparseable_response'.
  error             TEXT,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Idempotent for a database where an earlier partial run already created the table:
-- CREATE TABLE IF NOT EXISTS above would silently leave it in its old shape.
ALTER TABLE public.hd_quickwrench_usage
  ADD COLUMN IF NOT EXISTS model             TEXT,
  ADD COLUMN IF NOT EXISTS prompt_tokens     INTEGER,
  ADD COLUMN IF NOT EXISTS completion_tokens INTEGER,
  ADD COLUMN IF NOT EXISTS latency_ms        INTEGER,
  ADD COLUMN IF NOT EXISTS error             TEXT;

ALTER TABLE public.hd_quickwrench_usage ENABLE ROW LEVEL SECURITY;

-- Owner-scoped SELECT and nothing else, on purpose.
--
-- INSERTS ARE PERFORMED BY THE SERVICE-ROLE CLIENT FROM THE ROUTE
-- (src/lib/supabase/service.ts, used by src/app/api/hd/trailer-abs-diagnostic/route.ts),
-- which bypasses RLS entirely. So no INSERT, UPDATE, or DELETE policy is granted here
-- and none should be added: this is a billing and abuse record, and the account it
-- describes must not be able to write rows into it, edit a latency figure, or delete
-- the evidence of a request it made. A user may read their own usage — that is what a
-- future "your AI usage this month" panel needs — and may do nothing else to it.
DROP POLICY IF EXISTS "own quickwrench usage" ON public.hd_quickwrench_usage;
CREATE POLICY "own quickwrench usage"
  ON public.hd_quickwrench_usage
  FOR SELECT TO authenticated
  USING (auth.uid() = user_id);

-- "This user's recent requests, newest first" — the per-account query behind both the
-- usage panel and any abuse check. DESC is in the index so the ordering comes off the
-- index instead of sorting a growing append-only table on every read.
CREATE INDEX IF NOT EXISTS idx_hd_quickwrench_usage_user_created
  ON public.hd_quickwrench_usage (user_id, created_at DESC);

-- "What is this one feature costing" — the aggregate query, which does not filter by
-- user and so cannot use the composite index above.
CREATE INDEX IF NOT EXISTS idx_hd_quickwrench_usage_feature
  ON public.hd_quickwrench_usage (feature);
