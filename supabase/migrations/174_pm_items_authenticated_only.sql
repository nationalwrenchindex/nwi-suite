-- 174: pm_items policies reach signed-in users only.
--
-- WHAT IS WRONG. Migration 144 created all four pm_items policies with no TO clause,
-- and a policy with no TO clause applies to PUBLIC - which includes anon. The SELECT
-- policy is USING (user_id IS NULL OR user_id = auth.uid()), so the shared PM catalog
-- rows (user_id IS NULL) are readable with nothing but the anon key, which ships in
-- every page. Confirmed live Oct 28, 2026: an anon-key request with no session got
-- 1 of 1 rows. Every catalog row added later would go out the same way.
--
-- The INSERT, UPDATE and DELETE policies are also TO PUBLIC. They test
-- user_id = auth.uid(), which is never true for anon, so they leak nothing - but they
-- are moved to authenticated as well so that no pm_items policy names PUBLIC at all.
--
-- WHAT THIS DOES. Drops and recreates the four policies with the SAME expressions,
-- now TO authenticated. Signed-in users see exactly what they saw before: the catalog
-- plus their own rows. The only reader in the product,
-- /api/fleet-pro/units/[id]/pm-items, already returns 401 without a signed-in user.
--
-- LEFT ALONE: unit_pm_item_status_all (also no TO clause). It is scoped by
-- user_id = auth.uid() on every row, so anon matches nothing.
--
-- PERMISSIONS ONLY. No table, column, constraint or row is changed.
-- Preview and production share one database. Applying this applies it to both.
--
-- The DO block checks its own work and raises an error - rolling the whole
-- transaction back - if: any pm_items policy still names public or anon; there are
-- not exactly four policies; row level security is off; anon can still read any row;
-- or a signed-in user can no longer read the catalog rows.

BEGIN;

DROP POLICY IF EXISTS pm_items_select ON public.pm_items;
CREATE POLICY pm_items_select ON public.pm_items
  FOR SELECT TO authenticated USING (user_id IS NULL OR user_id = auth.uid());

DROP POLICY IF EXISTS pm_items_insert ON public.pm_items;
CREATE POLICY pm_items_insert ON public.pm_items
  FOR INSERT TO authenticated WITH CHECK (user_id = auth.uid());

DROP POLICY IF EXISTS pm_items_update ON public.pm_items;
CREATE POLICY pm_items_update ON public.pm_items
  FOR UPDATE TO authenticated USING (user_id = auth.uid()) WITH CHECK (user_id = auth.uid());

DROP POLICY IF EXISTS pm_items_delete ON public.pm_items;
CREATE POLICY pm_items_delete ON public.pm_items
  FOR DELETE TO authenticated USING (user_id = auth.uid());

DO $$
DECLARE
  open_to      INTEGER;
  n_policies   INTEGER;
  rls_on       BOOLEAN;
  catalog_rows INTEGER;
  anon_rows    INTEGER;
  auth_rows    INTEGER;
BEGIN
  SELECT count(*) INTO open_to
    FROM pg_policies
   WHERE schemaname = 'public' AND tablename = 'pm_items'
     AND ('public' = ANY (roles) OR 'anon' = ANY (roles));
  IF open_to > 0 THEN
    RAISE EXCEPTION '174: pm_items still has % policy(ies) granted to public or anon - nothing applied', open_to;
  END IF;

  SELECT count(*) INTO n_policies
    FROM pg_policies
   WHERE schemaname = 'public' AND tablename = 'pm_items';
  IF n_policies <> 4 THEN
    RAISE EXCEPTION '174: pm_items has % policies, expected 4 - nothing applied', n_policies;
  END IF;

  SELECT c.relrowsecurity INTO rls_on
    FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
   WHERE n.nspname = 'public' AND c.relname = 'pm_items';
  IF rls_on IS DISTINCT FROM true THEN
    RAISE EXCEPTION '174: row level security is not on for pm_items - nothing applied';
  END IF;

  -- Live test. Count the catalog as the owner, then read the table as anon and as a
  -- signed-in user with no rows of their own (no JWT, so auth.uid() is NULL).
  SELECT count(*) INTO catalog_rows FROM public.pm_items WHERE user_id IS NULL;

  SET LOCAL ROLE anon;
  SELECT count(*) INTO anon_rows FROM public.pm_items;
  RESET ROLE;
  IF anon_rows <> 0 THEN
    RAISE EXCEPTION '174: anon can still read % pm_items row(s) - nothing applied', anon_rows;
  END IF;

  SET LOCAL ROLE authenticated;
  SELECT count(*) INTO auth_rows FROM public.pm_items;
  RESET ROLE;
  IF auth_rows <> catalog_rows THEN
    RAISE EXCEPTION '174: a signed-in user reads % pm_items rows, expected the % catalog rows - nothing applied', auth_rows, catalog_rows;
  END IF;
END $$;

-- Check (last, so it is the result the editor shows). Expect exactly 4 rows,
-- pm_items_delete / _insert / _select / _update, each granted_to {authenticated}.
SELECT policyname, cmd, roles::text AS granted_to
  FROM pg_policies
 WHERE schemaname = 'public' AND tablename = 'pm_items'
 ORDER BY policyname;

COMMIT;
