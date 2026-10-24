-- 166: labor cards. Extends hd_repair_items (the labor library) for hand authoring.
--
-- ONE TABLE. hd_repair_items is already the library: the HD quote modal, LD
-- QuickWrench and HD QuickWrench all read it through /api/hd/repair-items. This
-- extends it rather than creating a second table. LD and HD share it.
--
-- REUSED, NOT RENAMED:
--   description    the operation name (job_description in the brief)
--   mobile_hours   field time, LOW end (or the single value)
--   shop_hours     shop time with a lift, LOW end (or the single value)
--   updated_at     "most recently edited"
--   active         soft delete. false = deleted. Every reader already filters it.
--   A stored 0 in mobile_hours or shop_hours means "never entered" and is read as
--   empty. No existing value is rewritten by this migration.
--
-- ADDED:
--   mobile_hours_high, shop_hours_high   HIGH end of a range. NULL = single value.
--     A high needs a positive low and is never below it.
--   detail             the note printed under the description
--   suggested_related  an operation commonly done with it
--   equipment_category_id  optional link to the shop's own hd_equipment_categories
--     row (migration 161), for private organizing. ON DELETE SET NULL.
--   equipment_type     shop-independent kind of equipment, fixed values, NULL =
--     unspecified. A future NWI or shared row can carry it without belonging to any
--     shop's category table. The values are the default category list 161 seeds.
--     applies_to (truck/trailer/both) is left exactly as it is.
--   scope   private | proposed | global, default private
--   origin  shop | nwi | field_reported, default shop
--     origin sits ALONGSIDE the existing source column (manual/quickwrench/seed),
--     which is untouched.
--
-- BACKFILL of the two new columns only, nothing else on any row:
--   every existing row gets scope 'private' and origin 'shop' from the defaults,
--   then the 21 NWI catalog rows (is_master = true, user_id NULL) are set to
--   scope 'global', origin 'nwi', which is what they already are. updated_at is
--   not touched (the table has no trigger), so edit order does not move.
--
-- RLS, replacing the two 067 policies:
--   read:   your own rows, plus the NWI catalog (user_id NULL and is_master = true).
--           Nothing else. Another shop's rows are never readable, whatever their
--           scope. The shared guide will widen this deliberately, later.
--   insert: user_id must be you, is_master false, scope 'private', origin 'shop',
--           and an equipment_category_id must be NULL or one of YOUR categories.
--   update: your own rows only, and the row must still pass the insert rules after
--           the change - so a shop cannot make its row a catalog row, publish it
--           global, give it to another user, or point it at another shop's category.
--   delete: your own rows only (unchanged; the app soft deletes via active).
--   The service role (the founder-only catalog seed, the smoke suite's cleanup)
--   bypasses RLS as before.
--   The 067 FOR ALL policy let a shop set is_master = true on its own row, which the
--   read policy then showed to every shop. These rules close that.
--
-- Preview and production share one database. Applying this applies it to both.
-- The new labor-card route refuses a save before this is applied, with a message
-- naming this migration. The existing quote-modal and QuickWrench saves are
-- unaffected either way.

BEGIN;

ALTER TABLE public.hd_repair_items
  ADD COLUMN IF NOT EXISTS mobile_hours_high     DECIMAL(4,2),
  ADD COLUMN IF NOT EXISTS shop_hours_high       DECIMAL(4,2),
  ADD COLUMN IF NOT EXISTS detail                TEXT,
  ADD COLUMN IF NOT EXISTS suggested_related     TEXT,
  ADD COLUMN IF NOT EXISTS equipment_category_id UUID
    REFERENCES public.hd_equipment_categories(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS equipment_type        TEXT,
  ADD COLUMN IF NOT EXISTS scope                 TEXT NOT NULL DEFAULT 'private',
  ADD COLUMN IF NOT EXISTS origin                TEXT NOT NULL DEFAULT 'shop';

ALTER TABLE public.hd_repair_items
  DROP CONSTRAINT IF EXISTS hd_repair_items_mobile_hours_high_check,
  DROP CONSTRAINT IF EXISTS hd_repair_items_shop_hours_high_check,
  DROP CONSTRAINT IF EXISTS hd_repair_items_equipment_type_check,
  DROP CONSTRAINT IF EXISTS hd_repair_items_scope_check,
  DROP CONSTRAINT IF EXISTS hd_repair_items_origin_check;

ALTER TABLE public.hd_repair_items
  ADD CONSTRAINT hd_repair_items_mobile_hours_high_check CHECK (
    mobile_hours_high IS NULL
    OR (mobile_hours IS NOT NULL AND mobile_hours > 0 AND mobile_hours_high >= mobile_hours)),
  ADD CONSTRAINT hd_repair_items_shop_hours_high_check CHECK (
    shop_hours_high IS NULL
    OR (shop_hours IS NOT NULL AND shop_hours > 0 AND shop_hours_high >= shop_hours)),
  ADD CONSTRAINT hd_repair_items_equipment_type_check CHECK (
    equipment_type IS NULL OR equipment_type IN
      ('reefer', 'truck', 'trailer', 'boom', 'aerial', 'digger_derrick', 'apu', 'genset', 'other')),
  ADD CONSTRAINT hd_repair_items_scope_check CHECK (
    scope IN ('private', 'proposed', 'global')),
  ADD CONSTRAINT hd_repair_items_origin_check CHECK (
    origin IN ('shop', 'nwi', 'field_reported'));

UPDATE public.hd_repair_items
   SET scope = 'global', origin = 'nwi'
 WHERE is_master = true AND user_id IS NULL;

CREATE INDEX IF NOT EXISTS idx_hd_repair_items_user_edited
  ON public.hd_repair_items (user_id, updated_at DESC) WHERE active = true;

COMMENT ON COLUMN public.hd_repair_items.mobile_hours_high IS
  'Migration 166. High end of the field-time range; mobile_hours is the low end. NULL = single value.';
COMMENT ON COLUMN public.hd_repair_items.shop_hours_high IS
  'Migration 166. High end of the shop-time range; shop_hours is the low end. NULL = single value.';
COMMENT ON COLUMN public.hd_repair_items.detail IS
  'Migration 166. Note printed under the description.';
COMMENT ON COLUMN public.hd_repair_items.suggested_related IS
  'Migration 166. An operation commonly done with this one.';
COMMENT ON COLUMN public.hd_repair_items.equipment_category_id IS
  'Migration 166. Optional link to the owner''s own hd_equipment_categories row.';
COMMENT ON COLUMN public.hd_repair_items.equipment_type IS
  'Migration 166. Shop-independent equipment kind; the field a shared guide keys on. NULL = unspecified.';
COMMENT ON COLUMN public.hd_repair_items.scope IS
  'Migration 166. private | proposed | global. Shops may only write private.';
COMMENT ON COLUMN public.hd_repair_items.origin IS
  'Migration 166. shop | nwi | field_reported. Separate from source (manual/quickwrench/seed).';

DROP POLICY IF EXISTS "read master repair items"          ON public.hd_repair_items;
DROP POLICY IF EXISTS "manage own repair items"           ON public.hd_repair_items;
DROP POLICY IF EXISTS "hd_repair_items read own or catalog" ON public.hd_repair_items;
DROP POLICY IF EXISTS "hd_repair_items insert own private" ON public.hd_repair_items;
DROP POLICY IF EXISTS "hd_repair_items update own private" ON public.hd_repair_items;
DROP POLICY IF EXISTS "hd_repair_items delete own"         ON public.hd_repair_items;

CREATE POLICY "hd_repair_items read own or catalog" ON public.hd_repair_items
  FOR SELECT TO authenticated
  USING (user_id = auth.uid() OR (user_id IS NULL AND is_master = true));

CREATE POLICY "hd_repair_items insert own private" ON public.hd_repair_items
  FOR INSERT TO authenticated
  WITH CHECK (
    user_id = auth.uid()
    AND is_master = false
    AND scope = 'private'
    AND origin = 'shop'
    AND (equipment_category_id IS NULL OR EXISTS (
      SELECT 1 FROM public.hd_equipment_categories c
       WHERE c.id = equipment_category_id AND c.user_id = auth.uid())));

CREATE POLICY "hd_repair_items update own private" ON public.hd_repair_items
  FOR UPDATE TO authenticated
  USING (user_id = auth.uid())
  WITH CHECK (
    user_id = auth.uid()
    AND is_master = false
    AND scope = 'private'
    AND origin = 'shop'
    AND (equipment_category_id IS NULL OR EXISTS (
      SELECT 1 FROM public.hd_equipment_categories c
       WHERE c.id = equipment_category_id AND c.user_id = auth.uid())));

CREATE POLICY "hd_repair_items delete own" ON public.hd_repair_items
  FOR DELETE TO authenticated
  USING (user_id = auth.uid());

-- Check 1. Should return 8 rows: the new columns.
SELECT column_name, data_type, is_nullable, column_default
  FROM information_schema.columns
 WHERE table_schema = 'public' AND table_name = 'hd_repair_items'
   AND column_name IN ('mobile_hours_high', 'shop_hours_high', 'detail', 'suggested_related',
                       'equipment_category_id', 'equipment_type', 'scope', 'origin')
 ORDER BY column_name;

-- Check 2. Should return exactly 4 rows, the policies above, and nothing else.
-- A fifth row is a policy this file did not know about and must be read.
SELECT policyname, cmd, roles
  FROM pg_policies
 WHERE schemaname = 'public' AND tablename = 'hd_repair_items'
 ORDER BY policyname;

-- Check 3. Expect global/nwi 21 and private/shop 10 (31 rows on 2026-10-24),
-- and no row with a high value yet.
SELECT scope, origin, is_master, count(*) AS rows,
       count(mobile_hours_high) AS with_mobile_high, count(shop_hours_high) AS with_shop_high
  FROM public.hd_repair_items
 GROUP BY scope, origin, is_master
 ORDER BY scope;

NOTIFY pgrst, 'reload schema';

COMMIT;
