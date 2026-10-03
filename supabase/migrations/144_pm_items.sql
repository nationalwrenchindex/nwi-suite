-- ╔═══════════════════════════════════════════════════════════════════════════╗
-- ║ 144 — Model-specific PM items: the container for field knowledge           ║
-- ╚═══════════════════════════════════════════════════════════════════════════╝
--
-- BIG RUN THREE, Part 4. STRUCTURE, NOT A ONE-OFF COLUMN. A second item must
-- need no code change and no migration — only a row.
--
-- ── TWO PREMISES IN THE BRIEF ARE WRONG, AND THIS IS WHERE IT MATTERS ───────
--
-- 1. `fleet_pro_unit_components` DOES NOT EXIST. PostgREST returns PGRST205 for
--    it. There is no components table anywhere in this database: the only unit
--    table is `hd_units`, and reefer / APU / chassis are not separate rows.
--
--    So per-unit status keys on unit_id ALONE, and `component_type` on the ITEM
--    is what distinguishes a reefer item from a chassis one. A unit can therefore
--    carry a reefer fuel filter and a chassis oil change at the same time,
--    separately tracked, without a components table existing.
--
--    `component_id` is present and NULLABLE so that if a components table is ever
--    built, per-component tracking slots in without another migration. It is the
--    seam, and it is deliberately not wired to anything.
--
-- 2. The real units table is `hd_units` (migration 047), not `fleet_units`.
--    `fleet_units` does not exist either.
--
-- SAFE TO RUN ON A LIVE DATABASE. Two new tables, their RLS, and ONE reference
-- row. Nothing existing is touched and nothing is backfilled.
--
-- IDEMPOTENT.

BEGIN;

-- ─────────────────────────────────────────────────────────────────────────────
-- 1. pm_items — the global reference library
--
-- user_id IS NULL means a GLOBAL row: field knowledge that applies to everyone's
-- Thermo King, shipped with the product. A non-null user_id is a shop's own
-- private item. Both are readable by the shop; only its own are writable.
-- ─────────────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.pm_items (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),

  -- NULL = global reference row, visible to every subscriber.
  user_id           UUID REFERENCES auth.users(id) ON DELETE CASCADE,

  name              TEXT NOT NULL,
  part_number       TEXT,

  -- reefer | apu | chassis. Free text rather than an enum so a fourth kind
  -- (hydraulics, liftgate) needs a row and not a migration.
  component_type    TEXT NOT NULL,

  -- Empty or NULL means "every model". A list means only those models.
  -- TEXT[] rather than a join table: these are manufacturer model strings a tech
  -- reads off a nameplate, not entities with their own identity.
  applies_to_models TEXT[],

  interval_hours    INTEGER,
  interval_months   INTEGER,
  -- How long before it is due the tech should be warned. Months, matching
  -- interval_months, because a warning measured in hours on a months-only item
  -- would never fire.
  warn_months       INTEGER,

  -- 'hours' | 'months' | 'first_of_either'. Which clock decides.
  interval_rule     TEXT NOT NULL DEFAULT 'first_of_either',

  -- Shown to the TECH, not the customer. The reason the interval exists, in the
  -- words of someone who has seen it fail.
  why               TEXT,
  is_critical       BOOLEAN NOT NULL DEFAULT false,

  created_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at        TIMESTAMPTZ NOT NULL DEFAULT now()
);

COMMENT ON COLUMN public.pm_items.user_id IS
  'NULL = global reference row shipped with the product. Non-null = one shop''s private item.';
COMMENT ON COLUMN public.pm_items.interval_rule IS
  'hours | months | first_of_either. first_of_either is the honest default: a part ages whether or not the unit runs.';
COMMENT ON COLUMN public.pm_items.applies_to_models IS
  'NULL or empty = applies to every model. Matched case-insensitively against hd_units.model.';

