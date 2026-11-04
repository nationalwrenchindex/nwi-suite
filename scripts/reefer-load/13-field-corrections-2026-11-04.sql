-- Reefer parts: Brock's field corrections of Nov 4, 2026. Run AFTER 01-12 (all applied Nov 4).
--
--   1. 11-7382 (Thermo King) is the ENGINE OIL FILTER for the older Super II, Super II Whisper,
--      SB-II, SB-III and 190Y units -> part_type 'Filter - oil (engine)' (38 store parts use it).
--   2. 11-7400 (Thermo King) is the AIR FILTER for the same units -> part_type 'Filter - air'
--      (55 store parts use it).
--      A read of the store on Nov 4 found BOTH parts ALREADY carry those types, so 1 and 2 are
--      written to change nothing today: each UPDATE touches a row only if its type differs, and
--      the check below proves the final type either way.
--   3. Six fitment rows Brock confirmed from the field: 11-7382 and 11-7400 on Super II Whisper,
--      Super II 190Y and SB-III G (Yanmar TK486 / TK482E). They become verified = true and
--      confidence 'confirmed' - the top of 175's list ("Brock verified it himself").
--      The two other rows of that group of 8 - Spectrum Super-II TCI and Super II Whisper
--      Multi-Temp - are NOT here; they are in file 14, because Brock did not name those units.
--
-- 20-3799 is not in the store (held by the load) and nothing here touches it or 203-799.
-- Changes no other row, column or table. No INSERT, no DELETE.
-- Each fitment row is matched by id AND by part number, unit, engine and source row, so a
-- row that is not exactly what was read on Nov 4 makes the whole file refuse.
--
-- ENDS IN ROLLBACK. Read the table it prints, then change the last line to COMMIT to keep it.
-- Preview and production share one database.

BEGIN;

DO $$
BEGIN
  IF (SELECT count(*) FROM public.parts) <> 2700 OR (SELECT count(*) FROM public.part_fitment) <> 20636 THEN
    RAISE EXCEPTION 'field corrections: the store is not 2700 parts / 20636 fitment - nothing applied';
  END IF;
  IF (SELECT count(*) FROM public.parts WHERE manufacturer = 'Thermo King' AND part_number = '11-7382') <> 1
  OR (SELECT count(*) FROM public.parts WHERE manufacturer = 'Thermo King' AND part_number = '11-7400') <> 1 THEN
    RAISE EXCEPTION 'field corrections: 11-7382 or 11-7400 is not exactly one Thermo King part - nothing applied';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.parts WHERE part_type = 'Filter - oil (engine)' AND part_number <> '11-7382')
  OR NOT EXISTS (SELECT 1 FROM public.parts WHERE part_type = 'Filter - air' AND part_number <> '11-7400') THEN
    RAISE EXCEPTION 'field corrections: the store no longer uses Filter - oil (engine) or Filter - air - nothing applied';
  END IF;
END $$;

UPDATE public.parts SET part_type = 'Filter - oil (engine)'
 WHERE manufacturer = 'Thermo King' AND part_number = '11-7382' AND part_type IS DISTINCT FROM 'Filter - oil (engine)';
UPDATE public.parts SET part_type = 'Filter - air'
 WHERE manufacturer = 'Thermo King' AND part_number = '11-7400' AND part_type IS DISTINCT FROM 'Filter - air';

CREATE TEMP TABLE _fc_rows (id UUID, part_number TEXT, unit_model TEXT, engine_model TEXT, source_row INTEGER) ON COMMIT DROP;
INSERT INTO _fc_rows VALUES
  ('cbd1be7b-de48-4bcd-ac3b-c218d627430c', '11-7382', 'SB-III G',         'TK482E', 8388),
  ('f94e3986-d64f-473f-a409-3475040a8ef6', '11-7400', 'SB-III G',         'TK482E', 8514),
  ('f663b324-8f58-4762-aa5e-321ce427c951', '11-7382', 'Super II 190Y',    'TK486',  8470),
  ('b064f507-10f4-49ac-bc38-3de0a09b032a', '11-7400', 'Super II 190Y',    'TK486',  8563),
  ('86c34259-6cbf-4390-baf1-ca5eee0c939d', '11-7382', 'Super II Whisper', 'TK486',  8482),
  ('fb1e1a84-c45c-4b9f-be21-f05764e88902', '11-7400', 'Super II Whisper', 'TK486',  8572);

DO $$
DECLARE n BIGINT;
BEGIN
  SELECT count(*) INTO n
    FROM _fc_rows r
    JOIN public.part_fitment f ON f.id = r.id
    JOIN public.parts p ON p.id = f.part_id
   WHERE p.manufacturer = 'Thermo King' AND p.part_number = r.part_number
     AND f.unit_model = r.unit_model AND f.engine_model = r.engine_model
     AND f.source = 'reefer-parts-master' AND f.source_sheet = 'All Parts' AND f.source_row = r.source_row;
  IF n <> 6 THEN
    RAISE EXCEPTION 'field corrections: % of the 6 fitment rows match what was read on Nov 4 - nothing applied', n;
  END IF;

  UPDATE public.part_fitment f SET verified = TRUE, confidence = 'confirmed'
    FROM _fc_rows r WHERE f.id = r.id;
  GET DIAGNOSTICS n = ROW_COUNT;
  IF n <> 6 THEN
    RAISE EXCEPTION 'field corrections: updated % fitment rows, not 6 - nothing applied', n;
  END IF;

  IF (SELECT count(*) FROM public.parts) <> 2700 OR (SELECT count(*) FROM public.part_fitment) <> 20636 THEN
    RAISE EXCEPTION 'field corrections: a row count moved - nothing applied';
  END IF;
END $$;

-- Check (last, so it is the result the editor shows). Expect 8 rows: the two parts with their
-- filter types, then the six fitment rows, every one verified true and confirmed.
SELECT 'part' AS kind, p.part_number, p.part_type AS type_or_unit, NULL::TEXT AS engine, NULL::BOOLEAN AS verified, p.confidence
  FROM public.parts p WHERE p.manufacturer = 'Thermo King' AND p.part_number IN ('11-7382', '11-7400')
UNION ALL
SELECT 'fitment', p.part_number, f.unit_model, f.engine_model, f.verified, f.confidence
  FROM _fc_rows r JOIN public.part_fitment f ON f.id = r.id JOIN public.parts p ON p.id = f.part_id
ORDER BY 1 DESC, 2, 3;

ROLLBACK;
