-- =============================================================================
-- 148  The parts system: catalog, fitment, supersessions, crosses, inventory
-- =============================================================================
--
-- ADDITIVE ONLY. Five new tables and two helper functions. Nothing is dropped,
-- nothing is altered, no existing row is touched. hd_parts, hd_parts_cross_ref and
-- hd_parts_reference are left exactly as they are and keep serving the QuickWrench
-- Parts Ref panel while this is populated alongside them.
--
-- -- WHY A NEW SET OF TABLES RATHER THAN A WIDER hd_parts ---------------------
--
-- The audit of the live data found 399 fields holding a GROUP or a RANGE in one
-- string - "Supra 650,Supra 750,Supra 844,Supra 850", "SB series trailer",
-- "Supra 6xx". A search can never answer "does this fit THIS unit" against those,
-- and no amount of widening hd_parts fixes it, because the shape is the problem:
-- hd_parts.unit_models is a TEXT[] whose entries are themselves lists, and
-- hd_parts_reference.unit_family is a comma-separated string.
--
-- So fitment moves to one row per part per model, and the structure REFUSES the old
-- shape rather than merely discouraging it - see is_single_model below. A constraint
-- is the only kind of rule that survives the next person in a hurry.
--
-- -- WHAT IS DELIBERATELY NOT HERE -------------------------------------------
--
--   * No change to invoicing. Parts reach a work order as line items through the
--     path that already exists, priced by the shop's recorded markup. Nothing in
--     this migration computes money.
--   * No backfill out of hd_parts or hd_parts_reference. A migration that copied
--     399 group strings into a table designed to forbid them would either fail or
--     silently mangle them. The loader expands them, reports what it produced, and
--     leaves what it cannot source OUT.
--   * No invented fitment. part_fitment.verified and .source exist so a row can say
--     where it came from, and the screens show "unverified" to the technician,
--     because a tech needs to know whether to trust a number before it goes in a
--     unit.

BEGIN;

-- -----------------------------------------------------------------------------
-- 0. Helpers
-- -----------------------------------------------------------------------------

-- The normalized form of a part number: uppercase, every separator removed.
-- IMMUTABLE so it can back a generated column, which is the point - a normalized
-- value computed by the application can drift from the printed number it came
-- from, and then "78-1341" and "781341" stop being the same part.
CREATE OR REPLACE FUNCTION public.normalize_part_number(value TEXT)
RETURNS TEXT
LANGUAGE sql
IMMUTABLE
STRICT
PARALLEL SAFE
AS $$
  SELECT regexp_replace(upper(value), '[^A-Z0-9]', '', 'g');
$$;

COMMENT ON FUNCTION public.normalize_part_number(TEXT) IS
  'Uppercase and strip every non-alphanumeric character. 78-1341, 781341 and "78 1341" all collapse to 781341. IMMUTABLE because generated columns depend on it.';

-- A belt section, reduced to the one name that identifies the cross.
--
-- XPZ and SPZ are the same section under two naming systems, so a belt printed
-- XPZ1150 crosses to an SPZ1150 with no table row needed. Same for the cogged
-- 3VX / XPA pairings this chart uses. Anything unrecognised is returned uppercased
-- and unchanged rather than guessed at.
CREATE OR REPLACE FUNCTION public.canonical_belt_section(value TEXT)
RETURNS TEXT
LANGUAGE sql
IMMUTABLE
PARALLEL SAFE
AS $$
  SELECT CASE
    WHEN value IS NULL OR btrim(value) = '' THEN NULL
    WHEN upper(regexp_replace(value, '[^A-Za-z]', '', 'g')) IN ('XPZ', 'SPZ') THEN 'XPZ/SPZ'
    WHEN upper(regexp_replace(value, '[^A-Za-z]', '', 'g')) IN ('XPA', 'SPA') THEN 'XPA/SPA'
    WHEN upper(regexp_replace(value, '[^A-Za-z]', '', 'g')) IN ('XPB', 'SPB') THEN 'XPB/SPB'
    ELSE upper(btrim(value))
  END;