-- A shop cannot have two items with the same name for the same component type.
-- Global rows are checked separately because user_id IS NULL does not compare
-- equal to itself in a UNIQUE constraint.
CREATE UNIQUE INDEX IF NOT EXISTS pm_items_user_name_idx
  ON public.pm_items (user_id, lower(name), component_type)
  WHERE user_id IS NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS pm_items_global_name_idx
  ON public.pm_items (lower(name), component_type)
  WHERE user_id IS NULL;

CREATE INDEX IF NOT EXISTS pm_items_component_type_idx
  ON public.pm_items (component_type);

-- ─────────────────────────────────────────────────────────────────────────────
-- 2. unit_pm_item_status — one row per unit per item
--
-- NOTHING IS BACKFILLED. A unit with no row for an item has never had that item
-- recorded, which must read as "never recorded" and NOT as "due now" or "done".
-- Those are three different states and only the first one is true.
-- ─────────────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.unit_pm_item_status (
  id                   UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id              UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,

  unit_id              UUID NOT NULL REFERENCES public.hd_units(id) ON DELETE CASCADE,

  -- THE SEAM. There is no components table today (see the header). If one is ever
  -- built, per-component tracking lands here with no migration.
  component_id         UUID,

  pm_item_id           UUID NOT NULL REFERENCES public.pm_items(id) ON DELETE CASCADE,

  -- NULL = never recorded. Deliberately not backfilled.
  last_completed_on    DATE,
  last_completed_hours NUMERIC(12,1),

  -- Stamped when the item is marked complete, from last_completed_* plus the
  -- item's interval. Stored rather than derived so a changed interval does not
  -- silently move the due date of work already done.
  next_due_on          DATE,
  next_due_hours       NUMERIC(12,1),

  created_at           TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at           TIMESTAMPTZ NOT NULL DEFAULT now(),

  -- One status row per unit per item. component_id is in the key so that a future
  -- per-component world does not need the constraint rebuilt; today it is always
  -- NULL, and a UNIQUE over a NULL column still permits exactly one NULL row per
  -- (unit, item) pair in Postgres 15+ ... which it does NOT in earlier versions.
  -- So the real guard is the partial index below, which works on every version.
  CONSTRAINT unit_pm_item_status_unique UNIQUE (unit_id, pm_item_id, component_id)
);

-- The version-independent guard for the common case (component_id IS NULL).
CREATE UNIQUE INDEX IF NOT EXISTS unit_pm_item_status_unit_item_idx
  ON public.unit_pm_item_status (unit_id, pm_item_id)
  WHERE component_id IS NULL;

CREATE INDEX IF NOT EXISTS unit_pm_item_status_user_idx
  ON public.unit_pm_item_status (user_id);

-- The PM-due list and the fleet dashboard count these, so the due lookup is the
-- one that needs to be fast.
CREATE INDEX IF NOT EXISTS unit_pm_item_status_due_on_idx
  ON public.unit_pm_item_status (user_id, next_due_on)
  WHERE next_due_on IS NOT NULL;

CREATE INDEX IF NOT EXISTS unit_pm_item_status_due_hours_idx
  ON public.unit_pm_item_status (user_id, next_due_hours)
  WHERE next_due_hours IS NOT NULL;

-- ─────────────────────────────────────────────────────────────────────────────
-- 3. RLS
--
-- pm_items: everyone READS the global rows and their own; nobody writes a global
-- row through the API. That is on purpose — field knowledge shipped with the
-- product is not something one subscriber can edit for everyone else.
-- ─────────────────────────────────────────────────────────────────────────────
ALTER TABLE public.pm_items            ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.unit_pm_item_status ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS pm_items_select ON public.pm_items;
CREATE POLICY pm_items_select ON public.pm_items
  FOR SELECT USING (user_id IS NULL OR user_id = auth.uid());

DROP POLICY IF EXISTS pm_items_insert ON public.pm_items;
CREATE POLICY pm_items_insert ON public.pm_items
  FOR INSERT WITH CHECK (user_id = auth.uid());

