-- Delete the 4 fitment rows the Oct 28 Grok import put beside a serial split.
--
-- Brock's Carrier chart splits these air filters by serial GAG90483303 (one part before,
-- one from). The Grok file listed a THIRD air filter for the same models with no serial
-- break, so a model search returns 3 and a serial can no longer narrow it to one
-- (smoke: "an Ultra air filter search returns both serial sides" -> 3,
-- "an early serial narrows it to one" -> 2).
--
--   30-00430-23  Ultra      4bdee67b-dfe0-436d-8b50-ada68d19c01d
--   30-00430-23  Ultra XL   0430bedf-9c2e-4416-95cf-e67df68bdeda
--   30-00426-27  Ultra XT   c7bb15ca-530f-4b98-a93e-f07963fc7d4e
--   30-00426-27  Extra XT   723de137-4b81-41e4-bea7-3a45826b9045
--
-- Deletes ONLY those 4 rows (source 'nwi-import-oem-file-2026-10-28'). The parts, their
-- other fitment, and the chart's serial-split rows are untouched. The Grok file still
-- holds the claims, so nothing is lost.
--
-- ENDS IN ROLLBACK. Read the table it prints, then change the last line to COMMIT.
-- Run this BEFORE scripts/load-seed-and-reference.sql - that file is built against the
-- store without these 4 rows and refuses to run while they exist.

BEGIN;

CREATE TEMP TABLE _del_before ON COMMIT DROP AS
SELECT (SELECT count(*) FROM public.part_fitment) AS part_fitment,
       (SELECT count(*) FROM public.parts) AS parts;

DO $$
DECLARE n INTEGER;
BEGIN
  -- Exactly the 4 rows, each still the Grok row on the part and model this file names.
  IF (SELECT count(*) FROM public.part_fitment f JOIN public.parts p ON p.id = f.part_id
       WHERE f.source = 'nwi-import-oem-file-2026-10-28' AND f.serial_from IS NULL AND f.serial_before IS NULL
         AND p.manufacturer = 'Carrier Transicold'
         AND (f.id, p.part_number, f.unit_model) IN (
           ('4bdee67b-dfe0-436d-8b50-ada68d19c01d'::uuid, '30-00430-23', 'Ultra'),
           ('0430bedf-9c2e-4416-95cf-e67df68bdeda'::uuid, '30-00430-23', 'Ultra XL'),
           ('c7bb15ca-530f-4b98-a93e-f07963fc7d4e'::uuid, '30-00426-27', 'Ultra XT'),
           ('723de137-4b81-41e4-bea7-3a45826b9045'::uuid, '30-00426-27', 'Extra XT'))) <> 4 THEN
    RAISE EXCEPTION 'delete: the 4 rows are not what this file was written for';
  END IF;

  WITH d AS (
    DELETE FROM public.part_fitment
     WHERE source = 'nwi-import-oem-file-2026-10-28'
       AND id IN ('4bdee67b-dfe0-436d-8b50-ada68d19c01d', '0430bedf-9c2e-4416-95cf-e67df68bdeda',
                  'c7bb15ca-530f-4b98-a93e-f07963fc7d4e', '723de137-4b81-41e4-bea7-3a45826b9045')
    RETURNING 1)
  SELECT count(*) INTO n FROM d;
  IF n <> 4 THEN RAISE EXCEPTION 'delete: removed % rows, expected 4', n; END IF;

  IF (SELECT count(*) FROM public.part_fitment) <> (SELECT part_fitment FROM _del_before) - 4
  OR (SELECT count(*) FROM public.parts) <> (SELECT parts FROM _del_before) THEN
    RAISE EXCEPTION 'delete: a table moved by something other than the 4 rows';
  END IF;
END $$;

-- What it did (this is the table the SQL editor shows).
SELECT 'part_fitment' AS table_name, b.part_fitment AS before, (SELECT count(*) FROM public.part_fitment) AS after, -4 AS planned FROM _del_before b
UNION ALL SELECT 'parts', b.parts, (SELECT count(*) FROM public.parts), 0 FROM _del_before b;

ROLLBACK;
