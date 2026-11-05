-- Reefer parts: Thermo King air sensor supersessions, from Brock (Nov 4, 2026, field-confirmed).
-- Run after 13 and 14.
--
--   GRADED air sensor - current kit 40-0974. Return Air Sensor (RAS) and Discharge Air Sensor (DAS).
--     Superseded by it: 40-0871 40-0784 41-0741 41-2649 41-3852 41-4013 41-4022 41-5801 41-7084
--     41-8547 44-9351
--   UNGRADED air sensor - current kit 40-0975. Evaporator coil sensor and ambient air sensor.
--     Superseded by it: 40-0872 40-0785 41-0742 41-2858 41-3853 41-4012 41-4021 41-5802 41-7085
--     41-8548 44-9335
--
-- A read of the store on Nov 4 found 40-0974, 40-0975, 41-3852 and 40-0785 already in it (left
-- exactly as they are) and the other 20 numbers absent. This file:
--   * adds those 20 as Thermo King parts, part_type 'Sensor - temperature' (the type 40-0974 and
--     40-0975 already carry), equipment_type reefer, with a description and the grade note;
--   * writes 22 supersession rows, old -> current kit.
-- Every new row: verified = true, confidence 'confirmed' (Brock verified it himself), source
-- 'brock-field-2026-11-04'. No retailer, reseller or parts-store name; no URL.
-- Confirmed links are FOLLOWED by the counter: a tech who types an old number is shown the kit.
-- Changes no existing row. No UPDATE, no DELETE.
--
-- ENDS IN ROLLBACK. Read the table it prints, then change the last line to COMMIT to keep it.
-- Preview and production share one database.

BEGIN;

CREATE TEMP TABLE _as (old_number TEXT, new_number TEXT, graded BOOLEAN) ON COMMIT DROP;
INSERT INTO _as VALUES
  ('40-0871', '40-0974', TRUE), ('40-0784', '40-0974', TRUE), ('41-0741', '40-0974', TRUE),
  ('41-2649', '40-0974', TRUE), ('41-3852', '40-0974', TRUE), ('41-4013', '40-0974', TRUE),
  ('41-4022', '40-0974', TRUE), ('41-5801', '40-0974', TRUE), ('41-7084', '40-0974', TRUE),
  ('41-8547', '40-0974', TRUE), ('44-9351', '40-0974', TRUE),
  ('40-0872', '40-0975', FALSE), ('40-0785', '40-0975', FALSE), ('41-0742', '40-0975', FALSE),
  ('41-2858', '40-0975', FALSE), ('41-3853', '40-0975', FALSE), ('41-4012', '40-0975', FALSE),
  ('41-4021', '40-0975', FALSE), ('41-5802', '40-0975', FALSE), ('41-7085', '40-0975', FALSE),
  ('41-8548', '40-0975', FALSE), ('44-9335', '40-0975', FALSE);

CREATE TEMP TABLE _as_note (graded BOOLEAN, description TEXT, note TEXT) ON COMMIT DROP;
INSERT INTO _as_note VALUES
  (TRUE,  'Air sensor, graded - return air (RAS) / discharge air (DAS). Superseded by kit 40-0974.',
          'Graded sensor: a precision thermistor calibrated to a temperature bracket. The controller works off the difference between return and discharge air. On a microprocessor unit such as the SR-3, enter the sensor grade code into the controller when replacing, or the unit runs on bad readings with a new sensor fitted.'),
  (FALSE, 'Air sensor, ungraded - evaporator coil / ambient air. Superseded by kit 40-0975.',
          'Ungraded sensor: a general-purpose threshold sensor for coil-frozen and ambient readings. No grade code.');

CREATE TEMP TABLE _as_before ON COMMIT DROP AS
SELECT a.old_number,
       EXISTS (SELECT 1 FROM public.parts p WHERE p.manufacturer = 'Thermo King'
                AND p.part_number_normalized = public.normalize_part_number(a.old_number)) AS was_in_store
  FROM _as a;