DROP POLICY IF EXISTS pm_items_update ON public.pm_items;
CREATE POLICY pm_items_update ON public.pm_items
  FOR UPDATE USING (user_id = auth.uid()) WITH CHECK (user_id = auth.uid());

DROP POLICY IF EXISTS pm_items_delete ON public.pm_items;
CREATE POLICY pm_items_delete ON public.pm_items
  FOR DELETE USING (user_id = auth.uid());

DROP POLICY IF EXISTS unit_pm_item_status_all ON public.unit_pm_item_status;
CREATE POLICY unit_pm_item_status_all ON public.unit_pm_item_status
  FOR ALL USING (user_id = auth.uid()) WITH CHECK (user_id = auth.uid());

-- ─────────────────────────────────────────────────────────────────────────────
-- 4. SEED — exactly one item, as specified
--
-- A GLOBAL row (user_id NULL): this is field knowledge about Thermo King
-- equipment, not one shop's preference.
--
-- interval_hours IS NULL and interval_rule IS 'months' because that is what the
-- brief specified. WHETHER IT ALSO CARRIES AN HOURS INTERVAL IS STILL OPEN and
-- is NOT invented here — adding a number nobody confirmed is exactly the kind of
-- fabricated field knowledge this table exists to avoid.
--
-- Models are C-600 and S-600 ONLY, for the same reason. Which other models it
-- applies to is the second open question.
-- ─────────────────────────────────────────────────────────────────────────────
INSERT INTO public.pm_items (
  user_id, name, part_number, component_type, applies_to_models,
  interval_hours, interval_months, warn_months, interval_rule, why, is_critical
)
SELECT
  NULL,
  'Fuel filter cartridge',
  '11-9965',
  'reefer',
  ARRAY['Thermo King C-600', 'Thermo King S-600'],
  NULL,   -- STILL OPEN: does it also carry an hours interval?
  4,
  3,
  'months',
  -- ASCII ONLY, DELIBERATELY. This string is DATA a tech reads, and it has to
  -- survive every way a migration might reach the database. An em-dash here was
  -- stored as three cp437 characters when the file was piped through Windows
  -- clip.exe, which reads stdin in the console code page rather than UTF-8:
  -- "starves the engine U+2014" became "starves the engine U+0393 U+00C7 U+00F6".
  -- A hyphen reads the same and cannot be corrupted.
  'Replace at 4 months maximum. Clogged cartridge starves the engine - erratic RPM, '
    || 'idling problems, and the ETV restricts, dropping cooling capacity. Commonly '
    || 'reported as a no-cool complaint with a temperature differential as poor as '
    || '-4 degrees.',
  true
WHERE NOT EXISTS (
  SELECT 1 FROM public.pm_items
  WHERE user_id IS NULL
    AND lower(name) = lower('Fuel filter cartridge')
    AND component_type = 'reefer'
);

COMMIT;

-- ╔═══════════════════════════════════════════════════════════════════════════╗
-- ║ THE NULL CONTRACT                                                         ║
-- ╠═══════════════════════════════════════════════════════════════════════════╣
-- ║   last_completed_on  NULL -> "never recorded". NOT "due now", NOT "done".  ║
-- ║   next_due_on        NULL -> no date clock running for this item/unit      ║
-- ║   next_due_hours     NULL -> no hours clock running                        ║
-- ║   interval_hours     NULL -> this item has no hours interval AT ALL, which ║
-- ║                              is different from "its hours interval is 0"   ║
-- ║   applies_to_models  NULL -> applies to every model                        ║
-- ║   component_id       NULL -> tracked per UNIT, which is all that is        ║
-- ║                              possible today                               ║
-- ║                                                                           ║
-- ║ NOTHING IS BACKFILLED. No unit gets a status row from this migration, so   ║
-- ║ every unit reads "never recorded" for the fuel filter until a tech says    ║
-- ║ otherwise. Inventing a last_completed_on would be inventing maintenance    ║
-- ║ history on equipment that carries people's loads.                          ║
-- ╚═══════════════════════════════════════════════════════════════════════════╝
