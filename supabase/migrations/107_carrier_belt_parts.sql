-- Migration 107: Carrier Transicold belt coverage.
--
-- Extends hd_parts_reference from the reefer-era families (X2/X4/Vector) onto the
-- older and Supra-series units: Ultra, Ultra XL, TM1000, Ultima 53, Ultima XTC,
-- Supra S6-S10 and Supra 550 through 960.
--
-- One row per distinct OEM part number. Where the source data lists the same belt
-- across several models, those models are consolidated into unit_family instead of
-- being repeated as separate rows -- repeating would recreate the duplicate problem
-- one table over.
--
-- Deliberately absent:
--   50-00162-25  superseded by 50-01180-02 (see the existing Stocking Note row)
--   Eleven part numbers already in the table -- 50-00178-16/-19/-24/-26/-27,
--   50-00162-22, 50-01180-02, 50-01198-00, 50-60330-03, 50-60329-06, 50-60480-01.
--   The supplied data restated them under different model names; the existing rows
--   already carry them with cross-references, so re-inserting would only duplicate.
--
-- No cross-reference columns are populated: the source supplied OEM numbers only.
-- The NOT EXISTS guard makes this safe to re-run, since hd_parts_reference has an
-- index on oem_part_number but no unique constraint.

INSERT INTO public.hd_parts_reference
  (manufacturer, unit_family, part_category, part_function, oem_part_number, notes, verified)
