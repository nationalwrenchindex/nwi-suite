-- 173: inventory_position must obey the row security on the tables it reads.
--
-- WHAT IS WRONG. Migration 151 created the view public.inventory_position without
-- security_invoker, which defaults to off. A view without it runs as its owner
-- (postgres), and postgres bypasses row level security - so the per-shop policies on
-- inventory, stock_location and stock_allocation do not apply to anything read
-- through the view. Supabase also grants SELECT on new public views to anon and
-- authenticated by default, and 151 revoked nothing.
--
-- Confirmed live Oct 28, 2026: reloptions NULL, owner postgres, anon SELECT true,
-- authenticated SELECT true. The view is empty today. Once stock is in it, the anon
-- key - which ships in every page - would read every shop's on_hand, last_cost and
-- sell_price, and any signed-in shop would read every other shop's.
--
-- WHAT THIS DOES.
--   1. security_invoker = true: the view now runs as the caller, so the owner-only
--      policies from 151 apply. A signed-in shop sees its own rows and nothing else.
--   2. Revokes every privilege on the view from anon and PUBLIC.
--   3. Revokes write privileges on the view from authenticated. The view is a join
--      and cannot be written through anyway; this makes it explicit. SELECT stays.
--
-- No product code reads the view today (only a comment in src/lib/inventory/ledger.ts),
-- so nothing changes behaviour.
--
-- PERMISSIONS ONLY. No table, column, constraint or row is changed, and the view's
-- definition is not touched.
-- Preview and production share one database. Applying this applies it to both.
--
-- The DO block checks its own work and raises an error - rolling the whole
-- transaction back - if: the view is not security_invoker; anon can still select or
-- write it; authenticated has lost SELECT on the view; or authenticated could no
-- longer read its OWN rows through it, meaning any of the three tables it reads has
-- row level security off, has no SELECT privilege for authenticated, or has no
-- SELECT policy for authenticated that is scoped by auth.uid().

BEGIN;

ALTER VIEW public.inventory_position SET (security_invoker = true);

REVOKE ALL ON public.inventory_position FROM anon;
REVOKE ALL ON public.inventory_position FROM PUBLIC;
REVOKE INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER
  ON public.inventory_position FROM authenticated;
GRANT SELECT ON public.inventory_position TO authenticated;

DO $$
DECLARE
  opts    TEXT[];
  t       TEXT;
  rls_on  BOOLEAN;
  scoped  INTEGER;
BEGIN
  -- 1. The view runs as the caller.
  SELECT c.reloptions INTO opts
    FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
   WHERE n.nspname = 'public' AND c.relname = 'inventory_position' AND c.relkind = 'v';
  IF NOT FOUND THEN
    RAISE EXCEPTION '173: view public.inventory_position not found - nothing applied';
  END IF;
  IF opts IS NULL OR NOT (opts && ARRAY['security_invoker=true', 'security_invoker=on', 'security_invoker=1']) THEN
    RAISE EXCEPTION '173: inventory_position is not security_invoker (reloptions %) - nothing applied', opts;
  END IF;

  -- 2. anon cannot read or write it (has_table_privilege counts PUBLIC grants too).
  IF has_table_privilege('anon', 'public.inventory_position', 'SELECT')
     OR has_table_privilege('anon', 'public.inventory_position', 'INSERT')
     OR has_table_privilege('anon', 'public.inventory_position', 'UPDATE')
     OR has_table_privilege('anon', 'public.inventory_position', 'DELETE') THEN
    RAISE EXCEPTION '173: anon still has a privilege on inventory_position - nothing applied';
  END IF;

  -- 3. authenticated can still select the view.
  IF NOT has_table_privilege('authenticated', 'public.inventory_position', 'SELECT') THEN
    RAISE EXCEPTION '173: authenticated lost SELECT on inventory_position - nothing applied';
  END IF;

  -- 4. authenticated can still read its OWN rows through it. With security_invoker
  --    on, the caller needs SELECT on each table the view reads, and that table's
  --    row security must hand back the caller's rows.
  FOREACH t IN ARRAY ARRAY['inventory', 'stock_location', 'stock_allocation'] LOOP
    SELECT c.relrowsecurity INTO rls_on
      FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
     WHERE n.nspname = 'public' AND c.relname = t;
    IF rls_on IS DISTINCT FROM true THEN
      RAISE EXCEPTION '173: row level security is not on for % - the view would show every shop - nothing applied', t;
    END IF;

    IF NOT has_table_privilege('authenticated', 'public.' || t, 'SELECT') THEN
      RAISE EXCEPTION '173: authenticated has no SELECT on % - shops would lose their own rows - nothing applied', t;
    END IF;

    SELECT count(*) INTO scoped
      FROM pg_policies
     WHERE schemaname = 'public' AND tablename = t
       AND cmd IN ('SELECT', 'ALL')
       AND ('authenticated' = ANY (roles) OR 'public' = ANY (roles))
       AND qual LIKE '%auth.uid()%';
    IF scoped = 0 THEN
      RAISE EXCEPTION '173: % has no SELECT policy scoped by auth.uid() for authenticated - nothing applied', t;
    END IF;
  END LOOP;
END $$;

-- Check (last, so it is the result the editor shows). Expect one row:
-- reloptions {security_invoker=true}, owner postgres, anon_can_select false,
-- auth_can_select true.
SELECT c.relname, c.reloptions, pg_get_userbyid(c.relowner) AS owner,
       has_table_privilege('anon', 'public.inventory_position', 'SELECT')          AS anon_can_select,
       has_table_privilege('authenticated', 'public.inventory_position', 'SELECT') AS auth_can_select
  FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
 WHERE n.nspname = 'public' AND c.relname = 'inventory_position';

COMMIT;
