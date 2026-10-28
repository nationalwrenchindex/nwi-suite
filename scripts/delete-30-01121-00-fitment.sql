-- Delete the 5 fitment rows the Oct 28 hd_parts fold-in put onto 30-01121-00.
--
-- 30-01121-00 is SUPERSEDED by 30-60143-01 (part_supersession, brock-carrier-chart,
-- verified). The fold-in extracted Supra 560 / 660 / 760 / 860 / 960 from hd_parts onto
-- the old number, so the parts search offers the old oil filter beside its replacement
-- (smoke: "Supra 660 returns exactly 3 filters" now returns 4).
--
-- Deletes ONLY rows with source 'nwi-hd-parts-053' on that one part. The part itself,
-- its supersession, and every other fitment row are untouched. hd_parts still holds the
-- original models, so nothing is lost.
--
-- ENDS IN ROLLBACK. Read the table it prints, then change the last line to COMMIT.
-- Any check that fails raises an error and nothing is applied.

BEGIN;

CREATE TEMP TABLE _del_before ON COMMIT DROP AS
SELECT (SELECT count(*) FROM public.part_fitment) AS part_fitment,
       (SELECT count(*) FROM public.parts) AS parts;

DO $$
DECLARE n INTEGER;
BEGIN
  -- The part is the one this file was written for.
  IF (SELECT count(*) FROM public.parts
       WHERE id = 'a33899d1-3857-4c3f-9b44-56fae54d10b9'
         AND part_number = '30-01121-00' AND manufacturer = 'Carrier Transicold') <> 1 THEN
    RAISE EXCEPTION 'delete: 30-01121-00 is not the part this file was written for';
  END IF;
  -- Exactly the 5 rows, and nothing else from the fold-in on this part.
  IF (SELECT count(*) FROM public.part_fitment
       WHERE part_id = 'a33899d1-3857-4c3f-9b44-56fae54d10b9' AND source = 'nwi-hd-parts-053') <> 5 THEN
    RAISE EXCEPTION 'delete: expected 5 fold-in fitment rows on 30-01121-00';
  END IF;

  WITH d AS (
    DELETE FROM public.part_fitment
     WHERE part_id = 'a33899d1-3857-4c3f-9b44-56fae54d10b9'
       AND source = 'nwi-hd-parts-053'
       AND unit_model IN ('Supra 560', 'Supra 660', 'Supra 760', 'Supra 860', 'Supra 960')
    RETURNING 1)
  SELECT count(*) INTO n FROM d;
  IF n <> 5 THEN RAISE EXCEPTION 'delete: removed % rows, expected 5', n; END IF;

  IF (SELECT count(*) FROM public.part_fitment) <> (SELECT part_fitment FROM _del_before) - 5
  OR (SELECT count(*) FROM public.parts) <> (SELECT parts FROM _del_before) THEN
    RAISE EXCEPTION 'delete: a table moved by something other than the 5 rows';
  END IF;
END $$;

-- What it did (this is the table the SQL editor shows).
SELECT 'part_fitment' AS table_name, b.part_fitment AS before, (SELECT count(*) FROM public.part_fitment) AS after, -5 AS planned FROM _del_before b
UNION ALL SELECT 'fitment left on 30-01121-00', 5, (SELECT count(*) FROM public.part_fitment WHERE part_id = 'a33899d1-3857-4c3f-9b44-56fae54d10b9'), -5 FROM _del_before b
UNION ALL SELECT 'parts', b.parts, (SELECT count(*) FROM public.parts), 0 FROM _del_before b;

ROLLBACK;