SELECT v.manufacturer, v.unit_family, v.part_category, v.part_function, v.oem_part_number, v.notes, v.verified
FROM (VALUES
  ('Carrier', 'Ultra,Ultra XL,TM1000', 'Belt', 'Drive Belt', '50-00178-08', NULL, true),
  ('Carrier', 'Ultra,Ultra XL,TM1000', 'Belt', 'Condenser Belt', '50-00178-07', NULL, true),
  ('Carrier', 'Ultra,Ultra XL,TM1000,Supra 950,Supra 950MT', 'Belt', 'Alternator Belt', '50-00179-20', 'Supra 950/950MT: prior to serial LFX91068470 only — superseded there by 50-00162-24, then by 50-01180-01.', true),
  ('Carrier', 'Ultra,Ultra XL,TM1000,Ultima 53', 'Belt', 'Water Pump Belt', '50-00162-04', NULL, true),
  ('Carrier', 'TM1000', 'Belt', 'Generator Belt', '50-00178-18', NULL, true),
  ('Carrier', 'Ultima 53', 'Belt', 'Condenser Belt', '50-00178-20', NULL, true),
  ('Carrier', 'Ultima 53', 'Belt', 'Alternator Belt', '50-00179-10', NULL, true),
  ('Carrier', 'Supra S6,Supra S9', 'Belt', 'Alternator/Compressor Belt', '50-60480-02', NULL, true),
  ('Carrier', 'Supra S7', 'Belt', 'Alternator/Compressor Belt', '50-60480-03', NULL, true),
  ('Carrier', 'Supra S10,Supra 950,Supra 950MT,Supra 960', 'Belt', 'Water Pump Belt', '50-60329-02', 'Poly-V. Supra 950/950MT: 2013 and newer — earlier units use 25-33023-00.', true),
  ('Carrier', 'Supra 550,Supra 560', 'Belt', 'Engine to Compressor Belt', '50-01180-51', 'Supra 550: starting serial MFH91129306. Prior units use 50-60198-48.', true),
  ('Carrier', 'Supra 550', 'Belt', 'Engine to Compressor Belt', '50-60198-48', 'Prior to serial MFH91129306. Superseded by 50-01180-51.', true),
  ('Carrier', 'Supra 550,Supra 560,Supra 650,Supra 750,Supra 660,Supra 760', 'Belt', 'Compressor to Motor Belt', '50-01180-10', 'Supra 550: starting MFH91129306. Prior units use 50-60289-00.', true),
  ('Carrier', 'Supra 550', 'Belt', 'Compressor to Motor Belt', '50-60289-00', 'Prior to MFH91129306. Superseded by 50-01180-10.', true),
  ('Carrier', 'Supra 550', 'Belt', 'Water Pump Belt', '25-34856-00', 'Units built before 2013. 2013 and newer use 50-60329-06.', true),
  ('Carrier', 'Supra 550,Supra 560', 'Belt', 'Alternator Belt', '50-01180-04', 'Supra 550: starting MFH91129306. Prior units use 50-60288-21.', true),
  ('Carrier', 'Supra 550', 'Belt', 'Alternator Belt', '50-60288-21', 'Prior to MFH91129306. Superseded by 50-01180-04.', true),
  ('Carrier', 'Supra 650,Supra 750', 'Belt', 'Engine to Compressor Belt', '50-00162-53', 'Prior to serial KFW90913748.', true),
  ('Carrier', 'Supra 650,Supra 750,Supra 660,Supra 760', 'Belt', 'Engine to Compressor Belt', '50-01180-52', 'Supra 650/750: starting serial MFH91126707.', true),
  ('Carrier', 'Supra 650,Supra 750', 'Belt', 'Engine to Compressor Belt', '50-60198-49', 'Between serials KFW90913748 and MFH91126707.', true),
  ('Carrier', 'Supra 650,Supra 750,Supra 844,Supra 850', 'Belt', 'Water Pump Belt', '50-60296-01', 'V-groove. Supra 650/750 before 2013 — 2013 and newer use 50-60329-04.', true),
  ('Carrier', 'Supra 650,Supra 750,Supra 660,Supra 760,Supra 844,Supra 850,Supra 860', 'Belt', 'Water Pump Belt', '50-60329-04', 'Poly-V, 2013 and newer.', true),
  ('Carrier', 'Supra 844,Supra 850,Supra 860', 'Belt', 'Engine to Compressor Belt', '50-01180-53', NULL, true),
  ('Carrier', 'Supra 844,Supra 850,Supra 860', 'Belt', 'Compressor to Motor Belt', '50-01180-50', 'Supra 844/850: starting MFN91151579. Prior units use 50-00179-59.', true),
  ('Carrier', 'Supra 844,Supra 850', 'Belt', 'Compressor to Motor Belt', '50-00179-59', 'Prior to MFN91151579. Superseded by 50-01180-50.', true),
  ('Carrier', 'Supra 844,Supra 850', 'Belt', 'Water Pump Belt', '50-60197-04', 'Old V-groove. Superseded by 50-60296-01, then by 50-60329-04.', true),
  ('Carrier', 'Supra 844,Supra 850', 'Belt', 'Alternator Belt', '50-01169-00', NULL, true),
  ('Carrier', 'Supra 860', 'Belt', 'Alternator/Standby Belt', '50-01180-08', NULL, true),
  ('Carrier', 'Supra 950,Supra 950MT,Supra 960', 'Belt', 'Engine to Compressor Belt', '50-01166-01', NULL, true),
  ('Carrier', 'Supra 950,Supra 960', 'Belt', 'Compressor to Motor Belt', '50-01180-61', NULL, true),
  ('Carrier', 'Supra 950MT', 'Belt', 'Compressor to Motor Belt', '50-01180-60', NULL, true),
  ('Carrier', 'Supra 950,Supra 950MT', 'Belt', 'Water Pump Belt', '25-33023-00', 'Units built before 2013. 2013 and newer use 50-60329-02.', true),
  ('Carrier', 'Supra 950,Supra 950MT,Supra 960', 'Belt', 'Alternator/Standby Belt', '50-01180-01', 'Supra 950/950MT: starting MFN91129321. Prior units use 50-00162-24.', true),
  ('Carrier', 'Supra 950,Supra 950MT', 'Belt', 'Alternator/Standby Belt', '50-00162-24', 'Prior to MFN91129321. Superseded by 50-01180-01.', true)
) AS v(manufacturer, unit_family, part_category, part_function, oem_part_number, notes, verified)
WHERE NOT EXISTS (
  SELECT 1 FROM public.hd_parts_reference p
  WHERE p.manufacturer    = v.manufacturer
    AND p.oem_part_number  = v.oem_part_number
);
