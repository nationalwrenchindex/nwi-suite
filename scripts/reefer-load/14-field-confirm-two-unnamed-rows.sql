-- Reefer parts: the two fitment rows of the "group of 8" that Brock did NOT name. Optional.
--
-- The load report listed 8 rows putting 11-7382 / 11-7400 on older units with a Yanmar engine.
-- Brock confirmed them on Nov 4 naming Super II Whisper, 190Y and SB-III G - those six are file 13.
-- These two are on units he did not name:
--
--   11-7382 on Spectrum Super-II TCI      (TK486, reefer-parts-master / All Parts row 8467)
--   11-7382 on Super II Whisper Multi-Temp (TK486, reefer-parts-master / All Parts row 8483)
--
-- Run this ONLY if those two units are part of what you confirmed. It makes them verified = true
-- and confidence 'confirmed', exactly as file 13 does for the other six. Run after 13.
-- If you do not run it, both rows stay as loaded: unconfirmed, verified false.
--
-- ENDS IN ROLLBACK. Read the table it prints, then change the last line to COMMIT to keep it.
-- Preview and production share one database.

BEGIN;

CREATE TEMP TABLE _fc2_rows (id UUID, part_number TEXT, unit_model TEXT, engine_model TEXT, source_row INTEGER) ON COMMIT DROP;
INSERT INTO _fc2_rows VALUES
  ('728d82d5-22c5-4fbe-a72e-56cd08d0a59e', '11-7382', 'Spectrum Super-II TCI',       'TK486', 8467),
  ('aada18d8-25ec-4fa6-aaf1-d20d8e178aa9', '11-7382', 'Super II Whisper Multi-Temp', 'TK486', 8483);

DO $$
DECLARE n BIGINT;
BEGIN
  SELECT count(*) INTO n
    FROM _fc2_rows r
    JOIN public.part_fitment f ON f.id = r.id
    JOIN public.parts p ON p.id = f.part_id
   WHERE p.manufacturer = 'Thermo King' AND p.part_number = r.part_number
     AND f.unit_model = r.unit_model AND f.engine_model = r.engine_model
     AND f.source = 'reefer-parts-master' AND f.source_sheet = 'All Parts' AND f.source_row = r.source_row;
  IF n <> 2 THEN
    RAISE EXCEPTION 'field confirm: % of the 2 fitment rows match what was read on Nov 4 - nothing applied', n;
  END IF;

  UPDATE public.part_fitment f SET verified = TRUE, confidence = 'confirmed'
    FROM _fc2_rows r WHERE f.id = r.id;
  GET DIAGNOSTICS n = ROW_COUNT;
  IF n <> 2 THEN
    RAISE EXCEPTION 'field confirm: updated % fitment rows, not 2 - nothing applied', n;
  END IF;

  IF (SELECT count(*) FROM public.parts) <> 2700 OR (SELECT count(*) FROM public.part_fitment) <> 20636 THEN
    RAISE EXCEPTION 'field confirm: a row count moved - nothing applied';
  END IF;
END $$;

-- Check (last, so it is the result the editor shows). Expect 2 rows, both verified true and confirmed.
SELECT p.part_number, f.unit_model, f.engine_model, f.verified, f.confidence
  FROM _fc2_rows r JOIN public.part_fitment f ON f.id = r.id JOIN public.parts p ON p.id = f.part_id
ORDER BY 2;

COMMIT;
