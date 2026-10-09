-- =============================================================================
-- Close the shared-reference write hole
-- =============================================================================
--
-- FOR EDWARD TO RUN. Nothing here is run by me.
--
-- -- WHAT IS WRONG ------------------------------------------------------------
--
-- Four shared reference tables carry a policy of the form
--
--     CREATE POLICY "Authenticated manage ..." ON <table>
--       FOR ALL TO authenticated USING (true);
--
-- FOR ALL covers SELECT, INSERT, UPDATE and DELETE, and a FOR ALL policy with no
-- WITH CHECK clause reuses its USING expression as the WITH CHECK. So USING (true)
-- means: any signed-in subscriber may insert, edit or delete any row.
--
-- These tables are not one shop's data. They are the reference library every
-- subscriber reads. One subscriber editing a torque spec, an alarm code or a filter
-- part number changes what every other subscriber is told - and nothing records who
-- did it.
--
-- VERIFIED LIVE, not inferred from the migration files. Acting as a real signed-in
-- subscriber against PostgREST:
--
--     hd_parts_reference    INSERT -> 201 Created
--     hd_parts_reference    UPDATE of an existing row -> succeeded (restored by hand)
--     hd_alarm_codes        INSERT -> reached the NOT NULL constraints (23502)
--     hd_trailer_reference  INSERT -> 201 Created
--     hd_procedures         INSERT -> 201 Created
--
-- All probe rows were deleted and the counts confirmed back to 960 / 4 / 100.
--
-- For contrast, these refused with 42501 as a shared table should:
--     hd_parts, hd_parts_cross_ref, parts, part_fitment,
--     part_cross_reference, part_supersession
--
-- -- WHAT THIS DOES -----------------------------------------------------------
--
-- Replaces each FOR ALL policy with a SELECT-only policy. Reads are unchanged, so
-- nothing in the product breaks: QuickWrench, the Parts Ref panel, the trailer
-- library and the procedures tab all only read.
--
-- Writes move to the service role, which bypasses RLS. That is already how every
-- seed endpoint and loader works - scripts/load-parts.ts, the parts-reference seed
-- route and the alarm-code seed all use the service key - so there is no write path
-- in the product that this takes away.
--
-- -- BEFORE YOU RUN IT --------------------------------------------------------
--
-- STEP 1 prints the policies as they are now, so you can see the USING and WITH
-- CHECK text for yourself rather than taking my word for it. Read that output
-- first. If a policy you depend on is listed, stop and tell me.
--
-- This script ENDS IN ROLLBACK. Read STEP 1, then change the last line to COMMIT
-- and run it again.

-- -----------------------------------------------------------------------------
-- STEP 1. Look at what is there now. Read this before changing anything.
-- -----------------------------------------------------------------------------
SELECT tablename,
       policyname,
       cmd,
       roles::text               AS granted_to,
       coalesce(qual, '(none)')       AS using_expression,
       coalesce(with_check, '(none)') AS with_check_expression
FROM   pg_policies
WHERE  schemaname = 'public'
  AND  tablename IN ('hd_parts', 'hd_parts_cross_ref', 'hd_parts_reference',
                     'hd_alarm_codes', 'hd_trailer_reference', 'hd_procedures',
                     'parts', 'part_fitment', 'part_supersession',
                     'part_cross_reference', 'inventory')
ORDER  BY tablename, cmd, policyname;

BEGIN;

-- -----------------------------------------------------------------------------
-- STEP 2. Replace FOR ALL with SELECT only, one table at a time.
-- -----------------------------------------------------------------------------

-- hd_parts_reference (migration 061)
DROP POLICY IF EXISTS "Authenticated manage parts reference" ON public.hd_parts_reference;
DROP POLICY IF EXISTS "Authenticated read parts reference"   ON public.hd_parts_reference;
CREATE POLICY "Authenticated read parts reference"
  ON public.hd_parts_reference FOR SELECT TO authenticated USING (true);

-- hd_alarm_codes (migration 058)
DROP POLICY IF EXISTS "Authenticated manage alarm codes" ON public.hd_alarm_codes;
DROP POLICY IF EXISTS "Authenticated read alarm codes"   ON public.hd_alarm_codes;
CREATE POLICY "Authenticated read alarm codes"
  ON public.hd_alarm_codes FOR SELECT TO authenticated USING (true);

-- hd_trailer_reference (migration 124)
DROP POLICY IF EXISTS "Authenticated manage trailer reference" ON public.hd_trailer_reference;
DROP POLICY IF EXISTS "Authenticated read trailer reference"   ON public.hd_trailer_reference;
CREATE POLICY "Authenticated read trailer reference"
  ON public.hd_trailer_reference FOR SELECT TO authenticated USING (true);

-- hd_procedures (migration 060)
DROP POLICY IF EXISTS "Authenticated manage procedures" ON public.hd_procedures;
DROP POLICY IF EXISTS "Authenticated read procedures"   ON public.hd_procedures;
CREATE POLICY "Authenticated read procedures"
  ON public.hd_procedures FOR SELECT TO authenticated USING (true);

-- NOTE ON THE PUBLIC READ POLICIES
--
-- 061 and 124 also create a "Public read ..." policy FOR SELECT TO public, which lets
-- an unauthenticated visitor read the reference library. That is a separate decision -
-- it may be deliberate, since some of this is marketing-visible - so it is LEFT ALONE
-- here rather than quietly changed along with the write hole. Say the word and it
-- becomes its own script.

-- -----------------------------------------------------------------------------
-- STEP 3. Prove it changed. Expect SELECT only, and no row where the command is
-- ALL or where with_check is true.
-- -----------------------------------------------------------------------------
SELECT tablename,
       policyname,
       cmd,
       coalesce(qual, '(none)')       AS using_expression,
       coalesce(with_check, '(none)') AS with_check_expression
FROM   pg_policies
WHERE  schemaname = 'public'
  AND  tablename IN ('hd_parts_reference', 'hd_alarm_codes',
                     'hd_trailer_reference', 'hd_procedures')
ORDER  BY tablename, cmd, policyname;

-- Expect zero rows. A FOR ALL policy left on any shared reference table is the bug
-- this script exists to remove.
SELECT tablename, policyname, cmd
FROM   pg_policies
WHERE  schemaname = 'public'
  AND  tablename IN ('hd_parts_reference', 'hd_alarm_codes',
                     'hd_trailer_reference', 'hd_procedures')
  AND  cmd <> 'SELECT';

-- Expect the row counts to be untouched: 960, 4, 100, and whatever hd_alarm_codes
-- holds. This script changes permissions, never data.
SELECT (SELECT count(*) FROM public.hd_parts_reference)   AS parts_reference,
       (SELECT count(*) FROM public.hd_procedures)         AS procedures,
       (SELECT count(*) FROM public.hd_trailer_reference)  AS trailer_reference,
       (SELECT count(*) FROM public.hd_alarm_codes)        AS alarm_codes;

-- -----------------------------------------------------------------------------
-- Read STEP 1 and STEP 3 above, then change this to COMMIT and run it again.
-- -----------------------------------------------------------------------------
ROLLBACK;
