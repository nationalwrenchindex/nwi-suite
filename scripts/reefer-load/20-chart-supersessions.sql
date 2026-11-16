-- Reefer parts: two supersessions settled by Brock, Nov 16, 2026.
--
-- 1. 78-1340 -> 78-1968 (Thermo King). Brock's belt and filter chart settles it: 78-1340 is
--    the old number, 78-1968 the current water pump belt (CLAUDE.md said "not settled" until
--    now). The existing row (bdac22ad, source nwi-hd-parts-053, verified false, confidence
--    NULL, note NULL) is marked verified TRUE, confidence 'confirmed', with a note saying
--    the chart decided it. Its numbers and source are not changed.
--
-- 2. 11-9958 (Thermo King) is an OLD number with CONDITIONAL replacements, per Brock:
--      11-9965  standard duty, built before 7/2023
--      11-9966  severe duty,   built before 7/2023
--      11-9970  built 7/2023 and after
--    The catalog held ONE link, 11-9958 -> 11-9966 (471dc11f, seed-supersessions-2026-10-23,
--    unconfirmed), which made severe duty the default. That row is kept, its numbers
--    untouched, and given its condition in the note, verified TRUE, confidence 'confirmed'.
--    The other two are INSERTED. The counter shows every confirmed replacement of an old
--    number, with its note, instead of picking one.
--    There is no condition column on part_supersession; the condition is the note.
--
-- Read Nov 16, 2026: part_supersession held 75 rows (61 + 14 from the chart load).
-- Every changed row is matched by id and every field read, so a row that is not what was
-- read makes the whole file refuse. No DELETE.
--
-- Plain ASCII. Ends in ROLLBACK for a dry run; change the last line to COMMIT to apply.

BEGIN;

DO $$
DECLARE
  v_n BIGINT;
BEGIN
  IF (SELECT count(*) FROM public.part_supersession x) <> 75 THEN
    RAISE EXCEPTION '20: part_supersession is not 75 rows - nothing applied';
  END IF;

  UPDATE public.part_supersession x
     SET verified = TRUE, confidence = 'confirmed',
         note = 'Settled by Brock''s belt and filter chart (brock-belt-filter-chart-2026-11-16), Nov 16, 2026: 78-1340 is the old number, 78-1968 is current.'
   WHERE x.id = 'bdac22ad-5691-4c01-b966-5afa4d09e50a' AND x.manufacturer = 'Thermo King'
     AND x.old_number = '78-1340' AND x.new_number = '78-1968'
     AND x.verified = FALSE AND x.confidence IS NULL AND x.note IS NULL AND x.source = 'nwi-hd-parts-053';
  GET DIAGNOSTICS v_n = ROW_COUNT;
  IF v_n <> 1 THEN RAISE EXCEPTION '20: 78-1340 -> 78-1968 updated % rows, not 1 - nothing applied', v_n; END IF;

  UPDATE public.part_supersession x
     SET verified = TRUE, confidence = 'confirmed',
         note = 'Conditional (Brock, Nov 16, 2026): severe duty, built before 7/2023. 11-9958 has three replacements; show all.'
   WHERE x.id = '471dc11f-4856-4a08-9019-99b2a2be5a67' AND x.manufacturer = 'Thermo King'
     AND x.old_number = '11-9958' AND x.new_number = '11-9966'
     AND x.verified = FALSE AND x.confidence = 'unconfirmed' AND x.note IS NULL
     AND x.source = 'seed-supersessions-2026-10-23';
  GET DIAGNOSTICS v_n = ROW_COUNT;
  IF v_n <> 1 THEN RAISE EXCEPTION '20: 11-9958 -> 11-9966 updated % rows, not 1 - nothing applied', v_n; END IF;

  IF (SELECT count(*) FROM public.part_supersession x
       WHERE x.manufacturer = 'Thermo King' AND x.old_number_normalized = '119958'
         AND x.new_number_normalized IN ('119965', '119970')) <> 0 THEN
    RAISE EXCEPTION '20: an 11-9958 -> 11-9965 or -> 11-9970 row already exists - nothing applied';
  END IF;

  INSERT INTO public.part_supersession (old_number, new_number, manufacturer, note, verified, confidence, source)
  VALUES
    ('11-9958', '11-9965', 'Thermo King',
     'Conditional (Brock, Nov 16, 2026): standard duty, built before 7/2023. 11-9958 has three replacements; show all.',
     TRUE, 'confirmed', 'brock-ruling-2026-11-16'),
    ('11-9958', '11-9970', 'Thermo King',
     'Conditional (Brock, Nov 16, 2026): built 7/2023 and after. 11-9958 has three replacements; show all.',
     TRUE, 'confirmed', 'brock-ruling-2026-11-16');
  GET DIAGNOSTICS v_n = ROW_COUNT;
  IF v_n <> 2 THEN RAISE EXCEPTION '20: inserted % rows, not 2 - nothing applied', v_n; END IF;

  -- Self-check.
  IF (SELECT count(*) FROM public.part_supersession x) <> 77 THEN RAISE EXCEPTION '20 self-check: expected 77 rows'; END IF;
  IF (SELECT count(*) FROM public.part_supersession x
       WHERE x.old_number_normalized = '119958' AND x.verified AND x.confidence = 'confirmed') <> 3 THEN
    RAISE EXCEPTION '20 self-check: 11-9958 does not have exactly 3 confirmed replacements';
  END IF;
  IF (SELECT count(*) FROM public.part_supersession x
       WHERE x.old_number_normalized = '781340' AND x.new_number_normalized = '781968' AND x.verified AND x.confidence = 'confirmed') <> 1 THEN
    RAISE EXCEPTION '20 self-check: 78-1340 -> 78-1968 is not confirmed';
  END IF;
  RAISE NOTICE '20 ok: 78-1340 -> 78-1968 confirmed; 11-9958 has 3 conditional replacements';
END $$;

SELECT x.old_number, x.new_number, x.verified, x.confidence, x.source, x.note
  FROM public.part_supersession x
 WHERE x.old_number_normalized IN ('781340', '119958')
 ORDER BY x.old_number, x.new_number;

-- Dry run. Change to COMMIT to apply.
ROLLBACK;
