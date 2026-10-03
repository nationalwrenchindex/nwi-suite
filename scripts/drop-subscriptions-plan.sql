-- ╔═══════════════════════════════════════════════════════════════════════════╗
-- ║ OPTIONAL — drop the legacy subscriptions.plan column                       ║
-- ╚═══════════════════════════════════════════════════════════════════════════╝
--
-- BIG RUN THREE item 8.4. NOT RUN BY ME. This DROPS A COLUMN, which cannot be
-- undone without a restore.
--
-- ── WHAT THE GREP PROVED ────────────────────────────────────────────────────
--
-- Nothing in the application reads or writes it:
--
--   * `plan` is NOT a field on the Subscription interface (src/lib/subscription.ts),
--     which declares tier, modules, status, is_comped, vertical and the Stripe ids.
--   * No property access of the form sub.plan / subscription.plan / data.plan
--     exists anywhere in src/.
--   * The Stripe webhook never writes it. upsertSubscription() writes whatever
--     payload it is handed, and no caller puts `plan` in one.
--   * Two sites do `select('*')` on subscriptions, so they RECEIVE the column —
--     but neither reads it off the result.
--   * The `plan` that signup sends goes into supabase.auth.signUp options.data,
--     which lands in auth.users.raw_user_meta_data, NOT in this column. Every
--     other `plan` in the codebase is a URL query parameter.
--
-- ── WHAT IS IN IT ───────────────────────────────────────────────────────────
--
--   plan='free'   x4     while tier = hd_elite / NULL / full_suite_plus / NULL
--   plan='elite'  x1     while tier = elite
--
-- So it disagrees with `tier` on four of five rows and `tier` is the one the code
-- gates on. It is not just unused, it is misleading.
--
-- ── RUN STEP 1 FIRST ────────────────────────────────────────────────────────
--
-- I cannot inspect triggers, views, policies or generated columns through
-- PostgREST, so the grep is evidence about the APPLICATION and not about the
-- DATABASE. Step 1 closes that gap. Do not skip it.

-- ─────────────────────────────────────────────────────────────────────────────
-- STEP 1 — does anything IN THE DATABASE depend on it?
-- Expect zero rows from all four. If any returns a row, STOP and read it.
-- ─────────────────────────────────────────────────────────────────────────────

-- Views and matviews referencing it
SELECT 'view' AS kind, schemaname, viewname AS name
FROM   pg_views
WHERE  definition ILIKE '%plan%' AND definition ILIKE '%subscriptions%'
UNION ALL
SELECT 'matview', schemaname, matviewname
FROM   pg_matviews
WHERE  definition ILIKE '%plan%' AND definition ILIKE '%subscriptions%';

-- Trigger functions referencing it
SELECT 'trigger_fn' AS kind, p.proname AS name
FROM   pg_proc p
JOIN   pg_namespace n ON n.oid = p.pronamespace
WHERE  n.nspname NOT IN ('pg_catalog', 'information_schema')
  AND  pg_get_functiondef(p.oid) ILIKE '%subscriptions%'
  AND  pg_get_functiondef(p.oid) ILIKE '%plan%';

-- RLS policies referencing it
SELECT 'policy' AS kind, policyname AS name, qual, with_check
FROM   pg_policies
WHERE  tablename = 'subscriptions'
  AND  (COALESCE(qual, '') ILIKE '%plan%' OR COALESCE(with_check, '') ILIKE '%plan%');

-- Indexes, constraints and generated columns on it
SELECT 'index' AS kind, indexname AS name, indexdef
FROM   pg_indexes
WHERE  tablename = 'subscriptions' AND indexdef ILIKE '%plan%';

-- ─────────────────────────────────────────────────────────────────────────────
-- STEP 2 — keep a copy of what is being thrown away
-- Run this and SAVE THE OUTPUT before step 3. It is five rows.
-- ─────────────────────────────────────────────────────────────────────────────
SELECT user_id, plan, tier, vertical, status, modules
FROM   public.subscriptions
ORDER  BY user_id;

-- ─────────────────────────────────────────────────────────────────────────────
-- STEP 3 — the drop
-- Only after step 1 came back empty and step 2's output is saved.
-- ─────────────────────────────────────────────────────────────────────────────
BEGIN;

ALTER TABLE public.subscriptions DROP COLUMN IF EXISTS plan;

-- Confirm: `plan` should be gone and `tier` should still be there.
SELECT column_name
FROM   information_schema.columns
WHERE  table_schema = 'public' AND table_name = 'subscriptions'
ORDER  BY ordinal_position;

-- If that reads right:
--   COMMIT;
-- Otherwise:
--   ROLLBACK;
ROLLBACK;  -- <= change to COMMIT when the SELECT above looks right
