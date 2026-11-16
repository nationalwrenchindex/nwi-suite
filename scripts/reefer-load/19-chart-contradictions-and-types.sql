-- Reefer parts: what Brock's belt and filter chart (brock-belt-filter-chart-2026-11-16)
-- contradicts. Brock's ruling, Nov 16, 2026: mark, do not delete.
--
-- PART A - 10 fitment rows MARKED contradicted (confidence -> 'conflict', note set).
--   Each links a chart part to a unit on the mount the chart does not give that part. The
--   counter excludes confidence = 'conflict'. Nothing is deleted; every other column of
--   each row stays as it is. 175's own meaning of 'conflict': sources disagree.
--
--     30-00426-27  chart: trailer only  ->  Supra 844, Supra 850, Supra 950, Supra 950MT
--     30-00471-20  chart: trailer only  ->  Supra 550, Supra 650, Supra 950
--     30-00302-00  chart: truck only    ->  Ultra, Ultra XL, Vector 1800
--
--   All 10 read Nov 16, 2026: confidence 'unconfirmed', verified false, source
--   'reefer-parts-master', match_type 'unit_model', note NULL, no engine, serial or date.
--
-- PART B - 4 part_types and 1 description corrected to the chart.
--   78-0803  part_type Compressor               -> Belt   description -> chart wording
--   78-0903  part_type Electric motor (standby) -> Belt   description -> chart wording
--   78-1134  part_type Electric motor (standby) -> Belt   description -> chart wording
--   10-0458  part_type Hardware                 -> Fuel filter kit (description kept:
--                                                  "Strainer and O-ring kit" matches the
--                                                  chart's note "KIT - strainer and o-ring")
--   11-9961  description "Oil Filter Severe Duty - Precedent SLX"
--                                   -> "Oil Filter Severe Duty - Precedent S-series"
--   'Belt' is the part_type every other chart belt already carries in the catalog (160 of
--   them), so these three group and search with the rest.
--   78-0679 is NOT touched (held for Brock's ruling). confidence, verified and source on
--   these parts are left as they are.
--
-- Every row is matched by id and every field read on Nov 16 that this changes, so a row
-- that is not what was read makes the whole file refuse. No INSERT, no DELETE.
--
-- Plain ASCII. Ends in ROLLBACK for a dry run; change the last line to COMMIT to apply.

BEGIN;

CREATE TEMP TABLE _c19 (fid UUID PRIMARY KEY, pn TEXT, unit TEXT, chart_mount TEXT, unit_mount TEXT) ON COMMIT DROP;
INSERT INTO _c19 VALUES
  ('0a3e9106-f3db-4bdc-a5d3-b3df2e26d455', '30-00426-27', 'Supra 844',   'trailer', 'truck'),
  ('7911c219-fafc-42fe-ad06-8f5ef11fed7a', '30-00426-27', 'Supra 850',   'trailer', 'truck'),
  ('6bf38697-d751-42ad-8847-8ec744f123c9', '30-00426-27', 'Supra 950',   'trailer', 'truck'),
  ('f47f178e-89ff-4b45-936d-c4659e0ee5cb', '30-00426-27', 'Supra 950MT', 'trailer', 'truck'),
  ('cdbc7406-3ca2-4511-9060-04d03dbce3d6', '30-00471-20', 'Supra 550',   'trailer', 'truck'),
  ('18d4ae08-a1f8-44d6-bad3-e8ada4c56606', '30-00471-20', 'Supra 650',   'trailer', 'truck'),
  ('d7396436-0e16-4578-b0ad-a3db36ccf9ce', '30-00471-20', 'Supra 950',   'trailer', 'truck'),
  ('7312f017-0f48-4912-a711-04d5b9d65db6', '30-00302-00', 'Ultra',       'truck',   'trailer'),
  ('845afc88-682f-468b-8a26-20bc4f9352f0', '30-00302-00', 'Ultra XL',    'truck',   'trailer'),
  ('33a0b631-58c1-4161-af4a-3efb26ac7402', '30-00302-00', 'Vector 1800', 'truck',   'trailer');

DO $$
DECLARE
  v_n     BIGINT;
  v_total BIGINT;
BEGIN
  SELECT count(*) INTO v_total FROM public.part_fitment pf;

  -- PART A. Refuse unless all 10 rows are exactly as read.
  SELECT count(*) INTO v_n
    FROM _c19 c
    JOIN public.part_fitment pf ON pf.id = c.fid
    JOIN public.parts p ON p.id = pf.part_id
   WHERE p.part_number = c.pn AND p.manufacturer = 'Carrier Transicold'
     AND pf.unit_model = c.unit AND pf.confidence = 'unconfirmed' AND pf.verified = FALSE
     AND pf.source = 'reefer-parts-master' AND pf.note IS NULL
     AND pf.engine_model IS NULL AND pf.serial_from IS NULL AND pf.serial_before IS NULL
     AND pf.build_date_from IS NULL AND pf.build_date_before IS NULL;
  IF v_n <> 10 THEN RAISE EXCEPTION '19 A: % of 10 fitment rows are as read - nothing applied', v_n; END IF;

  UPDATE public.part_fitment pf
     SET confidence = 'conflict',
         note = 'Contradicted by brock-belt-filter-chart-2026-11-16: the chart fits ' || c.pn
                || ' to ' || c.chart_mount || ' units only; ' || c.unit || ' is a '
                || c.unit_mount || ' unit. Marked Nov 16, 2026, not deleted.'
    FROM _c19 c
   WHERE pf.id = c.fid AND pf.confidence = 'unconfirmed' AND pf.note IS NULL;
  GET DIAGNOSTICS v_n = ROW_COUNT;
  IF v_n <> 10 THEN RAISE EXCEPTION '19 A: marked % rows, not 10 - nothing applied', v_n; END IF;

  -- PART B.
  UPDATE public.parts p SET part_type = 'Belt', description = 'Belt - motor (jackshaft to compressor), compressor to motor'
   WHERE p.id = 'fb93cbc3-e56d-4ed7-8c37-0173c9b33c61' AND p.part_number = '78-0803' AND p.manufacturer = 'Thermo King'
     AND p.part_type = 'Compressor' AND p.description = 'Compressor - electric motor';
  GET DIAGNOSTICS v_n = ROW_COUNT;
  IF v_n <> 1 THEN RAISE EXCEPTION '19 B: 78-0803 updated % rows, not 1 - nothing applied', v_n; END IF;

  UPDATE public.parts p SET part_type = 'Belt', description = 'Belt - motor to jackshaft (compressor)'
   WHERE p.id = '4dfd3ae2-1064-493b-8766-cc1b9a27e9ab' AND p.part_number = '78-0903' AND p.manufacturer = 'Thermo King'
     AND p.part_type = 'Electric motor (standby)' AND p.description = 'Electric/fan motor - compressor, jackshaft, electric motor';
  GET DIAGNOSTICS v_n = ROW_COUNT;
  IF v_n <> 1 THEN RAISE EXCEPTION '19 B: 78-0903 updated % rows, not 1 - nothing applied', v_n; END IF;

  UPDATE public.parts p SET part_type = 'Belt', description = 'Belt - motor to compressor'
   WHERE p.id = 'b4758d5b-8fe9-4919-95e4-3d6b227f10af' AND p.part_number = '78-1134' AND p.manufacturer = 'Thermo King'
     AND p.part_type = 'Electric motor (standby)' AND p.description = 'Electric/fan motor - compressor, electric motor';
  GET DIAGNOSTICS v_n = ROW_COUNT;
  IF v_n <> 1 THEN RAISE EXCEPTION '19 B: 78-1134 updated % rows, not 1 - nothing applied', v_n; END IF;

  UPDATE public.parts p SET part_type = 'Fuel filter kit'
   WHERE p.id = '97fac05e-b083-4d9f-8e0d-7fe95a4e5228' AND p.part_number = '10-0458' AND p.manufacturer = 'Thermo King'
     AND p.part_type = 'Hardware' AND p.description = 'Strainer and O-ring kit';
  GET DIAGNOSTICS v_n = ROW_COUNT;
  IF v_n <> 1 THEN RAISE EXCEPTION '19 B: 10-0458 updated % rows, not 1 - nothing applied', v_n; END IF;

  UPDATE public.parts p SET description = 'Oil Filter Severe Duty - Precedent S-series'
   WHERE p.id = 'b2e60ec7-55a0-4a86-bfd3-abf282deff9c' AND p.part_number = '11-9961' AND p.manufacturer = 'Thermo King'
     AND p.part_type = 'Filter - oil (engine)' AND p.description = 'Oil Filter Severe Duty - Precedent SLX';
  GET DIAGNOSTICS v_n = ROW_COUNT;
  IF v_n <> 1 THEN RAISE EXCEPTION '19 B: 11-9961 updated % rows, not 1 - nothing applied', v_n; END IF;

  -- Self-check.
  IF (SELECT count(*) FROM public.part_fitment pf) <> v_total THEN RAISE EXCEPTION '19 self-check: part_fitment row count moved'; END IF;
  IF (SELECT count(*) FROM public.parts p) <> 2720 THEN RAISE EXCEPTION '19 self-check: parts is not 2720 rows'; END IF;
  IF (SELECT count(*) FROM public.part_fitment pf JOIN _c19 c ON c.fid = pf.id WHERE pf.confidence = 'conflict') <> 10 THEN
    RAISE EXCEPTION '19 self-check: not all 10 rows are marked conflict';
  END IF;
  IF (SELECT count(*) FROM public.part_fitment pf WHERE pf.source = 'brock-belt-filter-chart-2026-11-16') <> 758 THEN
    RAISE EXCEPTION '19 self-check: the chart load is not 758 rows';
  END IF;
  RAISE NOTICE '19 ok: 10 fitment rows marked conflict, 5 parts corrected, nothing deleted';
END $$;

SELECT p.part_number, pf.unit_model, pf.confidence, pf.note
  FROM public.part_fitment pf JOIN public.parts p ON p.id = pf.part_id
 WHERE pf.id IN (SELECT c.fid FROM _c19 c) ORDER BY p.part_number, pf.unit_model;
SELECT p.part_number, p.part_type, p.description
  FROM public.parts p
 WHERE p.id IN ('fb93cbc3-e56d-4ed7-8c37-0173c9b33c61', '4dfd3ae2-1064-493b-8766-cc1b9a27e9ab',
                'b4758d5b-8fe9-4919-95e4-3d6b227f10af', '97fac05e-b083-4d9f-8e0d-7fe95a4e5228',
                'b2e60ec7-55a0-4a86-bfd3-abf282deff9c')
 ORDER BY p.part_number;

-- Dry run. Change to COMMIT to apply.
ROLLBACK;