$$;

COMMENT ON FUNCTION public.canonical_belt_section(TEXT) IS
  'Collapse belt section aliases so a cross can be derived without a table row: XPZ and SPZ are one section, likewise XPA/SPA and XPB/SPB. Unrecognised sections are passed through uppercased, never guessed.';

-- Is this a SINGLE model, or a group masquerading as one?
--
-- This is the constraint that stops the thing the audit found. A comma list, a
-- slash list, a trailing plus, a numeric range, or the words "series" / "family"
-- all mean the row is standing in for several models at once, and a model search
-- against it can only guess. The loader must expand those into one row each.
--
-- "6xx" is rejected for the same reason: Supra 6xx is a family, not a unit anyone
-- owns.
CREATE OR REPLACE FUNCTION public.is_single_model(value TEXT)
RETURNS BOOLEAN
LANGUAGE sql
IMMUTABLE
PARALLEL SAFE
AS $$
  SELECT CASE
    WHEN value IS NULL THEN TRUE
    WHEN btrim(value) = '' THEN FALSE
    WHEN value LIKE '%,%' THEN FALSE
    WHEN value LIKE '%/%' THEN FALSE
    WHEN value LIKE '%+%' THEN FALSE
    WHEN value ~* '(^|[^a-z])(series|family|all|various|universal|and|thru|through)([^a-z]|$)' THEN FALSE
    WHEN value ~* '[0-9]x{2,}' THEN FALSE
    WHEN value ~ '[0-9]{2,}[[:space:]]*-[[:space:]]*[0-9]{2,}' THEN FALSE
    ELSE TRUE
  END;
$$;

COMMENT ON FUNCTION public.is_single_model(TEXT) IS
  'FALSE when a model field holds a group rather than one model: a comma or slash list, a trailing +, a numeric range, the words series/family/all, or an x-masked family like Supra 6xx. Used by CHECK constraints on part_fitment so the old one-string-many-models shape cannot come back.';

