-- 172: stop signed-out visitors reading the four shared reference tables.
--
--   hd_alarm_codes        (migration 058)  100 rows
--   hd_procedures         (migration 060)    4 rows
--   hd_parts_reference    (migration 061)  960 rows
--   hd_trailer_reference  (migration 124)  100 rows
--
-- WHAT IS WRONG. Each table has a "Public read ..." policy FOR SELECT TO public.
-- The public role includes anon, so the anon key alone - which ships in every page's
-- JavaScript - reads every row through the REST API with no login. Verified Oct 27,
-- 2026: all four tables returned rows to an anon-key request with no session
-- (counts above), including alarm-code causes, diagnostic steps, fixes and the
-- book/mobile field times.
--
-- WHAT THIS DOES. Drops those four policies, nothing else. Signed-in users keep
-- reading through the "Authenticated read ..." policies migration 171 created.
-- The service role bypasses RLS, so the seed and admin routes are unaffected.
--
-- WHO LOSES ACCESS. Only requests with no user session. Every product read of these
-- tables is a server route that already returns 401 without a signed-in user
-- (/api/hd/alarm-codes, /api/hd/quickwrench, /api/hd/parts-reference,
-- /api/hd/trailer-reference, /api/hd/trailer-abs-diagnostic). No public page, public
-- quote page, pay page or marketing route reads them.
--
-- PERMISSIONS ONLY. No table, column, constraint or row is changed.
-- Preview and production share one database. Applying this applies it to both.
--
-- The DO block checks its own work and raises an error - rolling the whole
-- transaction back - if any of the four still has a policy granted to public or anon,
-- has any policy that can write, has no SELECT policy for authenticated, or does not
-- have row level security on.

BEGIN;

DROP POLICY IF EXISTS "Public read alarm codes"       ON public.hd_alarm_codes;
DROP POLICY IF EXISTS "Public read procedures"        ON public.hd_procedures;
DROP POLICY IF EXISTS "Public read parts reference"   ON public.hd_parts_reference;
DROP POLICY IF EXISTS "Public read trailer reference" ON public.hd_trailer_reference;

DO $$
DECLARE
  t       TEXT;
  open_to INTEGER;
  writers INTEGER;
  readers INTEGER;
  rls_on  BOOLEAN;
BEGIN
  FOREACH t IN ARRAY ARRAY['hd_alarm_codes', 'hd_procedures', 'hd_parts_reference', 'hd_trailer_reference'] LOOP
    SELECT count(*) INTO open_to
      FROM pg_policies
     WHERE schemaname = 'public' AND tablename = t
       AND ('public' = ANY (roles) OR 'anon' = ANY (roles));
    IF open_to > 0 THEN
      RAISE EXCEPTION '172: % still has % policy(ies) granted to public or anon - nothing applied', t, open_to;
    END IF;

    SELECT count(*) INTO writers
      FROM pg_policies
     WHERE schemaname = 'public' AND tablename = t AND cmd <> 'SELECT';
    IF writers > 0 THEN
      RAISE EXCEPTION '172: % has % policy(ies) that can write - nothing applied', t, writers;
    END IF;

    SELECT count(*) INTO readers
      FROM pg_policies
     WHERE schemaname = 'public' AND tablename = t AND cmd = 'SELECT'
       AND 'authenticated' = ANY (roles);
    IF readers = 0 THEN
      RAISE EXCEPTION '172: % has no SELECT policy for authenticated - signed-in users would lose it - nothing applied', t;
    END IF;

    SELECT c.relrowsecurity INTO rls_on
      FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
     WHERE n.nspname = 'public' AND c.relname = t;
    IF rls_on IS DISTINCT FROM true THEN
      RAISE EXCEPTION '172: row level security is not on for % - nothing applied', t;
    END IF;
  END LOOP;
END $$;

-- Check (last, so it is the result the editor shows). Expect exactly 4 rows, one
-- "Authenticated read ..." per table, cmd SELECT, granted_to {authenticated}.
SELECT tablename, policyname, cmd, roles::text AS granted_to
  FROM pg_policies
 WHERE schemaname = 'public'
   AND tablename IN ('hd_alarm_codes', 'hd_procedures', 'hd_parts_reference', 'hd_trailer_reference')
 ORDER BY tablename, policyname;

COMMIT;
