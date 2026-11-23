-- Reefer parts: supersessions settled by Brock. Rewritten Nov 22, 2026 with his 11-9958 ruling.
--
-- 1. 78-1340 -> 78-1968 (Thermo King). Brock's belt and filter chart settles it (Nov 16):
--    78-1340 is the old number, 78-1968 the current belt. The existing row (bdac22ad, source
--    nwi-hd-parts-053, verified false, confidence NULL, note NULL) is marked verified TRUE,
--    confidence 'confirmed', with a note saying the chart decided it. Its numbers and
--    source are not changed.
--
-- 2. 11-9958 (Thermo King) is an OLD fuel filter number with FIVE conditional replacements.
--    The break DIFFERS by unit group (Brock, Nov 22, 2026, matching his chart):
--
--      Group A - Precedent C-600, C-600M, and S-600DE / S-600M with the Peugeot engine.
--                Break 7/2023.
--                  before 7/2023: 11-9965 standard duty, or 11-9966 severe duty
--                  from   7/2023: 11-9970 primary
--      Group B - Precedent S-600, S-600M, S-600DE, S-610M, S-610DE, S-700 with other engines
--                (the chart's blank-engine rows). Break 6/2021.
--                  before 6/2021: 11-9965 standard duty, or 11-9966 severe duty
--                  from   6/2021: 11-9967 secondary EMI 3000 AND 11-9969 primary EMI 3000
--      S-750i  - 11-9967 secondary and 11-9969 primary, no older option. The chart lists no
--                11-9958 on the S-750i, so the S-750i is in no 11-9958 note: there is
--                nothing there for 11-9958 to supersede.
--
--    part_supersession has NO unit scope and one row per pair (part_supersession_pair_key),
--    so every note names BOTH the unit group AND the date break. 11-9965 and 11-9966 serve
--    both groups, at different breaks, and their notes say so.
--    The counter shows every confirmed replacement of an old number with its note. In a unit
--    search it stands in only the replacements that unit's own chart rows carry.
--
--    The catalog held ONE link, 11-9958 -> 11-9966 (471dc11f, seed-supersessions-2026-10-23,
--    unconfirmed, note NULL), which made severe duty the default. That row is kept, its
--    numbers untouched, and given its condition in the note, verified TRUE, confidence
--    'confirmed'. The other four are INSERTED.
--
-- Read Nov 22, 2026: part_supersession holds 75 rows (61 + 14 from the chart load), so 20
-- had not been applied; 78-1340 and 11-9958 each have exactly the one row described above.
-- Every changed row is matched by id and every field read, so a row that is not what was
-- read makes the whole file refuse. 175's CHECK on part_supersession.confidence admits
-- 'confirmed'; the first check refuses if the live constraint does not. No DELETE.
--
-- Plain ASCII. Ends in ROLLBACK for a dry run; change the last line to COMMIT to apply.

BEGIN;

DO $$
DECLARE
  v_n BIGINT;
  ga CONSTANT TEXT := 'Precedent C-600, C-600M, and S-600DE / S-600M with the Peugeot engine';
  gb CONSTANT TEXT := 'Precedent S-600, S-600M, S-600DE, S-610M, S-610DE, S-700 with other engines';
  tail CONSTANT TEXT := ' (Brock, Nov 22, 2026. 11-9958 has five replacements by unit and build date; show all.)';
BEGIN
  IF EXISTS (
    SELECT 1 FROM pg_constraint k
     WHERE k.conrelid = 'public.part_supersession'::regclass AND k.contype = 'c'
       AND pg_get_constraintdef(k.oid) ILIKE '%confidence%'
       AND pg_get_constraintdef(k.oid) NOT LIKE '%''confirmed''%') THEN
    RAISE EXCEPTION '20: a CHECK on part_supersession.confidence does not admit confirmed - nothing applied';
  END IF;
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
         note = 'Severe duty. ' || ga || ': built before 7/2023. ' || gb || ': built before 6/2021.' || tail
   WHERE x.id = '471dc11f-4856-4a08-9019-99b2a2be5a67' AND x.manufacturer = 'Thermo King'
     AND x.old_number = '11-9958' AND x.new_number = '11-9966'
     AND x.verified = FALSE AND x.confidence = 'unconfirmed' AND x.note IS NULL
     AND x.source = 'seed-supersessions-2026-10-23';
  GET DIAGNOSTICS v_n = ROW_COUNT;
  IF v_n <> 1 THEN RAISE EXCEPTION '20: 11-9958 -> 11-9966 updated % rows, not 1 - nothing applied', v_n; END IF;

  IF (SELECT count(*) FROM public.part_supersession x
       WHERE x.manufacturer = 'Thermo King' AND x.old_number_normalized = '119958'
         AND x.new_number_normalized IN ('119965', '119967', '119969', '119970')) <> 0 THEN
    RAISE EXCEPTION '20: an 11-9958 -> 11-9965/9967/9969/9970 row already exists - nothing applied';
  END IF;
  IF (SELECT count(*) FROM public.parts p WHERE p.manufacturer = 'Thermo King'
       AND p.part_number IN ('11-9965', '11-9966', '11-9967', '11-9969', '11-9970')) <> 5 THEN
    RAISE EXCEPTION '20: not all five replacement parts are in the catalog - nothing applied';
  END IF;

  INSERT INTO public.part_supersession (old_number, new_number, manufacturer, note, verified, confidence, source)
  VALUES
    ('11-9958', '11-9965', 'Thermo King',
     'Standard duty. ' || ga || ': built before 7/2023. ' || gb || ': built before 6/2021.' || tail,
     TRUE, 'confirmed', 'brock-ruling-2026-11-22'),
    ('11-9958', '11-9967', 'Thermo King',
     'Secondary, EMI 3000. ' || gb || ': built 6/2021 and after. Not for ' || ga || '.' || tail,
     TRUE, 'confirmed', 'brock-ruling-2026-11-22'),
    ('11-9958', '11-9969', 'Thermo King',
     'Primary, EMI 3000. ' || gb || ': built 6/2021 and after. Not for ' || ga || '.' || tail,
     TRUE, 'confirmed', 'brock-ruling-2026-11-22'),
    ('11-9958', '11-9970', 'Thermo King',
     'Primary. ' || ga || ': built 7/2023 and after. Not for ' || gb || '.' || tail,
     TRUE, 'confirmed', 'brock-ruling-2026-11-22');
  GET DIAGNOSTICS v_n = ROW_COUNT;
  IF v_n <> 4 THEN RAISE EXCEPTION '20: inserted % rows, not 4 - nothing applied', v_n; END IF;

  -- Self-check.
  IF (SELECT count(*) FROM public.part_supersession x) <> 79 THEN RAISE EXCEPTION '20 self-check: expected 79 rows'; END IF;
  IF (SELECT count(*) FROM public.part_supersession x
       WHERE x.old_number_normalized = '119958' AND x.verified AND x.confidence = 'confirmed') <> 5 THEN
    RAISE EXCEPTION '20 self-check: 11-9958 does not have exactly 5 confirmed replacements';
  END IF;
  IF EXISTS (SELECT 1 FROM public.part_supersession x WHERE x.old_number_normalized = '119958'
              AND NOT (x.note LIKE '%C-600%' AND x.note LIKE '%S-600%' AND x.note ~ '[0-9]/20[0-9][0-9]')) THEN
    RAISE EXCEPTION '20 self-check: an 11-9958 note does not name both unit groups and a date break';
  END IF;
  IF (SELECT count(*) FROM public.part_supersession x
       WHERE x.old_number_normalized = '781340' AND x.new_number_normalized = '781968' AND x.verified AND x.confidence = 'confirmed') <> 1 THEN
    RAISE EXCEPTION '20 self-check: 78-1340 -> 78-1968 is not confirmed';
  END IF;
  RAISE NOTICE '20 ok: 78-1340 -> 78-1968 confirmed; 11-9958 has 5 conditional replacements';
END $$;

SELECT x.old_number, x.new_number, x.verified, x.confidence, x.source, x.note
  FROM public.part_supersession x
 WHERE x.old_number_normalized IN ('781340', '119958')
 ORDER BY x.old_number, x.new_number;

-- Dry run. Change to COMMIT to apply.
ROLLBACK;
