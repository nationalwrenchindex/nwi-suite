-- Migration 035: Replace partial unique index on foreman_calls.vapi_call_id
-- with a full unique constraint so PostgREST upsert ON CONFLICT works.
--
-- The partial index from migration 034 (WHERE vapi_call_id IS NOT NULL)
-- cannot be used by Supabase's .upsert({ onConflict: 'vapi_call_id' })
-- because PostgREST does not support specifying partial index predicates
-- in the ON CONFLICT clause. We need a proper unique constraint instead.

-- 1. Remove null rows that would be ambiguous under the new constraint
--    (null = null is false in SQL so nulls are technically allowed, but
--    clean up any orphan rows without a call ID while we're here)
DELETE FROM public.foreman_calls WHERE vapi_call_id IS NULL;

-- 2. Drop the old partial unique index
DROP INDEX IF EXISTS public.foreman_calls_vapi_call_id_idx;

-- 3. Add a full unique constraint — this is what PostgREST needs
ALTER TABLE public.foreman_calls
  ADD CONSTRAINT foreman_calls_vapi_call_id_key UNIQUE (vapi_call_id);
