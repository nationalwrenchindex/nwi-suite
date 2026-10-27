-- 171: close the write hole on four shared reference tables.
--
-- From scripts/fix-shared-reference-rls.sql, which was written but never run.
--
-- WHAT IS WRONG. These four tables are the reference library every subscriber reads,
-- not one shop's data:
--
--   hd_alarm_codes        (migration 058)
--   hd_procedures         (migration 060)
--   hd_parts_reference    (migration 061)
--   hd_trailer_reference  (migration 124)
--
-- Each carries a policy "Authenticated manage ..." FOR ALL TO authenticated USING (true).
-- FOR ALL covers INSERT, UPDATE and DELETE as well as SELECT, and with no WITH CHECK
-- the USING (true) is reused as the check. So any signed-in subscriber can insert,
-- edit or delete any row, changing what every other subscriber is told, and nothing
-- records who did it. This was verified live when the script was written: a real
-- subscriber session got 201 on INSERT into hd_parts_reference, hd_trailer_reference
-- and hd_procedures, and an UPDATE of an existing hd_parts_reference row succeeded.
--
-- WHAT THIS DOES. Drops each FOR ALL policy and puts a SELECT-only policy for signed-in
-- users in its place. Reads are unchanged. Writes move to the service role, which
-- bypasses RLS. Every write path in the product already uses the service role (the
-- alarm-code, procedures, trailer-reference and parts-reference seed routes, and the
-- admin cached-diagnostics route), so no product feature loses a write.
--
-- LEFT ALONE: the "Public read ..." policies (FOR SELECT TO public) on these tables.
-- Whether signed-out visitors may read the library is a separate decision.
--
-- PERMISSIONS ONLY. No table, column, constraint or row is changed.
-- Preview and production share one database. Applying this applies it to both.
--
-- The DO block below checks its own work and raises an error - which rolls the whole
-- transaction back - if any of the four tables still has a policy that can write, has
-- no SELECT policy for signed-in users, or does not have row level security on.

BEGIN;

-- hd_alarm_codes (058)
DROP POLICY IF EXISTS "Authenticated manage alarm codes" ON public.hd_alarm_codes;
DROP POLICY IF EXISTS "Authenticated read alarm codes"   ON public.hd_alarm_codes;
CREATE POLICY "Authenticated read alarm codes"
  ON public.hd_alarm_codes FOR SELECT TO authenticated USING (true);

-- hd_procedures (060)
DROP POLICY IF EXISTS "Authenticated manage procedures" ON public.hd_procedures;
DROP POLICY IF EXISTS "Authenticated read procedures"   ON public.hd_procedures;
CREATE POLICY "Authenticated read procedures"
  ON public.hd_procedures FOR SELECT TO authenticated USING (true);

-- hd_parts_reference (061)
DROP POLICY IF EXISTS "Authenticated manage parts reference" ON public.hd_parts_reference;
DROP POLICY IF EXISTS "Authenticated read parts reference"   ON public.hd_parts_reference;
CREATE POLICY "Authenticated read parts reference"
  ON public.hd_parts_reference FOR SELECT TO authenticated USING (true);

-- hd_trailer_reference (124)
DROP POLICY IF EXISTS "Authenticated manage trailer reference" ON public.hd_trailer_reference;
DROP POLICY IF EXISTS "Authenticated read trailer reference"   ON public.hd_trailer_reference;
CREATE POLICY "Authenticated read trailer reference"
  ON public.hd_trailer_reference FOR SELECT TO authenticated USING (true);

DO $$
DECLARE
  t       TEXT;
  writers INTEGER;
  readers INTEGER;
  rls_on  BOOLEAN;
BEGIN
  FOREACH t IN ARRAY ARRAY['hd_alarm_codes', 'hd_procedures', 'hd_parts_reference', 'hd_trailer_reference'] LOOP
    SELECT count(*) INTO writers
      FROM pg_policies
     WHERE schemaname = 'public' AND tablename = t AND cmd <> 'SELECT';
    IF writers > 0 THEN
      RAISE EXCEPTION '171: % still has % policy(ies) that can write - nothing applied', t, writers;
    END IF;

    SELECT count(*) INTO readers
      FROM pg_policies
     WHERE schemaname = 'public' AND tablename = t AND cmd = 'SELECT'
       AND ('authenticated' = ANY (roles) OR 'public' = ANY (roles));
    IF readers = 0 THEN
      RAISE EXCEPTION '171: % has no SELECT policy for signed-in users - nothing applied', t;
    END IF;

    SELECT c.relrowsecurity INTO rls_on
      FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
     WHERE n.nspname = 'public' AND c.relname = t;
    IF rls_on IS DISTINCT FROM true THEN
      RAISE EXCEPTION '171: row level security is not on for % - nothing applied', t;
    END IF;
  END LOOP;
END $$;

-- Check (last, so it is the result the editor shows). Expect only SELECT rows: one
-- "Authenticated read ..." and one "Public read ..." per table, 8 rows in all.
SELECT tablename, policyname, cmd, roles::text AS granted_to
  FROM pg_policies
 WHERE schemaname = 'public'
   AND tablename IN ('hd_alarm_codes', 'hd_procedures', 'hd_parts_reference', 'hd_trailer_reference')
 ORDER BY tablename, policyname;

COMMIT;