DO $$
BEGIN
  IF (SELECT count(*) FROM public.parts) <> 2700 OR (SELECT count(*) FROM public.part_supersession) <> 39 THEN
    RAISE EXCEPTION 'air sensors: the store is not 2700 parts / 39 supersessions - nothing applied';
  END IF;
  IF (SELECT count(*) FROM public.parts WHERE manufacturer = 'Thermo King' AND part_number IN ('40-0974', '40-0975')) <> 2 THEN
    RAISE EXCEPTION 'air sensors: kit 40-0974 or 40-0975 is not in the store - nothing applied';
  END IF;
  IF (SELECT count(*) FROM _as_before WHERE was_in_store) <> 2
  OR NOT (SELECT bool_and(was_in_store) FROM _as_before WHERE old_number IN ('41-3852', '40-0785')) THEN
    RAISE EXCEPTION 'air sensors: the store does not hold exactly 41-3852 and 40-0785 of the 22 - nothing applied';
  END IF;
  -- Any part with one of these numbers under ANOTHER manufacturer would be a second reading of it.
  IF EXISTS (SELECT 1 FROM public.parts p JOIN _as a ON p.part_number_normalized = public.normalize_part_number(a.old_number)
              WHERE p.manufacturer <> 'Thermo King') THEN
    RAISE EXCEPTION 'air sensors: one of the 22 numbers is in the store under another manufacturer - nothing applied';
  END IF;
  IF EXISTS (SELECT 1 FROM public.part_supersession s JOIN _as a ON s.old_number_normalized = public.normalize_part_number(a.old_number)) THEN
    RAISE EXCEPTION 'air sensors: a supersession out of one of the 22 numbers already exists - nothing applied';
  END IF;
END $$;

INSERT INTO public.parts (manufacturer, part_number, part_type, description, notes, verified, source, confidence, equipment_type)
SELECT 'Thermo King', a.old_number, 'Sensor - temperature', n.description, n.note, TRUE, 'brock-field-2026-11-04', 'confirmed', 'reefer'
  FROM _as a JOIN _as_note n ON n.graded = a.graded JOIN _as_before b ON b.old_number = a.old_number
 WHERE NOT b.was_in_store;

INSERT INTO public.part_supersession (old_number, new_number, manufacturer, note, verified, source, confidence)
SELECT a.old_number, a.new_number, 'Thermo King', n.note, TRUE, 'brock-field-2026-11-04', 'confirmed'
  FROM _as a JOIN _as_note n ON n.graded = a.graded;

DO $$
BEGIN
  IF (SELECT count(*) FROM public.parts) <> 2720 OR (SELECT count(*) FROM public.part_supersession) <> 61 THEN
    RAISE EXCEPTION 'air sensors: the store is not 2720 parts / 61 supersessions - this file did not add exactly its rows';
  END IF;
  IF (SELECT count(*) FROM public.part_supersession WHERE source = 'brock-field-2026-11-04'
         AND verified AND confidence = 'confirmed') <> 22 THEN
    RAISE EXCEPTION 'air sensors: not 22 confirmed supersessions - nothing applied';
  END IF;
END $$;

-- Check (last, so it is the result the editor shows). Expect 22 rows: 11 to 40-0974, 11 to 40-0975;
-- was_in_store true only for 41-3852 and 40-0785; every row confirmed and verified.
SELECT a.old_number, s.new_number, CASE WHEN a.graded THEN 'graded' ELSE 'ungraded' END AS sensor,
       b.was_in_store, s.verified, s.confidence
  FROM _as a
  JOIN _as_before b ON b.old_number = a.old_number
  JOIN public.part_supersession s ON s.old_number_normalized = public.normalize_part_number(a.old_number)
                                 AND s.source = 'brock-field-2026-11-04'
 ORDER BY 2, 1;

ROLLBACK;