-- -----------------------------------------------------------------------------
-- 1. parts - the catalog
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.parts (
  id                      UUID        PRIMARY KEY DEFAULT gen_random_uuid(),

  -- As PRINTED on the part and in the book. This is what a technician reads out.
  part_number             TEXT        NOT NULL,

  -- GENERATED, never written by the application, so it cannot disagree with the
  -- printed number above. Every lookup matches on this.
  part_number_normalized  TEXT        GENERATED ALWAYS AS (public.normalize_part_number(part_number)) STORED,

  manufacturer            TEXT        NOT NULL,
  part_type               TEXT        NOT NULL,
  description             TEXT,

  -- Belts. belt_section is as printed ("XPZ 1150", "B47", "3VX630"); the canonical
  -- form is derived so XPZ and SPZ cross without a table row.
  belt_section            TEXT,
  belt_section_canonical  TEXT        GENERATED ALWAYS AS (public.canonical_belt_section(belt_section)) STORED,
  belt_length             TEXT,
  belt_profile            TEXT        CHECK (belt_profile IS NULL OR belt_profile IN ('cogged', 'plain')),

  notes                   TEXT,

  -- NOT a default-true flag. An unverified part says so on screen.
  verified                BOOLEAN     NOT NULL DEFAULT FALSE,
  source                  TEXT        NOT NULL,

  created_at              TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at              TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Two manufacturers may print the same number, so uniqueness is per manufacturer
-- and on the NORMALIZED number - which is what makes 78-1341 and 781341 one part
-- instead of two.
CREATE UNIQUE INDEX IF NOT EXISTS parts_mfr_normalized_key
  ON public.parts (manufacturer, part_number_normalized);

CREATE INDEX IF NOT EXISTS parts_normalized_idx    ON public.parts (part_number_normalized);
CREATE INDEX IF NOT EXISTS parts_type_idx          ON public.parts (part_type);
CREATE INDEX IF NOT EXISTS parts_belt_section_idx  ON public.parts (belt_section_canonical) WHERE belt_section_canonical IS NOT NULL;

COMMENT ON TABLE public.parts IS
  'The parts catalog. One row per physical part per manufacturer. part_number is as printed; part_number_normalized is generated and is what every search matches on.';
COMMENT ON COLUMN public.parts.verified IS
  'TRUE only when the row came from a source we stand behind. DEFAULTS TO FALSE on purpose: hd_parts_reference.verified defaults to true, which made 960 rows read as trusted because nobody had said otherwise.';
COMMENT ON COLUMN public.parts.source IS
  'Where this row came from - a vendor listing, a manufacturer chart, a technician. NOT NULL because a part with no provenance cannot be judged by the person installing it.';
COMMENT ON COLUMN public.parts.belt_section_canonical IS
  'Generated. Collapses XPZ/SPZ and the other alias pairs so a belt cross can be derived from section plus length with no cross-reference row.';

-- -----------------------------------------------------------------------------
-- 2. part_fitment - one row per part per model. NEVER a list.
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.part_fitment (
  id                 UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  part_id            UUID        NOT NULL REFERENCES public.parts(id) ON DELETE CASCADE,

  -- A part may fit by ANY of the three, which is why they are three columns and not
  -- one. 22-1376 fits the X426 and X430 COMPRESSORS, not a unit. 78-1366 fits by the
  -- TK370 ENGINE, across three different unit models. Storing either as a unit_model
  -- would be a lie about what the part fits.
  unit_model         TEXT        CHECK (public.is_single_model(unit_model)),
  engine_model       TEXT        CHECK (public.is_single_model(engine_model)),
  compressor_model   TEXT        CHECK (public.is_single_model(compressor_model)),

  -- At least one of the three must say something. A fitment row that names nothing
  -- is the catch-all this whole table exists to replace.
  CONSTRAINT part_fitment_names_something
    CHECK (num_nonnulls(unit_model, engine_model, compressor_model) >= 1),

  -- Serial and build-date breaks. "BEFORE 11/1985" is a real distinction in this
  -- data and the result has to say which side it is for.
  serial_from        TEXT,
  serial_before      TEXT,
  build_date_from    DATE,
  build_date_before  DATE,

  qty_per_unit       INTEGER     CHECK (qty_per_unit IS NULL OR qty_per_unit > 0),
  note               TEXT,

  verified           BOOLEAN     NOT NULL DEFAULT FALSE,
  source             TEXT        NOT NULL,

  created_at         TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS part_fitment_part_idx       ON public.part_fitment (part_id);
CREATE INDEX IF NOT EXISTS part_fitment_unit_idx       ON public.part_fitment (upper(unit_model))       WHERE unit_model IS NOT NULL;
CREATE INDEX IF NOT EXISTS part_fitment_engine_idx     ON public.part_fitment (upper(engine_model))     WHERE engine_model IS NOT NULL;
CREATE INDEX IF NOT EXISTS part_fitment_compressor_idx ON public.part_fitment (upper(compressor_model)) WHERE compressor_model IS NOT NULL;

COMMENT ON TABLE public.part_fitment IS
  'One row per part per model. The CHECK constraints refuse a group or a range in any model field, which is the defect this table was built to end: the live data held 399 such fields.';
COMMENT ON COLUMN public.part_fitment.unit_model IS
  'ONE unit model, never a list. "Supra 650,Supra 750" is two rows. is_single_model rejects the list form outright.';
COMMENT ON COLUMN public.part_fitment.compressor_model IS
  'Set when the part fits a COMPRESSOR rather than a unit - 22-1376 fits the X426 and X430. Two rows, one per compressor, and no unit_model on either.';
COMMENT ON COLUMN public.part_fitment.serial_before IS
  'Exclusive upper bound: this fitment applies to units built BEFORE this serial. With serial_from it gives the split a result must declare and a typed serial must filter on.';
COMMENT ON COLUMN public.part_fitment.verified IS
  'FALSE for vendor-listing rows, TRUE only for fitment from a manufacturer chart. The screens print "unverified" from this - it is not decoration.';

-- -----------------------------------------------------------------------------
-- 3. part_supersession - an old number must still find the part
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.part_supersession (
  id                    UUID        PRIMARY KEY DEFAULT gen_random_uuid(),

  old_number            TEXT        NOT NULL,
  new_number            TEXT        NOT NULL,
  old_number_normalized TEXT        GENERATED ALWAYS AS (public.normalize_part_number(old_number)) STORED,
  new_number_normalized TEXT        GENERATED ALWAYS AS (public.normalize_part_number(new_number)) STORED,

  manufacturer          TEXT        NOT NULL,
  note                  TEXT,
  verified              BOOLEAN     NOT NULL DEFAULT FALSE,
  source                TEXT        NOT NULL,

  created_at            TIMESTAMPTZ NOT NULL DEFAULT now(),

  -- A part superseding itself would make the lookup loop forever.
  CONSTRAINT part_supersession_not_self
    CHECK (public.normalize_part_number(old_number) <> public.normalize_part_number(new_number))
);

CREATE UNIQUE INDEX IF NOT EXISTS part_supersession_pair_key
  ON public.part_supersession (manufacturer, old_number_normalized, new_number_normalized);

CREATE INDEX IF NOT EXISTS part_supersession_old_idx ON public.part_supersession (old_number_normalized);
CREATE INDEX IF NOT EXISTS part_supersession_new_idx ON public.part_supersession (new_number_normalized);

COMMENT ON TABLE public.part_supersession IS
  'Old number to new number. Searching a superseded number must find the part AND say what replaced it - a counter that returns nothing for a number printed on the part in hand is worse than useless. Not a FK to parts: the old number is frequently a part we no longer stock and never cataloged.';
COMMENT ON COLUMN public.part_supersession.new_number IS
  'Deliberately TEXT and not a FK. A supersession is often known before the replacement is cataloged, and losing the knowledge to a missing row would be the wrong trade.';

-- -----------------------------------------------------------------------------
-- 4. part_cross_reference - OEM to aftermarket
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.part_cross_reference (
  id                      UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  part_id                 UUID        NOT NULL REFERENCES public.parts(id) ON DELETE CASCADE,

  brand                   TEXT        NOT NULL,
  brand_number            TEXT        NOT NULL,
  brand_number_normalized TEXT        GENERATED ALWAYS AS (public.normalize_part_number(brand_number)) STORED,

  verified                BOOLEAN     NOT NULL DEFAULT FALSE,
  source                  TEXT        NOT NULL,

  created_at              TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS part_cross_reference_key
  ON public.part_cross_reference (part_id, brand, brand_number_normalized);

CREATE INDEX IF NOT EXISTS part_cross_reference_number_idx
  ON public.part_cross_reference (brand_number_normalized);

COMMENT ON TABLE public.part_cross_reference IS
  'Rows only for crosses that must be LOOKED UP. A belt cross is DERIVED instead: a B47 is a B47 at Gates, Dayco or Goodyear, so belt_section_canonical plus belt_length answers it with no row here. Storing the derivable ones would mean maintaining nine brand columns of the same fact, which is what hd_parts_reference does today.';
COMMENT ON COLUMN public.part_cross_reference.brand IS
  'One brand per row - NOT a column per brand. hd_parts_reference has nine brand columns, so adding a tenth brand is a migration and an empty cell is indistinguishable from an unknown cross.';

-- -----------------------------------------------------------------------------
-- 5. inventory - per shop, per location
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.inventory (
  id             UUID        PRIMARY KEY DEFAULT gen_random_uuid(),

  -- The catalog is shared; stock is not. Every row below belongs to one shop.
  user_id        UUID        NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  part_id        UUID        NOT NULL REFERENCES public.parts(id)    ON DELETE CASCADE,

  on_hand        INTEGER     NOT NULL DEFAULT 0 CHECK (on_hand >= 0),

  -- NULLABLE ON PURPOSE. NULL means nobody has set a minimum; 0 means the shop
  -- deliberately stocks none of this and wants no reorder prompt. Collapsing those
  -- two into a 0 default would turn every untouched part into a deliberate choice
  -- the owner never made.
  min_qty        INTEGER     CHECK (min_qty IS NULL OR min_qty >= 0),

  bin            TEXT,

  location_type  TEXT        NOT NULL DEFAULT 'shop' CHECK (location_type IN ('shop', 'vehicle')),
  location_name  TEXT,

  last_cost      NUMERIC(10, 2) CHECK (last_cost  IS NULL OR last_cost  >= 0),
  sell_price     NUMERIC(10, 2) CHECK (sell_price IS NULL OR sell_price >= 0),

  created_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at     TIMESTAMPTZ NOT NULL DEFAULT now(),

  -- A service vehicle has to be named, or "on the truck" cannot answer WHICH truck.
  CONSTRAINT inventory_vehicle_is_named
    CHECK (location_type <> 'vehicle' OR (location_name IS NOT NULL AND btrim(location_name) <> ''))
);

-- One stock row per part per location per shop. COALESCE because a NULL
-- location_name would otherwise let the same shop file duplicates.
CREATE UNIQUE INDEX IF NOT EXISTS inventory_part_location_key
  ON public.inventory (user_id, part_id, location_type, COALESCE(location_name, ''));

CREATE INDEX IF NOT EXISTS inventory_user_idx ON public.inventory (user_id);
CREATE INDEX IF NOT EXISTS inventory_part_idx ON public.inventory (part_id);

COMMENT ON TABLE public.inventory IS
  'Stock per shop per location. The parts catalog is shared across all subscribers; what is on the shelf is not, so this is the only table here with RLS by user_id.';
COMMENT ON COLUMN public.inventory.min_qty IS
  'NULL = no minimum set. 0 = the shop deliberately stocks none. These are different answers and the reorder report must not treat them alike.';
COMMENT ON COLUMN public.inventory.sell_price IS
  'An override for this shop. NULL means price it the normal way - last_cost plus the shop markup from settings - so an empty cell never prices a part at zero.';

-- -----------------------------------------------------------------------------
-- 6. Row level security
-- -----------------------------------------------------------------------------
ALTER TABLE public.parts                ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.part_fitment         ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.part_supersession    ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.part_cross_reference ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.inventory            ENABLE ROW LEVEL SECURITY;

-- The catalog is READ-ONLY to subscribers. There is deliberately no INSERT, UPDATE
-- or DELETE policy on the four shared tables: loading and correcting them goes
-- through the service role, which bypasses RLS.
--
-- hd_parts_reference took the other road - "FOR ALL TO authenticated USING (true)"
-- - which lets any one subscriber rewrite the reference library every other
-- subscriber reads. Not repeated here.
DROP POLICY IF EXISTS "Authenticated read parts"            ON public.parts;
DROP POLICY IF EXISTS "Authenticated read part_fitment"     ON public.part_fitment;
DROP POLICY IF EXISTS "Authenticated read part_supersession" ON public.part_supersession;
DROP POLICY IF EXISTS "Authenticated read part_cross_reference" ON public.part_cross_reference;

CREATE POLICY "Authenticated read parts"
  ON public.parts FOR SELECT TO authenticated USING (true);

CREATE POLICY "Authenticated read part_fitment"
  ON public.part_fitment FOR SELECT TO authenticated USING (true);

CREATE POLICY "Authenticated read part_supersession"
  ON public.part_supersession FOR SELECT TO authenticated USING (true);

CREATE POLICY "Authenticated read part_cross_reference"
  ON public.part_cross_reference FOR SELECT TO authenticated USING (true);

-- Stock is the shop's own, read and write.
DROP POLICY IF EXISTS "Owner reads inventory"   ON public.inventory;
DROP POLICY IF EXISTS "Owner writes inventory"  ON public.inventory;
DROP POLICY IF EXISTS "Owner updates inventory" ON public.inventory;
DROP POLICY IF EXISTS "Owner deletes inventory" ON public.inventory;

CREATE POLICY "Owner reads inventory"
  ON public.inventory FOR SELECT TO authenticated USING (auth.uid() = user_id);

CREATE POLICY "Owner writes inventory"
  ON public.inventory FOR INSERT TO authenticated WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Owner updates inventory"
  ON public.inventory FOR UPDATE TO authenticated
  USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Owner deletes inventory"
  ON public.inventory FOR DELETE TO authenticated USING (auth.uid() = user_id);

-- -----------------------------------------------------------------------------
-- 7. Check it
-- -----------------------------------------------------------------------------
-- Expect five rows: parts, part_fitment, part_supersession, part_cross_reference,
-- inventory.
SELECT table_name
FROM   information_schema.tables
WHERE  table_schema = 'public'
  AND  table_name IN ('parts', 'part_fitment', 'part_supersession',
                      'part_cross_reference', 'inventory')
ORDER  BY table_name;

-- Expect the four generated columns, all STORED.
SELECT table_name, column_name, is_generated, generation_expression
FROM   information_schema.columns
WHERE  table_schema = 'public'
  AND  is_generated = 'ALWAYS'
  AND  table_name IN ('parts', 'part_supersession', 'part_cross_reference')
ORDER  BY table_name, column_name;

-- Expect TRUE, TRUE, then FALSE eight times. This is the group-rejecting constraint
-- proving it rejects, before any data is loaded against it.
SELECT public.is_single_model('Supra 660')                AS single_ok,
       public.is_single_model('S-600M')                   AS single_ok_2,
       public.is_single_model('Supra 650,Supra 750')       AS comma_rejected,
       public.is_single_model('V-500/V-520')               AS slash_rejected,
       public.is_single_model('SB100-310+')                AS plus_rejected,
       public.is_single_model('SB series')                 AS series_rejected,
       public.is_single_model('Supra 6xx')                 AS masked_rejected,
       public.is_single_model('all units')                 AS all_rejected,
       public.is_single_model('T-600 and T-800')           AS prose_rejected,
       public.is_single_model('')                          AS empty_rejected;

-- Expect 781341 three times: the normalization that makes those one part.
SELECT public.normalize_part_number('78-1341') AS a,
       public.normalize_part_number('781341')  AS b,
       public.normalize_part_number('78 1341') AS c;

-- Expect XPZ/SPZ twice, then B47.
SELECT public.canonical_belt_section('XPZ 1150') AS xpz,
       public.canonical_belt_section('SPZ1150')  AS spz,
       public.canonical_belt_section('B47')      AS b47;

-- Expect 0, 0, 0, 0, 0. Nothing is loaded by this migration.
SELECT (SELECT count(*) FROM public.parts)                AS parts,
       (SELECT count(*) FROM public.part_fitment)         AS fitment,
       (SELECT count(*) FROM public.part_supersession)    AS supersessions,
       (SELECT count(*) FROM public.part_cross_reference) AS crosses,
       (SELECT count(*) FROM public.inventory)            AS inventory;

-- Expect the four shared tables to have SELECT policies only, and inventory to have
-- all four. A write policy on a shared table here would be the hd_parts_reference
-- mistake repeated.
SELECT tablename, cmd, count(*) AS policies
FROM   pg_policies
WHERE  schemaname = 'public'
  AND  tablename IN ('parts', 'part_fitment', 'part_supersession',
                     'part_cross_reference', 'inventory')
GROUP  BY tablename, cmd
ORDER  BY tablename, cmd;

COMMIT;
