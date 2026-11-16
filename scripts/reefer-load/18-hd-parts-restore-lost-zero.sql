-- Reefer parts: restore three lost leading zeros in hd_parts. Brock approved Nov 16, 2026.
--
-- APPLIED by hand by Brock, Nov 16, 2026: dry run clean, then the COMMIT copy run.
-- This file now ends in COMMIT as run. Do not run it again (its guards refuse anyway:
-- the damaged numbers are gone).
--
--   78-679 -> 78-0679     78-700 -> 78-0700     78-684 -> 78-0684
--
-- CLAUDE.md rule 6: a lost leading zero is damaged data, not a different part. A TK number
-- is six digits, two-dash-four. These three are REPAIRED IN PLACE, never duplicated.
--
-- ONLY hd_parts.part_number changes. Description, category, unit_models and every other
-- column stay exactly as they are. 78-0679's description ("Belt Water Pump - KDII MDII")
-- disagrees with Brock's chart (alternator belt, SL-100..SL-400) and is HELD for his ruling:
-- this file does not touch it.
--
-- Read Nov 16, 2026 (read-only):
--   33e9914b-5abd-49ea-be10-438d0f9f09c2  Thermo King  78-679  category belt
--   a8acd730-4229-4184-947c-42ca527b2358  Thermo King  78-700  category belt
--   fabd8797-e13c-4bdc-ad37-597b6d2e18cc  Thermo King  78-684  category belt
--   hd_parts held 255 rows; none already held 78-0679, 78-0700 or 78-0684 (part_number is
--   UNIQUE, so the file refuses if one has appeared since); no hd_parts_cross_ref row
--   points at any of the three (its FK has no ON UPDATE CASCADE, so one would block this).
--
-- Each row is matched by id, old number, manufacturer and category, so a row that is not
-- what was read makes the whole file refuse. No INSERT, no DELETE.
--
-- Plain ASCII. Ends in COMMIT, as applied Nov 16, 2026.

BEGIN;

DO $$
DECLARE
  v_n BIGINT;
BEGIN
  IF (SELECT count(*) FROM public.hd_parts h) <> 255 THEN
    RAISE EXCEPTION '18: hd_parts is not 255 rows - nothing applied';
  END IF;
  IF (SELECT count(*) FROM public.hd_parts h WHERE h.part_number IN ('78-0679', '78-0700', '78-0684')) <> 0 THEN
    RAISE EXCEPTION '18: a restored number already exists in hd_parts - nothing applied';
  END IF;
  IF (SELECT count(*) FROM public.hd_parts_cross_ref x WHERE x.part_number IN ('78-679', '78-700', '78-684')) <> 0 THEN
    RAISE EXCEPTION '18: hd_parts_cross_ref points at a damaged number - nothing applied';
  END IF;

  UPDATE public.hd_parts h SET part_number = '78-0679'
   WHERE h.id = '33e9914b-5abd-49ea-be10-438d0f9f09c2' AND h.part_number = '78-679'
     AND h.manufacturer = 'Thermo King' AND h.category = 'belt';
  GET DIAGNOSTICS v_n = ROW_COUNT;
  IF v_n <> 1 THEN RAISE EXCEPTION '18: 78-679 updated % rows, not 1 - nothing applied', v_n; END IF;

  UPDATE public.hd_parts h SET part_number = '78-0700'
   WHERE h.id = 'a8acd730-4229-4184-947c-42ca527b2358' AND h.part_number = '78-700'
     AND h.manufacturer = 'Thermo King' AND h.category = 'belt';
  GET DIAGNOSTICS v_n = ROW_COUNT;
  IF v_n <> 1 THEN RAISE EXCEPTION '18: 78-700 updated % rows, not 1 - nothing applied', v_n; END IF;

  UPDATE public.hd_parts h SET part_number = '78-0684'
   WHERE h.id = 'fabd8797-e13c-4bdc-ad37-597b6d2e18cc' AND h.part_number = '78-684'
     AND h.manufacturer = 'Thermo King' AND h.category = 'belt';
  GET DIAGNOSTICS v_n = ROW_COUNT;
  IF v_n <> 1 THEN RAISE EXCEPTION '18: 78-684 updated % rows, not 1 - nothing applied', v_n; END IF;

  -- Self-check: still 255 rows, the old numbers gone, the new ones present once each.
  IF (SELECT count(*) FROM public.hd_parts h) <> 255 THEN RAISE EXCEPTION '18 self-check: row count moved'; END IF;
  IF (SELECT count(*) FROM public.hd_parts h WHERE h.part_number IN ('78-679', '78-700', '78-684')) <> 0 THEN
    RAISE EXCEPTION '18 self-check: a damaged number is still present';
  END IF;
  IF (SELECT count(*) FROM public.hd_parts h WHERE h.part_number IN ('78-0679', '78-0700', '78-0684')) <> 3 THEN
    RAISE EXCEPTION '18 self-check: restored numbers not present exactly once each';
  END IF;
  RAISE NOTICE '18 ok: 3 hd_parts numbers restored, 255 rows unchanged in count';
END $$;

SELECT h.id, h.part_number, h.manufacturer, h.category, h.unit_models
  FROM public.hd_parts h
 WHERE h.id IN ('33e9914b-5abd-49ea-be10-438d0f9f09c2', 'a8acd730-4229-4184-947c-42ca527b2358', 'fabd8797-e13c-4bdc-ad37-597b6d2e18cc');

-- Applied by hand Nov 16, 2026.
COMMIT;
