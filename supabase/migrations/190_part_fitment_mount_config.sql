-- 190_part_fitment_mount_config.sql
--
-- WHAT IS MISSING. Brock's TK and Carrier belt and filter charts
-- (scripts/data/nwi-fitment-belts-filters.csv) need two things part_fitment cannot
-- hold today.
--
-- 1. mount_type PER FITMENT ROW: what the reefer is MOUNTED ON, truck or trailer. A
--    Supra is a truck reefer; an Ultra is a trailer reefer; both are reefers. One part
--    can fit both: Carrier fuel filter 30-01090-05 fits trailer units (Ultra, TM1000,
--    Vector, 7300) AND truck units (Supra 550 through 960). One value per part is wrong
--    for half its units, and that is the cause of truck parts showing under trailer
--    units. The fitment row is where it belongs. Do not move it to parts.
--
--    This is NOT parts.equipment_type. That column (175) answers "what kind of
--    equipment is this part for" (reefer, truck, trailer, apu, genset) and the Reefer
--    surface filters on it. Using it, or a part_fitment.equipment_type, for the mount
--    would make "truck" and "trailer" mean two things. The chart's column is named
--    equipment_type but holds mount values; it loads into mount_type, and every part
--    from the chart is a reefer part with parts.equipment_type = 'reefer'.
--
-- 2. configuration. Some units take a different part by configuration alone (a
--    Precedent C-600 generator belt is 78-1859 with an alternator and 78-1858 with
--    smart power). Nothing holds that today.
--
-- DATE BOUNDARIES USE THE EXISTING COLUMNS. build_date_from / build_date_before (148)
-- already hold exactly this: read-only Nov 16, 2026, 161 of 20,636 rows have one, and
-- every value is the first of a month marking a build-date break (2021-06-01,
-- 2023-07-01, 2001-01-01, 1985-11-01 ...), from <= build < before. The chart maps onto
-- them with nothing invented: "After 7/2023" -> build_date_from 2023-07-01, "Before
-- 7/2023" -> build_date_before 2023-07-01, "before 2013" -> build_date_before
-- 2013-01-01, "2013 and newer" -> build_date_from 2013-01-01. So no date column is
-- added.
--
-- WHAT THIS DOES. Two nullable TEXT columns on public.part_fitment:
--   mount_type (CHECK truck | trailer, or NULL)
--   configuration
--   - No existing row changes. Every existing row reads NULL in both.
--   - parts.equipment_type and its CHECK are not touched.
--   - No index, trigger, policy or view is touched. part_fitment's RLS policies are
--     per table, so they cover the new columns as they stand. The only constraint
--     added is the new column's own CHECK.
--
-- The DO block checks its own work and raises an error - rolling the whole transaction
-- back - if a column is missing or has the wrong type, the CHECK is missing or allows
-- the wrong values, a part_fitment.equipment_type column exists, the row count moved,
-- or any existing row has a value in a new column.
--
-- APPLIED by hand Nov 16, 2026 (dry run in ROLLBACK, then COMMIT; "190 ok").
-- Plain ASCII. Ends in COMMIT as run; change the last line to ROLLBACK for a dry run.

BEGIN;

CREATE TEMP TABLE _counts_190 ON COMMIT DROP AS
  SELECT (SELECT count(*) FROM public.part_fitment) AS pf_rows;

ALTER TABLE public.part_fitment ADD COLUMN IF NOT EXISTS mount_type    TEXT;
ALTER TABLE public.part_fitment ADD COLUMN IF NOT EXISTS configuration TEXT;

ALTER TABLE public.part_fitment DROP CONSTRAINT IF EXISTS part_fitment_mount_type_check;
ALTER TABLE public.part_fitment ADD CONSTRAINT part_fitment_mount_type_check CHECK (
  mount_type IS NULL OR mount_type IN ('truck', 'trailer'));

COMMENT ON COLUMN public.part_fitment.mount_type IS
  'Migration 190. What the reefer on THIS fitment row is mounted on: truck or trailer. This is the reefer''s mount, NOT parts.equipment_type (what kind of equipment a part is for). Per row, because one part fits both (Carrier 30-01090-05). The counter narrows a unit search on this column; parts.equipment_type is a surface scope filter only. Every part from the belt and filter chart is a reefer part and keeps parts.equipment_type = reefer. NULL = mount not stated by the source.';
COMMENT ON COLUMN public.part_fitment.configuration IS
  'Migration 190. The unit configuration that decides between parts on the same unit (e.g. alternator vs smart power), exactly as charted. NULL = applies to every configuration.';

-- Self-check.
DO $$
DECLARE
  v_cols     INTEGER;
  v_eqcol    INTEGER;
  v_def      TEXT;
  v_before   BIGINT;
  v_after    BIGINT;
  v_filled   BIGINT;
BEGIN
  SELECT count(*) INTO v_cols
  FROM information_schema.columns ic
  WHERE ic.table_schema = 'public'
    AND ic.table_name   = 'part_fitment'
    AND ic.column_name IN ('mount_type', 'configuration')
    AND ic.data_type    = 'text'
    AND ic.is_nullable  = 'YES';
  IF v_cols <> 2 THEN
    RAISE EXCEPTION '190 self-check: expected 2 nullable TEXT columns, found %', v_cols;
  END IF;

  -- The mount must never be stored as an equipment_type on the fitment row.
  SELECT count(*) INTO v_eqcol
  FROM information_schema.columns ic
  WHERE ic.table_schema = 'public'
    AND ic.table_name   = 'part_fitment'
    AND ic.column_name  = 'equipment_type';
  IF v_eqcol <> 0 THEN
    RAISE EXCEPTION '190 self-check: part_fitment.equipment_type exists; the mount belongs in mount_type';
  END IF;

  SELECT pg_get_constraintdef(c.oid) INTO v_def
  FROM pg_constraint c
  WHERE c.conrelid = 'public.part_fitment'::regclass
    AND c.conname  = 'part_fitment_mount_type_check';
  IF v_def IS NULL THEN
    RAISE EXCEPTION '190 self-check: part_fitment_mount_type_check is missing';
  END IF;
  IF v_def NOT LIKE '%''truck''%' OR v_def NOT LIKE '%''trailer''%' THEN
    RAISE EXCEPTION '190 self-check: mount_type CHECK is missing a value: %', v_def;
  END IF;
  IF v_def LIKE '%''reefer''%' OR v_def LIKE '%''apu''%' OR v_def LIKE '%''genset''%' THEN
    RAISE EXCEPTION '190 self-check: mount_type CHECK allows an equipment type: %', v_def;
  END IF;

  SELECT c.pf_rows INTO v_before FROM _counts_190 c;
  SELECT count(*) INTO v_after FROM public.part_fitment pf;
  IF v_after <> v_before THEN
    RAISE EXCEPTION '190 self-check: part_fitment rows moved from % to %', v_before, v_after;
  END IF;

  SELECT count(*) INTO v_filled FROM public.part_fitment pf
  WHERE pf.mount_type IS NOT NULL OR pf.configuration IS NOT NULL;
  IF v_filled <> 0 THEN
    RAISE EXCEPTION '190 self-check: % existing rows have a value in a new column', v_filled;
  END IF;

  RAISE NOTICE '190 ok: mount_type + configuration added, part_fitment rows unchanged at %', v_after;
END $$;

-- Ends in COMMIT as run Nov 16, 2026. Change to ROLLBACK for a dry run.
COMMIT;
