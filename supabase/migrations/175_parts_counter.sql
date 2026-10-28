-- 175: the parts counter's reference columns, on migration 148's tables.
--
-- Step 2 of the parts counter build (decision Oct 27, 2026: ONE store - 148's parts,
-- part_fitment, part_supersession and part_cross_reference - no nwi_* tables).
--
-- WHAT THIS ADDS
--
--   1. A confidence tier on parts, part_fitment, part_supersession and
--      part_cross_reference. The controlled list, in descending trust:
--
--        confirmed       two or more independent sources, or Brock verified it himself
--        oem_matrix      straight off the Carrier or Thermo King matrix
--        field_observed  a tech actually installed it on this model
--        dealer          a dealer listing only
--        derived         built from another number's pattern, never seen in a source
--        unconfirmed     one source only
--        conflict        sources disagree
--
--      148 has only a boolean `verified`. A boolean cannot say "sources disagree" or
--      "one dealer listing", and flattening trust to a boolean is how
--      hd_parts_reference ended up with 960 rows nobody can rely on.
--
--   2. public.engines - one row per engine designation (TK486V, CT4-134DI ...). Shared
--      reference data: signed-in users read it, nobody writes it except the service role.
--
--   3. On part_fitment: match_type (engine | unit_model | bm_range | serial_range),
--      engine_code (references engines), tier, and a BM range (bm_from, bm_to).
--      The 148 rule "a fitment row names something" is widened so a row may be keyed on
--      an engine code or a BM range as well as a model. Every row that passes it today
--      still passes it.
--
--   4. On parts: equipment_type (reefer | truck | trailer | apu | genset), so a surface
--      that sells only reefer work can filter the catalog by data, not by a second code
--      path.
--
-- WHAT THIS DOES NOT DO
--
--   * No backfill. Every new column is NULL on every existing row. In particular the 118
--     parts and 215 fitment rows keep verified as their only trust signal until Brock
--     decides how verified maps onto the tiers (his Carrier chart rows could be
--     confirmed or oem_matrix - that is his call, not this migration's). The app reads
--     confidence when it is set and falls back to verified when it is not.
--   * No row is inserted, updated or deleted. Schema and permissions only.
--   * No BM map. The per-shop BM table has open privacy questions; it is not here.
--
-- SAFE WITH THE NEW UI ALREADY DEPLOYED. Every addition is a nullable column, a new
-- table, or a constraint that every existing row already satisfies. The app detects the
-- columns and works with or without them.
--
-- PERMISSIONS. Every policy here names its role (TO authenticated). engines is
-- revoked from anon and PUBLIC outright, and its write privileges are revoked from
-- authenticated too - TRUNCATE in particular is not subject to row level security.
--
-- Preview and production share one database. Applying this applies it to both.
--
-- The DO block at the end checks its own work and raises an error - rolling the whole
-- transaction back - if any column or constraint is missing, if any existing row
-- changed or any count moved, if any policy on these tables reaches public or anon, if
-- anon can read engines or any parts row, if a signed-in user can no longer read the
-- catalog, or if a signed-in user can write engines.

BEGIN;

-- Counts before anything changes, for the self-check.
CREATE TEMP TABLE _counts_175 ON COMMIT DROP AS
SELECT (SELECT count(*) FROM public.parts)                AS parts,
       (SELECT count(*) FROM public.part_fitment)         AS part_fitment,
       (SELECT count(*) FROM public.part_supersession)    AS part_supersession,
       (SELECT count(*) FROM public.part_cross_reference) AS part_cross_reference;

-- -----------------------------------------------------------------------------
-- 1. engines
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.engines (
  engine_code   TEXT        PRIMARY KEY CHECK (btrim(engine_code) <> ''),
  engine_maker  TEXT,
  base_engine   TEXT,
  tier          TEXT,
  confidence    TEXT        NOT NULL CHECK (confidence IN (
                  'confirmed', 'oem_matrix', 'field_observed', 'dealer',
                  'derived', 'unconfirmed', 'conflict')),
  source_note   TEXT,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

COMMENT ON TABLE public.engines IS
  'Migration 175. One row per engine designation (TK486V, CT4-134DI). Shared reference data: signed-in users read it, only the service role writes it. part_fitment.engine_code references it.';

ALTER TABLE public.engines ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Authenticated read engines" ON public.engines;
CREATE POLICY "Authenticated read engines"
  ON public.engines FOR SELECT TO authenticated USING (true);

REVOKE ALL ON public.engines FROM anon;
REVOKE ALL ON public.engines FROM PUBLIC;
REVOKE INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER ON public.engines FROM authenticated;
GRANT SELECT ON public.engines TO authenticated;
GRANT ALL ON public.engines TO service_role;

-- -----------------------------------------------------------------------------
-- 2. confidence on the four catalog tables
-- -----------------------------------------------------------------------------
ALTER TABLE public.parts                ADD COLUMN IF NOT EXISTS confidence TEXT;
ALTER TABLE public.part_fitment         ADD COLUMN IF NOT EXISTS confidence TEXT;
ALTER TABLE public.part_supersession    ADD COLUMN IF NOT EXISTS confidence TEXT;
ALTER TABLE public.part_cross_reference ADD COLUMN IF NOT EXISTS confidence TEXT;

ALTER TABLE public.parts                DROP CONSTRAINT IF EXISTS parts_confidence_check;
ALTER TABLE public.part_fitment         DROP CONSTRAINT IF EXISTS part_fitment_confidence_check;
ALTER TABLE public.part_supersession    DROP CONSTRAINT IF EXISTS part_supersession_confidence_check;
ALTER TABLE public.part_cross_reference DROP CONSTRAINT IF EXISTS part_cross_reference_confidence_check;

ALTER TABLE public.parts ADD CONSTRAINT parts_confidence_check CHECK (confidence IS NULL OR confidence IN (
  'confirmed', 'oem_matrix', 'field_observed', 'dealer', 'derived', 'unconfirmed', 'conflict'));
ALTER TABLE public.part_fitment ADD CONSTRAINT part_fitment_confidence_check CHECK (confidence IS NULL OR confidence IN (
  'confirmed', 'oem_matrix', 'field_observed', 'dealer', 'derived', 'unconfirmed', 'conflict'));
ALTER TABLE public.part_supersession ADD CONSTRAINT part_supersession_confidence_check CHECK (confidence IS NULL OR confidence IN (
  'confirmed', 'oem_matrix', 'field_observed', 'dealer', 'derived', 'unconfirmed', 'conflict'));
ALTER TABLE public.part_cross_reference ADD CONSTRAINT part_cross_reference_confidence_check CHECK (confidence IS NULL OR confidence IN (
  'confirmed', 'oem_matrix', 'field_observed', 'dealer', 'derived', 'unconfirmed', 'conflict'));

COMMENT ON COLUMN public.parts.confidence IS
  'Migration 175. The trust tier (confirmed > oem_matrix > field_observed > dealer > derived > unconfirmed; conflict = sources disagree). NULL = not yet assessed; the app then falls back to verified. Never infer a tier from verified in SQL - that mapping is a decision.';
COMMENT ON COLUMN public.part_fitment.confidence IS
  'Migration 175. Trust tier for THIS fitment claim. See parts.confidence.';
COMMENT ON COLUMN public.part_supersession.confidence IS
  'Migration 175. Trust tier for this old -> new link. The counter follows only confirmed and oem_matrix links; anything weaker is shown as "reported replaced by", never substituted.';
COMMENT ON COLUMN public.part_cross_reference.confidence IS
  'Migration 175. Trust tier for this cross. See parts.confidence.';

-- -----------------------------------------------------------------------------
-- 3. equipment_type on parts
-- -----------------------------------------------------------------------------
ALTER TABLE public.parts ADD COLUMN IF NOT EXISTS equipment_type TEXT;
ALTER TABLE public.parts DROP CONSTRAINT IF EXISTS parts_equipment_type_check;
ALTER TABLE public.parts ADD CONSTRAINT parts_equipment_type_check CHECK (
  equipment_type IS NULL OR equipment_type IN ('reefer', 'truck', 'trailer', 'apu', 'genset'));

COMMENT ON COLUMN public.parts.equipment_type IS
  'Migration 175. What the part goes on. The Reefer surface shows reefer parts; NULL is treated as reefer because every row loaded before 175 came from reefer sources. Set it when non-reefer parts are loaded.';

-- -----------------------------------------------------------------------------
-- 4. match type, engine, tier and BM range on part_fitment
-- -----------------------------------------------------------------------------
ALTER TABLE public.part_fitment ADD COLUMN IF NOT EXISTS match_type  TEXT;
ALTER TABLE public.part_fitment ADD COLUMN IF NOT EXISTS engine_code TEXT;
ALTER TABLE public.part_fitment ADD COLUMN IF NOT EXISTS tier        TEXT;
ALTER TABLE public.part_fitment ADD COLUMN IF NOT EXISTS bm_from     TEXT;
ALTER TABLE public.part_fitment ADD COLUMN IF NOT EXISTS bm_to       TEXT;

ALTER TABLE public.part_fitment DROP CONSTRAINT IF EXISTS part_fitment_engine_code_fkey;
ALTER TABLE public.part_fitment ADD CONSTRAINT part_fitment_engine_code_fkey
  FOREIGN KEY (engine_code) REFERENCES public.engines (engine_code)
  ON UPDATE CASCADE ON DELETE SET NULL;

ALTER TABLE public.part_fitment DROP CONSTRAINT IF EXISTS part_fitment_match_type_check;
ALTER TABLE public.part_fitment ADD CONSTRAINT part_fitment_match_type_check CHECK (
  match_type IS NULL OR match_type IN ('engine', 'unit_model', 'bm_range', 'serial_range'));

-- A row that says how it matches must carry the thing it matches on.
ALTER TABLE public.part_fitment DROP CONSTRAINT IF EXISTS part_fitment_match_type_has_key;
ALTER TABLE public.part_fitment ADD CONSTRAINT part_fitment_match_type_has_key CHECK (
     match_type IS NULL
  OR (match_type = 'unit_model'   AND unit_model IS NOT NULL)
  OR (match_type = 'engine'       AND (engine_code IS NOT NULL OR engine_model IS NOT NULL))
  OR (match_type = 'bm_range'     AND bm_from IS NOT NULL)
  OR (match_type = 'serial_range' AND (serial_from IS NOT NULL OR serial_before IS NOT NULL)));

ALTER TABLE public.part_fitment DROP CONSTRAINT IF EXISTS part_fitment_bm_range_check;
ALTER TABLE public.part_fitment ADD CONSTRAINT part_fitment_bm_range_check CHECK (
  bm_to IS NULL OR bm_from IS NOT NULL);

-- 148's rule, widened: a row may name an engine code or a BM range instead of a model.
-- Strictly looser than before, so every existing row still passes.
ALTER TABLE public.part_fitment DROP CONSTRAINT IF EXISTS part_fitment_names_something;
ALTER TABLE public.part_fitment ADD CONSTRAINT part_fitment_names_something CHECK (
  num_nonnulls(unit_model, engine_model, compressor_model, engine_code, bm_from) >= 1);

CREATE INDEX IF NOT EXISTS part_fitment_engine_code_idx ON public.part_fitment (engine_code) WHERE engine_code IS NOT NULL;
CREATE INDEX IF NOT EXISTS part_fitment_bm_from_idx     ON public.part_fitment (upper(bm_from)) WHERE bm_from IS NOT NULL;

COMMENT ON COLUMN public.part_fitment.match_type IS
  'Migration 175. How this row matches a unit: engine, unit_model, bm_range or serial_range. Oil, fuel and water-separator filters follow the engine; air filters follow the unit box. NULL on rows loaded before 175 - the app infers from which key is set.';
COMMENT ON COLUMN public.part_fitment.engine_code IS
  'Migration 175. The engine designation from public.engines. engine_model (148) stays as the text the source printed.';
COMMENT ON COLUMN public.part_fitment.bm_from IS
  'Migration 175. Thermo King BM number range start (inclusive). One BM is one build - never generalize a BM to another.';
COMMENT ON COLUMN public.part_fitment.bm_to IS
  'Migration 175. BM range end (inclusive). Requires bm_from.';

-- -----------------------------------------------------------------------------
-- 5. Self-check. Any failure rolls the whole transaction back.
-- -----------------------------------------------------------------------------
DO $$
DECLARE
  c          RECORD;
  missing    TEXT;
  n          BIGINT;
  open_to    INTEGER;
  t          TEXT;
  denied     BOOLEAN;
  owner_n    BIGINT;
  role_n     BIGINT;
BEGIN
  -- Every new column exists.
  FOR missing IN
    SELECT x FROM unnest(ARRAY[
      'parts.confidence', 'parts.equipment_type',
      'part_fitment.confidence', 'part_fitment.match_type', 'part_fitment.engine_code',
      'part_fitment.tier', 'part_fitment.bm_from', 'part_fitment.bm_to',
      'part_supersession.confidence', 'part_cross_reference.confidence',
      'engines.engine_code', 'engines.confidence']) AS x
    WHERE NOT EXISTS (
      SELECT 1 FROM information_schema.columns
       WHERE table_schema = 'public'
         AND table_name  = split_part(x, '.', 1)
         AND column_name = split_part(x, '.', 2))
  LOOP
    RAISE EXCEPTION '175: column % is missing - nothing applied', missing;
  END LOOP;

  -- Every new constraint exists.
  FOR missing IN
    SELECT x FROM unnest(ARRAY[
      'parts_confidence_check', 'parts_equipment_type_check',
      'part_fitment_confidence_check', 'part_fitment_match_type_check',
      'part_fitment_match_type_has_key', 'part_fitment_bm_range_check',
      'part_fitment_names_something', 'part_fitment_engine_code_fkey',
      'part_supersession_confidence_check', 'part_cross_reference_confidence_check']) AS x
    WHERE NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = x)
  LOOP
    RAISE EXCEPTION '175: constraint % is missing - nothing applied', missing;
  END LOOP;

  -- No existing row changed: counts are the same and every new column is NULL.
  SELECT * INTO c FROM _counts_175;
  IF (SELECT count(*) FROM public.parts)                <> c.parts
  OR (SELECT count(*) FROM public.part_fitment)         <> c.part_fitment
  OR (SELECT count(*) FROM public.part_supersession)    <> c.part_supersession
  OR (SELECT count(*) FROM public.part_cross_reference) <> c.part_cross_reference THEN
    RAISE EXCEPTION '175: a row count changed - nothing applied';
  END IF;
  SELECT (SELECT count(*) FROM public.parts WHERE confidence IS NOT NULL OR equipment_type IS NOT NULL)
       + (SELECT count(*) FROM public.part_fitment
           WHERE confidence IS NOT NULL OR match_type IS NOT NULL OR engine_code IS NOT NULL
              OR tier IS NOT NULL OR bm_from IS NOT NULL OR bm_to IS NOT NULL)
       + (SELECT count(*) FROM public.part_supersession    WHERE confidence IS NOT NULL)
       + (SELECT count(*) FROM public.part_cross_reference WHERE confidence IS NOT NULL)
    INTO n;
  IF n <> 0 THEN
    RAISE EXCEPTION '175: % existing row(s) have a value in a new column - nothing applied', n;
  END IF;
  IF (SELECT count(*) FROM public.engines) <> 0 THEN
    RAISE EXCEPTION '175: engines is not empty - this migration loads no data - nothing applied';
  END IF;

  -- No policy on these tables reaches public or anon; engines has only a SELECT policy.
  SELECT count(*) INTO open_to
    FROM pg_policies
   WHERE schemaname = 'public'
     AND tablename IN ('parts', 'part_fitment', 'part_supersession', 'part_cross_reference', 'engines')
     AND ('public' = ANY (roles) OR 'anon' = ANY (roles));
  IF open_to > 0 THEN
    RAISE EXCEPTION '175: % policy(ies) on the catalog tables reach public or anon - nothing applied', open_to;
  END IF;
  IF EXISTS (SELECT 1 FROM pg_policies
              WHERE schemaname = 'public' AND tablename = 'engines' AND cmd <> 'SELECT') THEN
    RAISE EXCEPTION '175: engines has a policy that can write - nothing applied';
  END IF;
  IF (SELECT relrowsecurity FROM pg_class WHERE oid = 'public.engines'::regclass) IS DISTINCT FROM true THEN
    RAISE EXCEPTION '175: row level security is not on for engines - nothing applied';
  END IF;
  IF has_table_privilege('anon', 'public.engines', 'SELECT') THEN
    RAISE EXCEPTION '175: anon can select engines - nothing applied';
  END IF;
  IF NOT has_table_privilege('authenticated', 'public.engines', 'SELECT') THEN
    RAISE EXCEPTION '175: authenticated cannot select engines - nothing applied';
  END IF;

  -- Live test as anon: no catalog row comes back.
  FOREACH t IN ARRAY ARRAY['parts', 'part_fitment', 'part_supersession', 'part_cross_reference'] LOOP
    SET LOCAL ROLE anon;
    EXECUTE format('SELECT count(*) FROM public.%I', t) INTO role_n;
    RESET ROLE;
    IF role_n <> 0 THEN
      RAISE EXCEPTION '175: anon reads % row(s) of % - nothing applied', role_n, t;
    END IF;
  END LOOP;

  -- Live test as anon: engines is refused outright.
  denied := false;
  SET LOCAL ROLE anon;
  BEGIN
    PERFORM count(*) FROM public.engines;
  EXCEPTION WHEN insufficient_privilege THEN
    denied := true;
  END;
  RESET ROLE;
  IF NOT denied THEN
    RAISE EXCEPTION '175: anon was not refused on engines - nothing applied';
  END IF;

  -- Live test as a signed-in user: the whole catalog still reads.
  FOREACH t IN ARRAY ARRAY['parts', 'part_fitment', 'part_supersession', 'part_cross_reference', 'engines'] LOOP
    EXECUTE format('SELECT count(*) FROM public.%I', t) INTO owner_n;
    SET LOCAL ROLE authenticated;
    EXECUTE format('SELECT count(*) FROM public.%I', t) INTO role_n;
    RESET ROLE;
    IF role_n <> owner_n THEN
      RAISE EXCEPTION '175: a signed-in user reads % of % rows in % - nothing applied', role_n, owner_n, t;
    END IF;
  END LOOP;

  -- Live test as a signed-in user: engines cannot be written.
  denied := false;
  SET LOCAL ROLE authenticated;
  BEGIN
    INSERT INTO public.engines (engine_code, confidence) VALUES ('ZZ-175-PROBE', 'unconfirmed');
  EXCEPTION WHEN insufficient_privilege THEN
    denied := true;
  END;
  RESET ROLE;
  IF NOT denied THEN
    RAISE EXCEPTION '175: a signed-in user could insert into engines - nothing applied';
  END IF;
END $$;

-- Check (last, so it is the result the editor shows). Expect 12 rows, every one with
-- rows_with_value 0: the new columns exist and nothing has been filled in.
SELECT 'parts.confidence'            AS new_column, count(*) FILTER (WHERE confidence     IS NOT NULL) AS rows_with_value FROM public.parts
UNION ALL SELECT 'parts.equipment_type',          count(*) FILTER (WHERE equipment_type IS NOT NULL) FROM public.parts
UNION ALL SELECT 'part_fitment.confidence',       count(*) FILTER (WHERE confidence     IS NOT NULL) FROM public.part_fitment
UNION ALL SELECT 'part_fitment.match_type',       count(*) FILTER (WHERE match_type     IS NOT NULL) FROM public.part_fitment
UNION ALL SELECT 'part_fitment.engine_code',      count(*) FILTER (WHERE engine_code    IS NOT NULL) FROM public.part_fitment
UNION ALL SELECT 'part_fitment.tier',             count(*) FILTER (WHERE tier           IS NOT NULL) FROM public.part_fitment
UNION ALL SELECT 'part_fitment.bm_from',          count(*) FILTER (WHERE bm_from        IS NOT NULL) FROM public.part_fitment
UNION ALL SELECT 'part_fitment.bm_to',            count(*) FILTER (WHERE bm_to          IS NOT NULL) FROM public.part_fitment
UNION ALL SELECT 'part_supersession.confidence',  count(*) FILTER (WHERE confidence     IS NOT NULL) FROM public.part_supersession
UNION ALL SELECT 'part_cross_reference.confidence', count(*) FILTER (WHERE confidence   IS NOT NULL) FROM public.part_cross_reference
UNION ALL SELECT 'engines (rows)',                count(*) FROM public.engines
UNION ALL SELECT 'engines anon_can_select',       CASE WHEN has_table_privilege('anon', 'public.engines', 'SELECT') THEN 1 ELSE 0 END;

COMMIT;
