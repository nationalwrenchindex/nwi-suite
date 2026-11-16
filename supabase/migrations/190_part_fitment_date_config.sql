-- 190_part_fitment_date_config.sql
--
-- WHAT IS MISSING. Brock's TK and Carrier belt and filter charts
-- (scripts/data/nwi-fitment-belts-filters.csv) split some fitments by a date boundary
-- and some by a configuration (a Precedent C-600 generator belt is one part with an
-- alternator and another with smart power). part_fitment has serial_from,
-- serial_before, bm_from, bm_to and engine_model, but nowhere to hold either one as
-- charted.
--
-- build_date_from / build_date_before (148) are DATE columns. A chart boundary such as
-- "11/1985" or "before 1998" is not a calendar day, and forcing it into one would
-- invent a day the chart never gave. The new date columns are TEXT and hold the
-- boundary exactly as charted; the DATE columns are left as they are.
--
-- WHAT THIS DOES. Three nullable TEXT columns on public.part_fitment:
--   date_from, date_before, configuration
--   - No existing row changes. Every existing row reads NULL in all three.
--   - No index, trigger, constraint, policy or view is touched. part_fitment's RLS
--     policies are per table, so they cover the new columns as they stand.
--
-- The DO block checks its own work and raises an error - rolling the whole transaction
-- back - if a column is missing or has the wrong type, the row count moved, or any
-- existing row has a value in a new column.
--
-- Plain ASCII. Ends in ROLLBACK for a dry run; change the last line to COMMIT to apply.

BEGIN;

CREATE TEMP TABLE _counts_190 ON COMMIT DROP AS
  SELECT (SELECT count(*) FROM public.part_fitment) AS pf_rows;

ALTER TABLE public.part_fitment ADD COLUMN IF NOT EXISTS date_from     TEXT;
ALTER TABLE public.part_fitment ADD COLUMN IF NOT EXISTS date_before   TEXT;
ALTER TABLE public.part_fitment ADD COLUMN IF NOT EXISTS configuration TEXT;

COMMENT ON COLUMN public.part_fitment.date_from IS
  'Migration 190. First build date this fitment applies to, exactly as charted (TEXT, not a DATE: a chart boundary is not a calendar day). NULL = no lower date bound.';
COMMENT ON COLUMN public.part_fitment.date_before IS
  'Migration 190. Build date this fitment stops applying BEFORE, exactly as charted. NULL = no upper date bound.';
COMMENT ON COLUMN public.part_fitment.configuration IS
  'Migration 190. The unit configuration that decides between parts on the same unit (e.g. alternator vs smart power), exactly as charted. NULL = applies to every configuration.';

-- Self-check.
DO $$
DECLARE
  v_cols     INTEGER;
  v_before   BIGINT;
  v_after    BIGINT;
  v_filled   BIGINT;
BEGIN
  SELECT count(*) INTO v_cols
  FROM information_schema.columns ic
  WHERE ic.table_schema = 'public'
    AND ic.table_name   = 'part_fitment'
    AND ic.column_name IN ('date_from', 'date_before', 'configuration')
    AND ic.data_type    = 'text'
    AND ic.is_nullable  = 'YES';
  IF v_cols <> 3 THEN
    RAISE EXCEPTION '190 self-check: expected 3 nullable TEXT columns, found %', v_cols;
  END IF;

  SELECT c.pf_rows INTO v_before FROM _counts_190 c;
  SELECT count(*) INTO v_after FROM public.part_fitment pf;
  IF v_after <> v_before THEN
    RAISE EXCEPTION '190 self-check: part_fitment rows moved from % to %', v_before, v_after;
  END IF;

  SELECT count(*) INTO v_filled FROM public.part_fitment pf
  WHERE pf.date_from IS NOT NULL OR pf.date_before IS NOT NULL OR pf.configuration IS NOT NULL;
  IF v_filled <> 0 THEN
    RAISE EXCEPTION '190 self-check: % existing rows have a value in a new column', v_filled;
  END IF;

  RAISE NOTICE '190 ok: 3 columns added, part_fitment rows unchanged at %', v_after;
END $$;

-- Dry run. Change to COMMIT to apply.
ROLLBACK;
