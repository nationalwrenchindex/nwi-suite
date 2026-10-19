-- 161: equipment categories per shop, one "what kind of equipment" field on hd_units,
-- and a unique serial number per shop.
--
-- Spec: docs/KURT-EQUIPMENT-TRACKING-SPEC.md sections 2, 3 and 4.
--
-- PREVIEW AND PRODUCTION SHARE ONE DATABASE. Applying this for a preview applies it to
-- every subscriber's live data.
--
-- RUN ORDER - this file is step 3 of 3:
--   1. scripts/merge-duplicate-unit-taylor-103.sql   (Kurt's duplicate, COMMIT)
--   2. scripts/resolve-brock-duplicate-serials.sql   (two more pairs, edit then COMMIT)
--   3. this migration
-- Step 3 refuses with a clear message if any duplicate serial is still active.
--
-- WHAT IS DIFFERENT FROM THE BRIEF, AND WHY
--   * user_id, not business_id. There is no business table; every HD table scopes by
--     user_id = auth.uid(), one account per business (decided 2026-10-19).
--   * The unique serial index skips RETIRED units (active = false). The merge marks the
--     duplicate inactive and does not delete it, so a plain "serial_number is not null"
--     index would still fail on the row the merge kept.
--   * The index compares upper(btrim(serial_number)), the same rule the work-order
--     linking uses (src/lib/hd/unit-match.ts), so "abc123" and "ABC123 " cannot both
--     be entered for one shop.
--
-- ONE FIELD FOR "WHAT KIND OF EQUIPMENT". category_id is the source. unit_type stays,
-- because the PM screens, Fleet Pro and the importers still read and write it; a
-- trigger copies the category name into it (lowercased) whenever category_id is set,
-- so the two cannot drift. Setting unit_type alone does not touch the category.
--
-- NO DATA IS WRITTEN HERE. Categories are seeded per shop on first access by calling
-- hd_ensure_equipment_categories(), which also seeds each existing unit's category from
-- its current unit_type (truck -> Truck, trailer -> Trailer) the first time it runs.
-- New shops get the same defaults the same way. No cached totals, hours or revenue go
-- on hd_units: a cached total goes stale and then disagrees with the invoices.

BEGIN;

-- ---------------------------------------------------------------------------
-- 1. The category list, per shop.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.hd_equipment_categories (
  id          UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id     UUID        NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  name        TEXT        NOT NULL,
  sort_order  INTEGER     NOT NULL DEFAULT 0,
  is_active   BOOLEAN     NOT NULL DEFAULT true,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT hd_equipment_categories_user_name_unique UNIQUE (user_id, name),
  CONSTRAINT hd_equipment_categories_name_not_blank CHECK (btrim(name) <> '')
);

CREATE INDEX IF NOT EXISTS hd_equipment_categories_user_active_sort_idx
  ON public.hd_equipment_categories (user_id, is_active, sort_order);

ALTER TABLE public.hd_equipment_categories ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Users manage own equipment categories" ON public.hd_equipment_categories;
CREATE POLICY "Users manage own equipment categories"
  ON public.hd_equipment_categories
  FOR ALL
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

-- ---------------------------------------------------------------------------
-- 2. hd_units.category_id
-- ---------------------------------------------------------------------------
ALTER TABLE public.hd_units
  ADD COLUMN IF NOT EXISTS category_id UUID
    REFERENCES public.hd_equipment_categories(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS hd_units_category_idx
  ON public.hd_units (category_id) WHERE category_id IS NOT NULL;

-- The category must be the SAME shop's, and unit_type follows it. A foreign key does
-- not apply RLS, so without the ownership check one shop could point its unit at
-- another shop's category id.
CREATE OR REPLACE FUNCTION public.hd_units_category_sync()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  cat_user UUID;
  cat_name TEXT;
BEGIN
  IF NEW.category_id IS NULL THEN
    RETURN NEW;
  END IF;
  SELECT user_id, name INTO cat_user, cat_name
    FROM public.hd_equipment_categories WHERE id = NEW.category_id;
  IF cat_user IS NULL OR cat_user <> NEW.user_id THEN
    RAISE EXCEPTION 'category % does not belong to this unit''s account', NEW.category_id;
  END IF;
  NEW.unit_type := lower(cat_name);
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS hd_units_category_sync ON public.hd_units;
CREATE TRIGGER hd_units_category_sync
  BEFORE INSERT OR UPDATE OF category_id ON public.hd_units
  FOR EACH ROW EXECUTE FUNCTION public.hd_units_category_sync();

-- Renaming a category renames unit_type on its units, so the two never disagree.
CREATE OR REPLACE FUNCTION public.hd_equipment_categories_rename_sync()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF NEW.name IS DISTINCT FROM OLD.name THEN
    UPDATE public.hd_units SET unit_type = lower(NEW.name)
     WHERE category_id = NEW.id AND user_id = NEW.user_id;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS hd_equipment_categories_rename_sync ON public.hd_equipment_categories;
CREATE TRIGGER hd_equipment_categories_rename_sync
  AFTER UPDATE OF name ON public.hd_equipment_categories
  FOR EACH ROW EXECUTE FUNCTION public.hd_equipment_categories_rename_sync();

-- ---------------------------------------------------------------------------
-- 3. Seeding on first access - called by the app, for the signed-in shop only.
-- ---------------------------------------------------------------------------
-- SECURITY INVOKER: it runs as the caller, under RLS, and touches only auth.uid()'s
-- rows. Idempotent: a shop that already has any category gets nothing inserted and no
-- unit re-mapped, so a renamed or deleted default is never brought back.
CREATE OR REPLACE FUNCTION public.hd_ensure_equipment_categories()
RETURNS void
LANGUAGE plpgsql
SECURITY INVOKER
AS $$
DECLARE
  me UUID := auth.uid();
BEGIN
  IF me IS NULL THEN
    RAISE EXCEPTION 'hd_ensure_equipment_categories: not signed in';
  END IF;
  IF EXISTS (SELECT 1 FROM public.hd_equipment_categories WHERE user_id = me) THEN
    RETURN;
  END IF;

  INSERT INTO public.hd_equipment_categories (user_id, name, sort_order) VALUES
    (me, 'Reefer Unit',     10),
    (me, 'Truck',           20),
    (me, 'Trailer',         30),
    (me, 'Boom',            40),
    (me, 'Aerial / Bucket', 50),
    (me, 'Digger Derrick',  60),
    (me, 'APU',             70),
    (me, 'Genset',          80),
    (me, 'Other',           90)
  ON CONFLICT (user_id, name) DO NOTHING;

  -- Seed each unit's category from what unit_type already says, once. 'trailer' is
  -- also the column DEFAULT and what the Fullbay importer writes, so for some units it
  -- was never a choice - the shop re-sorts those with the bulk categorize screen.
  UPDATE public.hd_units u
     SET category_id = c.id
    FROM public.hd_equipment_categories c
   WHERE u.user_id = me
     AND u.category_id IS NULL
     AND c.user_id = me
     AND lower(c.name) = lower(btrim(u.unit_type));
END;
$$;

GRANT EXECUTE ON FUNCTION public.hd_ensure_equipment_categories() TO authenticated;

-- ---------------------------------------------------------------------------
-- 4. One active unit per serial number, per shop.
-- ---------------------------------------------------------------------------
-- Refuse with a readable message rather than a bare unique-violation if a duplicate
-- is still active - that means step 1 or 2 has not been committed.
DO $$
DECLARE
  dupes TEXT;
BEGIN
  SELECT string_agg(user_id::text || ' ' || serial_key || ' x' || n, '; ')
    INTO dupes
    FROM (
      SELECT user_id, upper(btrim(serial_number)) AS serial_key, count(*) AS n
        FROM public.hd_units
       WHERE serial_number IS NOT NULL AND active IS NOT FALSE
       GROUP BY 1, 2
      HAVING count(*) > 1
    ) d;
  IF dupes IS NOT NULL THEN
    RAISE EXCEPTION 'Duplicate active serial numbers remain - run the merge scripts first: %', dupes;
  END IF;
END;
$$;

CREATE UNIQUE INDEX IF NOT EXISTS hd_units_user_serial_unique
  ON public.hd_units (user_id, upper(btrim(serial_number)))
  WHERE serial_number IS NOT NULL AND active IS NOT FALSE;

-- ---------------------------------------------------------------------------
-- Checks. Each should return one row.
-- ---------------------------------------------------------------------------
SELECT 'hd_equipment_categories' AS object FROM information_schema.tables
 WHERE table_schema = 'public' AND table_name = 'hd_equipment_categories';
SELECT 'hd_units.category_id' AS object FROM information_schema.columns
 WHERE table_name = 'hd_units' AND column_name = 'category_id';
SELECT 'hd_units_user_serial_unique' AS object FROM pg_indexes
 WHERE indexname = 'hd_units_user_serial_unique';
SELECT 'hd_ensure_equipment_categories()' AS object FROM pg_proc
 WHERE proname = 'hd_ensure_equipment_categories';

NOTIFY pgrst, 'reload schema';

COMMIT;
