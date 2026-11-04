-- 181: where every catalog row came from - file, sheet and row.
--
-- WHY. The reefer parts load of Nov 4, 2026 brings in rows from seven source files.
-- 148 gave each catalog table one TEXT `source`, enough to name a file but not the
-- sheet or the row inside it, and engines (175) has no source column at all. Without
-- the row, one bad source cannot be found again, checked against its file, or taken
-- back out without redoing the whole load.
--
-- WHAT THIS ADDS. Nullable columns only:
--
--   parts, part_fitment, part_supersession, part_cross_reference
--     source_sheet  TEXT     the sheet inside the file (NULL for a CSV or a document)
--     source_row    INTEGER  the row in that sheet, counting the header as row 1
--
--   engines
--     source        TEXT     the source key, as `source` on the other four tables
--     source_sheet  TEXT
--     source_row    INTEGER
--
-- `source` (148) keeps meaning what it already means: the source KEY. The load writes a
-- neutral key per file (reefer-parts-master, tk-filters-crossref ...), never a retailer
-- or vendor name; data/parts-sources/SOURCES.md maps each key to its file.
--
-- WHAT THIS DOES NOT DO. No row is inserted, updated or deleted. No existing row gets a
-- value: the 985 parts and their fitment keep source as their only provenance. No
-- policy or grant changes - the columns inherit the tables' existing RLS and grants.
--
-- Preview and production share one database. Applying this applies it to both.
--
-- The DO block checks its own work and raises an error - rolling the whole transaction
-- back - if a column is missing, a row count moved, or any existing row has a value in a
-- new column.

BEGIN;

CREATE TEMP TABLE _counts_181 ON COMMIT DROP AS
SELECT (SELECT count(*) FROM public.parts)                AS parts,
       (SELECT count(*) FROM public.part_fitment)         AS part_fitment,
       (SELECT count(*) FROM public.part_supersession)    AS part_supersession,
       (SELECT count(*) FROM public.part_cross_reference) AS part_cross_reference,
       (SELECT count(*) FROM public.engines)              AS engines;

ALTER TABLE public.parts                ADD COLUMN IF NOT EXISTS source_sheet TEXT;
ALTER TABLE public.parts                ADD COLUMN IF NOT EXISTS source_row   INTEGER;
ALTER TABLE public.part_fitment         ADD COLUMN IF NOT EXISTS source_sheet TEXT;
ALTER TABLE public.part_fitment         ADD COLUMN IF NOT EXISTS source_row   INTEGER;
ALTER TABLE public.part_supersession    ADD COLUMN IF NOT EXISTS source_sheet TEXT;
ALTER TABLE public.part_supersession    ADD COLUMN IF NOT EXISTS source_row   INTEGER;
ALTER TABLE public.part_cross_reference ADD COLUMN IF NOT EXISTS source_sheet TEXT;
ALTER TABLE public.part_cross_reference ADD COLUMN IF NOT EXISTS source_row   INTEGER;
ALTER TABLE public.engines              ADD COLUMN IF NOT EXISTS source       TEXT;
ALTER TABLE public.engines              ADD COLUMN IF NOT EXISTS source_sheet TEXT;
ALTER TABLE public.engines              ADD COLUMN IF NOT EXISTS source_row   INTEGER;

COMMENT ON COLUMN public.parts.source_sheet IS
  'Migration 181. The sheet in the source file this row came from; NULL for a CSV or document. With source (the file key) and source_row it finds the exact row.';
COMMENT ON COLUMN public.parts.source_row IS
  'Migration 181. The row in that sheet or file, counting the header as row 1.';
COMMENT ON COLUMN public.part_fitment.source_sheet IS 'Migration 181. See parts.source_sheet.';
COMMENT ON COLUMN public.part_fitment.source_row IS 'Migration 181. See parts.source_row.';
COMMENT ON COLUMN public.part_supersession.source_sheet IS 'Migration 181. See parts.source_sheet.';
COMMENT ON COLUMN public.part_supersession.source_row IS 'Migration 181. See parts.source_row.';
COMMENT ON COLUMN public.part_cross_reference.source_sheet IS 'Migration 181. See parts.source_sheet.';
COMMENT ON COLUMN public.part_cross_reference.source_row IS 'Migration 181. See parts.source_row.';
COMMENT ON COLUMN public.engines.source IS
  'Migration 181. The source key this engine row came from, as parts.source. Never a retailer or vendor name.';
