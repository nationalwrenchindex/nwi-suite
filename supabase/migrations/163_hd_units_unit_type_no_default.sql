-- 163: hd_units.unit_type no longer defaults to 'trailer'.
--
-- Migration 047 created unit_type with DEFAULT 'trailer', so every unit saved without
-- a type was silently recorded as a trailer - and, through migration 161's one-time
-- seed, could inherit Trailer as its equipment category. What kind of equipment a unit
-- is must never be guessed. After this, a unit saved without a category has unit_type
-- NULL and shows under Uncategorized, where it is visible and can be sorted.
--
-- WHAT THIS DOES NOT DO: it changes no existing row. Units already holding 'trailer'
-- keep it; nothing can tell a real trailer from a defaulted one, so re-sorting them is
-- a shop decision, made on the units screen.
--
-- NULL IS ALREADY SAFE:
--   * the column is nullable (047), and hd_units_unit_type_not_blank (161) is
--     CHECK (unit_type IS NULL OR btrim(unit_type) <> '') - NULL passes;
--   * hd_units_category_sync (161) returns early when category_id is NULL and
--     otherwise overwrites unit_type with the category name;
--   * hd_ensure_equipment_categories (161) matches unit_type to a category name, and
--     a NULL matches nothing, so the unit stays Uncategorized;
--   * the screens that print unit_type print "-" / "Unknown type" / "Uncategorized"
--     for NULL.
--
-- The app does not wait for this: the importers already write unit_type NULL
-- explicitly on a unit with no category, and the add-unit form requires a category.
-- This removes the default for any other path.
--
-- Preview and production share one database. Applying this applies it to both.

BEGIN;

ALTER TABLE public.hd_units ALTER COLUMN unit_type DROP DEFAULT;

COMMENT ON COLUMN public.hd_units.unit_type IS
  'Mirror of the equipment category name (set by hd_units_category_sync). NULL = no category. No default: a unit type is never guessed.';

-- Check 1. Should return one row: unit_type | YES | (null)
SELECT column_name, is_nullable, column_default
  FROM information_schema.columns
 WHERE table_schema = 'public'
   AND table_name   = 'hd_units'
   AND column_name  = 'unit_type';

-- Check 2. The not-blank check is still there and allows NULL. Should return one row.
SELECT conname, pg_get_constraintdef(oid) AS definition
  FROM pg_constraint
 WHERE conname = 'hd_units_unit_type_not_blank';

NOTIFY pgrst, 'reload schema';

COMMIT;
