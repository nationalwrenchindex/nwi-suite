-- Reefer parts: Brock's field correction of Nov 6, 2026. Run AFTER 01-16.
--
--   78-1968 (Thermo King) is the ENGINE CRANK TO WATER PUMP belt on Precedent units.
--   The store had it as just "Belt" (source mincarone.net, unverified, no tier).
--
--   description -> 'Belt Engine Crank to Water Pump - Precedent'
--                  (the store's own belt wording for its Precedent belts:
--                   "Belt Generator to Alternator - Precedent S-600",
--                   "Belt Motor to Clutch 19HP - Precedent S-600")
--   verified    -> TRUE
--   confidence  -> 'confirmed'   (the top of 175's list: Brock verified it himself)
--   source      -> 'brock-field-correction-2026-11-06'  (was 'mincarone.net')
--
-- The part row ONLY. Its 52 fitment rows, the 78-1340 -> 78-1968 supersession row and
-- 78-1340 / 78-1341 are NOT touched: whether 78-1968 supersedes 78-1340 is still open.
-- part_type stays 'Belt'. No INSERT, no DELETE.
-- The row is matched by id AND part number AND its current description and source, so a
-- row that is not exactly what was read on Nov 6 makes the whole file refuse.
--
-- ENDS IN ROLLBACK. Read the row it prints, then change the last line to COMMIT to keep it.
-- Preview and production share one database.

BEGIN;

DO $$
DECLARE n BIGINT;
BEGIN
  IF (SELECT count(*) FROM public.parts) <> 2720 THEN
    RAISE EXCEPTION 'field correction 78-1968: the store is not 2720 parts - nothing applied';
  END IF;
  IF (SELECT count(*) FROM public.parts WHERE manufacturer = 'Thermo King' AND part_number = '78-1968') <> 1 THEN
    RAISE EXCEPTION 'field correction 78-1968: not exactly one Thermo King 78-1968 - nothing applied';
  END IF;

  UPDATE public.parts
     SET description = 'Belt Engine Crank to Water Pump - Precedent',
         verified    = TRUE,
         confidence  = 'confirmed',
         source      = 'brock-field-correction-2026-11-06'
   WHERE id = '8afaed80-9386-4fe8-8cf0-2655e695513f'
     AND manufacturer = 'Thermo King'
     AND part_number = '78-1968'
     AND description = 'Belt'
     AND source = 'mincarone.net';
  GET DIAGNOSTICS n = ROW_COUNT;
  IF n <> 1 THEN
    RAISE EXCEPTION 'field correction 78-1968: updated % rows, not 1 - the row is not what was read on Nov 6, nothing applied', n;
  END IF;
END $$;

SELECT part_number, manufacturer, part_type, description, verified, confidence, source
  FROM public.parts
 WHERE manufacturer = 'Thermo King' AND part_number = '78-1968';

ROLLBACK;