COMMENT ON COLUMN public.engines.source_sheet IS 'Migration 181. See parts.source_sheet.';
COMMENT ON COLUMN public.engines.source_row IS 'Migration 181. See parts.source_row.';

DO $$
DECLARE
  c       RECORD;
  missing TEXT;
  n       BIGINT;
BEGIN
  FOR missing IN
    SELECT x FROM unnest(ARRAY[
      'parts.source_sheet', 'parts.source_row',
      'part_fitment.source_sheet', 'part_fitment.source_row',
      'part_supersession.source_sheet', 'part_supersession.source_row',
      'part_cross_reference.source_sheet', 'part_cross_reference.source_row',
      'engines.source', 'engines.source_sheet', 'engines.source_row']) AS x
    WHERE NOT EXISTS (
      SELECT 1 FROM information_schema.columns
       WHERE table_schema = 'public'
         AND table_name  = split_part(x, '.', 1)
         AND column_name = split_part(x, '.', 2))
  LOOP
    RAISE EXCEPTION '181: column % is missing - nothing applied', missing;
  END LOOP;

  SELECT * INTO c FROM _counts_181;
  IF (SELECT count(*) FROM public.parts)                <> c.parts
  OR (SELECT count(*) FROM public.part_fitment)         <> c.part_fitment
  OR (SELECT count(*) FROM public.part_supersession)    <> c.part_supersession
  OR (SELECT count(*) FROM public.part_cross_reference) <> c.part_cross_reference
  OR (SELECT count(*) FROM public.engines)              <> c.engines THEN
    RAISE EXCEPTION '181: a row count changed - nothing applied';
  END IF;

  SELECT (SELECT count(*) FROM public.parts                WHERE source_sheet IS NOT NULL OR source_row IS NOT NULL)
       + (SELECT count(*) FROM public.part_fitment         WHERE source_sheet IS NOT NULL OR source_row IS NOT NULL)
       + (SELECT count(*) FROM public.part_supersession    WHERE source_sheet IS NOT NULL OR source_row IS NOT NULL)
       + (SELECT count(*) FROM public.part_cross_reference WHERE source_sheet IS NOT NULL OR source_row IS NOT NULL)
       + (SELECT count(*) FROM public.engines              WHERE source IS NOT NULL OR source_sheet IS NOT NULL OR source_row IS NOT NULL)
    INTO n;
  IF n <> 0 THEN
    RAISE EXCEPTION '181: % existing row(s) have a value in a new column - nothing applied', n;
  END IF;
END $$;

-- Check (last, so it is the result the editor shows). Expect 11 rows, every one 0.
SELECT 'parts.source_sheet' AS new_column, count(*) FILTER (WHERE source_sheet IS NOT NULL) AS rows_with_value FROM public.parts
UNION ALL SELECT 'parts.source_row',                count(*) FILTER (WHERE source_row   IS NOT NULL) FROM public.parts
UNION ALL SELECT 'part_fitment.source_sheet',       count(*) FILTER (WHERE source_sheet IS NOT NULL) FROM public.part_fitment
UNION ALL SELECT 'part_fitment.source_row',         count(*) FILTER (WHERE source_row   IS NOT NULL) FROM public.part_fitment
UNION ALL SELECT 'part_supersession.source_sheet',  count(*) FILTER (WHERE source_sheet IS NOT NULL) FROM public.part_supersession
UNION ALL SELECT 'part_supersession.source_row',    count(*) FILTER (WHERE source_row   IS NOT NULL) FROM public.part_supersession
UNION ALL SELECT 'part_cross_reference.source_sheet', count(*) FILTER (WHERE source_sheet IS NOT NULL) FROM public.part_cross_reference
UNION ALL SELECT 'part_cross_reference.source_row', count(*) FILTER (WHERE source_row   IS NOT NULL) FROM public.part_cross_reference
UNION ALL SELECT 'engines.source',                  count(*) FILTER (WHERE source       IS NOT NULL) FROM public.engines
UNION ALL SELECT 'engines.source_sheet',            count(*) FILTER (WHERE source_sheet IS NOT NULL) FROM public.engines
UNION ALL SELECT 'engines.source_row',              count(*) FILTER (WHERE source_row   IS NOT NULL) FROM public.engines;

COMMIT;
