-- Migration 108: Thermo King belt coverage.
--
-- Extends hd_parts_reference across the TK trailer and truck ranges: SB, Precedent
-- C-600/S-600/S-700/S-750i (including the Peugeot-engine variants), SL and SL (50),
-- SLX/SLXe/SLXi, RD-II, MD, TS and the whole T-series.
--
-- One row per distinct OEM part number. Models sharing a belt are consolidated into
-- unit_family rather than repeated, same rule as migration 107.
--
-- DEDUPE NOTE, and the reason this migration is not a plain INSERT:
-- the TK rows already in the table are stored HYPHENATED ("78-1341", "78-629",
-- "78-0603 / 78-603") while this data is plain digits ("781341", "780629", "780603").
-- A string comparison finds no overlap and would have inserted seven duplicates.
-- The guard below therefore compares on digits only, splits a stored "A / B"
-- alternate into its tokens, and zero-pads a short suffix -- "78-629" is the same
-- belt as 780629, and only the padding makes that visible.
--
-- Skipped as already present: 780629, 780603, 781341, 781859, 781876, 780684, 781492.
--
-- No cross-reference columns are populated: the source supplied OEM numbers only.
-- Safe to re-run; hd_parts_reference has no unique constraint on oem_part_number.

INSERT INTO public.hd_parts_reference
  (manufacturer, unit_family, part_category, part_function, oem_part_number, notes, verified)
SELECT v.manufacturer, v.unit_family, v.part_category, v.part_function, v.oem_part_number, v.notes, v.verified
FROM (VALUES
  ('TK', 'Spectrum SB', 'Belt', 'Alternator/Water Pump Belt', '781360', NULL, true),
  ('TK', 'Precedent C-600,C-600M', 'Belt', 'Generator Belt (with smart power)', '781858', NULL, true),
  ('TK', 'Precedent C-600,C-600M', 'Belt', 'Supplemental Alternator Belt (12hp)', '781865', 'Optional.', true),
  ('TK', 'Precedent C-600,C-600M', 'Belt', 'Supplemental Alternator Belt (19hp)', '781866', 'Optional.', true),
  ('TK', 'Precedent C-600,C-600M', 'Belt', 'Standby Motor Belt (19hp)', '781862', 'Optional.', true),
  ('TK', 'Precedent S-600,S-600M,S-600DE,S-610M,S-610DE', 'Belt', 'Generator Belt (with smart power)', '781875', NULL, true),
  ('TK', 'Precedent S-600,S-600M,S-600DE,S-610M,S-610DE', 'Belt', 'Supplemental Alternator Belt (12hp)', '781878', 'Optional.', true),
  ('TK', 'Precedent S-600,S-600M,S-600DE,S-610M,S-610DE,S-700', 'Belt', 'Supplemental Alternator Belt (19hp)', '781863', 'Optional.', true),
  ('TK', 'Precedent S-600,S-600M,S-600DE,S-610M,S-610DE', 'Belt', 'Standby Motor Belt (19hp)', '781860', 'Optional.', true),
  ('TK', 'Precedent C-600,C-600M,S-600,S-600M,S-600DE,S-610M,S-610DE,S-700', 'Belt', 'Standby Motor Belt (12hp)', '781877', 'Optional.', true),
  ('TK', 'Precedent S-600DE,S-600M (Peugeot engine)', 'Belt', 'Timing Belt Kit', '100488', 'Kit includes the coolant pump.', true),
  ('TK', 'Precedent S-600DE,S-600M (Peugeot engine)', 'Belt', 'Generator Belt', '781873', NULL, true),
  ('TK', 'Precedent S-600DE,S-600M (Peugeot engine)', 'Belt', 'Alternator Belt', '781872', NULL, true),
  ('TK', 'Precedent S-600DE,S-600M (Peugeot engine)', 'Belt', 'Supplemental Alternator Belt (12hp)', '781868', 'Optional.', true),
  ('TK', 'Precedent S-600DE,S-600M (Peugeot engine)', 'Belt', 'Supplemental Alternator Belt (19hp)', '781869', 'Optional.', true),
  ('TK', 'Precedent S-600DE,S-600M (Peugeot engine)', 'Belt', 'Standby Motor Belt (12hp)', '781870', 'Optional.', true),
  ('TK', 'Precedent S-600DE,S-600M (Peugeot engine)', 'Belt', 'Standby Motor Belt (19hp)', '781871', 'Optional.', true),
  ('TK', 'Precedent S-700', 'Belt', 'Generator Belt (with alternator)', '781857', NULL, true),
  ('TK', 'Precedent S-700', 'Belt', 'Generator Belt (with smart power)', '781856', NULL, true),
  ('TK', 'Precedent S-700', 'Belt', 'Supplemental Alternator Belt (12hp)', '781864', 'Optional.', true),
  ('TK', 'Precedent S-700', 'Belt', 'Standby Motor Belt (19hp)', '781861', 'Optional.', true),
  ('TK', 'Precedent S-750i', 'Belt', 'Generator Belt', '782011', NULL, true),
  ('TK', 'Precedent C-600,C-600M,S-600,S-600M,S-600DE,S-610M,S-610DE,S-700,S-750i,SL-100,SL-200,SL-300,SL-400,SLX,SLXe,SLXi', 'Belt', 'Water Pump Belt (old)', '781340', 'Superseded by 781968.', true),
  ('TK', 'Precedent C-600,C-600M,S-600,S-600M,S-600DE,S-610M,S-610DE,S-700,S-750i,SL-100,SL-200,SL-300,SL-400,SLX,SLXe,SLXi', 'Belt', 'Water Pump Belt (current)', '781968', 'Current supercession for 781340.', true),
  ('TK', 'SL-100,SL-200,SL-300,SL-400', 'Belt', 'Engine to Jackshaft Belt', '781089', NULL, true),
  ('TK', 'SL-100,SL-200,SL-300,SL-400,SL-100 (50),SL-200 (50)', 'Belt', 'Idler to Fanshaft Belt', '780978', NULL, true),
  ('TK', 'SL-100,SL-200,SL-300,SL-400', 'Belt', 'Alternator Belt', '780679', NULL, true),
  ('TK', 'SL-100 (50),SL-200 (50),SL-300 (50)', 'Belt', 'Clutch Belt (matched pair)', '780617', 'Matched pair - replace both.', true),
  ('TK', 'SL-400 (50)', 'Belt', 'Clutch Belt (matched pair)', '780924', 'Matched pair - replace both.', true),
  ('TK', 'SL-100 (50),SL-200 (50),SL-300 (50),SL-400 (50)', 'Belt', 'Motor to Jackshaft Belt', '780928', NULL, true),
  ('TK', 'SL-300 (50),SL-400 (50)', 'Belt', 'Idler to Fan Belt', '780983', NULL, true),
  ('TK', 'SL-100 (50),SL-200 (50),SL-300 (50),SL-400 (50)', 'Belt', 'Alternator Belt', '780336', NULL, true),
  ('TK', 'SLX-100,SLX-200,SLX-300,SLX-400,SLX-Spectrum,SLXe-100,SLXe-200,SLXe-300,SLXe-400,SLXe-Spectrum,SLXi-100,SLXi-200,SLXi-300,SLXi-400,SLXi-Spectrum', 'Belt', 'Blowers Belt', '781945', NULL, true),
  ('TK', 'SLX-200,SLX-300', 'Belt', 'Engine to Motor Belt', '781624', NULL, true),
  ('TK', 'SLX-100,SLX-400,SLX-Spectrum', 'Belt', 'Engine to Motor Belt', '781626', NULL, true),
  ('TK', 'SLXe-100,SLXe-400,SLXe-Spectrum,SLXi-100,SLXi-400,SLXi-Spectrum', 'Belt', 'Engine to Motor Belt', '781831', NULL, true),
  ('TK', 'SLXe-200,SLXe-300,SLXi-200,SLXi-300', 'Belt', 'Engine to Motor Belt', '781830', NULL, true),
  ('TK', 'RD-II,RD-II MAX', 'Belt', 'Engine to Compressor to Idler Belt (old)', '780792', 'Superseded by 780900.', true),
  ('TK', 'RD-II,RD-II MAX', 'Belt', 'Engine to Compressor to Idler Belt (current)', '780900', NULL, true),
  ('TK', 'RD-II,RD-II MAX,RD-II SR', 'Belt', 'Motor Jackshaft to Compressor Belt (old)', '780803', 'Superseded by 780899. On RD-II SR this is the compressor-to-motor belt.', true),
  ('TK', 'RD-II,RD-II MAX,RD-II SR', 'Belt', 'Motor Jackshaft to Compressor Belt (current)', '780899', 'On RD-II SR this is the compressor-to-motor belt.', true),
  ('TK', 'RD-II,RD-II MAX,RD-II SR', 'Belt', 'Evaporator Fan to Compressor Belt', '780800', 'On RD-II SR this is the motor-to-alternator-and-fan belt.', true),
  ('TK', 'RD-II,RD-II MAX,RD-II SR', 'Belt', 'Alternator to Evaporator Fan Belt', '780766', NULL, true),
  ('TK', 'RD-II SR', 'Belt', 'Engine to Motor Belt', '781031', 'TK 3.76 and TK 3.95 engines.', true),
  ('TK', 'RD-II,RD-II MAX,RD-II SR (TK 3.95)', 'Belt', 'Water Pump Belt (old)', '772372', 'Superseded by 781026.', true),
  ('TK', 'RD-II,RD-II MAX,RD-II SR (TK 3.95)', 'Belt', 'Water Pump Belt (current)', '781026', NULL, true),
  ('TK', 'MD-100,MD-200,MD-300', 'Belt', 'Engine Belt', '781366', 'TK 370 and TK 3.74 engines.', true),
  ('TK', 'MD-100,MD-200,MD-300', 'Belt', 'Motor to Jackshaft Compressor Belt (old)', '780903', 'Superseded by 780936.', true),
  ('TK', 'MD-100,MD-200,MD-300', 'Belt', 'Motor to Jackshaft Compressor Belt (current)', '780936', NULL, true),
  ('TK', 'MD-100,MD-200,MD-300', 'Belt', 'Alternator to Evaporator Fan Belt', '780700', NULL, true),
  ('TK', 'TS-200,TS-300,TS-500', 'Belt', 'Engine Belt (old)', '781062', 'Superseded by 781351.', true),
  ('TK', 'TS-200,TS-300,TS-500', 'Belt', 'Engine Belt (current)', '781351', NULL, true),
  ('TK', 'TS-200,TS-300', 'Belt', 'Motor to Compressor Belt', '781129', NULL, true),
  ('TK', 'TS-500', 'Belt', 'Motor to Compressor Belt', '781067', NULL, true),
  ('TK', 'TS-600', 'Belt', 'Engine Belt (old)', '781137', 'Superseded by 781353.', true),
  ('TK', 'TS-600', 'Belt', 'Engine Belt (current)', '781353', NULL, true),
  ('TK', 'TS-600', 'Belt', 'Motor to Compressor Belt (old)', '781134', 'Superseded by 781263.', true),
  ('TK', 'TS-600', 'Belt', 'Motor to Compressor Belt (current)', '781263', NULL, true),
  ('TK', 'T-570R,T-600M,T-800M,T-600R,T-800R,T-580R,T-680R,T-880R,T-1080S Spectrum,T-1280R Spectrum', 'Belt', 'Engine to Motor/Jackshaft Belt', '781724', NULL, true),
  ('TK', 'T-570R,T-600M,T-800M', 'Belt', 'Motor to Compressor Belt', '781696', NULL, true),
  ('TK', 'T-600,T-800', 'Belt', 'Engine to Motor/Jackshaft Belt', '781668', NULL, true),
  ('TK', 'T-600,T-800,T-680S,T-880S', 'Belt', 'Motor to Compressor Belt', '781681', NULL, true),
  ('TK', 'T-600R,T-800R', 'Belt', 'Motor to Compressor Belt', '781686', NULL, true),
  ('TK', 'T-680S,T-880S', 'Belt', 'Engine to Motor/Jackshaft Belt', '781883', NULL, true),
  ('TK', 'T-580R,T-680R,T-880R', 'Belt', 'Motor to Compressor Belt', '781822', NULL, true),
  ('TK', 'T-1000,T-1000R,T-1000R Spectrum,T-1080R,T-1080S,T-1090 Spectrum,T-1200R,T-1200R Spectrum', 'Belt', 'Engine to Motor/Jackshaft Belt', '781669', NULL, true),
  ('TK', 'T-1000,T-1080S', 'Belt', 'Motor to Compressor Belt', '781689', NULL, true),
  ('TK', 'T-1000R', 'Belt', 'Motor to Compressor Belt', '781690', NULL, true),
  ('TK', 'T-1000R Spectrum', 'Belt', 'Motor to Compressor Belt', '781692', 'Before Feb 2013; later units use 781946.', true),
  ('TK', 'T-1080R', 'Belt', 'Motor to Compressor Belt', '781852', 'Before 11/2017; later units use 781946.', true),
  ('TK', 'T-1000R Spectrum,T-1080R,T-1280R Spectrum', 'Belt', 'Motor to Compressor Belt', '781946', 'T-1000R Spectrum from Feb 2013; T-1080R from 11/2017.', true),
  ('TK', 'T-1080S Spectrum', 'Belt', 'Motor to Compressor Belt', '781691', NULL, true),
  ('TK', 'T-1000,T-1000R,T-1000R Spectrum,T-1080R,T-1080S,T-1090 Spectrum', 'Belt', 'Motor/Jackshaft to Compressor Belt (old)', '781995', 'Superseded by 782036.', true),
  ('TK', 'T-1000,T-1000R,T-1000R Spectrum,T-1080R,T-1080S,T-1090 Spectrum', 'Belt', 'Motor/Jackshaft to Compressor Belt (current)', '782036', NULL, true),
  ('TK', 'T-1090', 'Belt', 'Engine to Motor/Jackshaft Belt (old)', '782000', 'Superseded by 782038.', true),
  ('TK', 'T-1090', 'Belt', 'Engine to Motor/Jackshaft Belt (current)', '782038', NULL, true),
  ('TK', 'T-1090', 'Belt', 'Motor/Jackshaft to Compressor Belt', '781997', NULL, true),
  ('TK', 'T-1200R', 'Belt', 'Motor to Compressor Belt', '781701', 'Before 2/2013; later units use 781853.', true),
  ('TK', 'T-1200R Spectrum', 'Belt', 'Motor to Compressor Belt', '781723', 'Before Feb 2013; later units use 781853.', true),
  ('TK', 'T-1200R,T-1200R Spectrum', 'Belt', 'Motor to Compressor Belt', '781853', 'From Feb 2013.', true),
  ('TK', 'MD-100,MD-200,MD-300,TS-200,TS-300,T-570R,T-600,T-600M,T-600R,T-680S,T-800,T-800M,T-800R,T-580R,T-680R,T-880R,T-880S', 'Belt', 'Water Pump Belt (old)', '772848', 'Superseded by 781492.', true),
  ('TK', 'RD-II SR (TK 3.76),TS-500,TS-600,T-1080S Spectrum,T-1090,T-1090 Spectrum,T-1200R,T-1200R Spectrum,T-1280R Spectrum', 'Belt', 'Water Pump Belt (old)', '130403', 'Superseded by 781736.', true),
  ('TK', 'RD-II SR (TK 3.76),TS-500,TS-600,T-1080S Spectrum,T-1090,T-1090 Spectrum,T-1200R,T-1200R Spectrum,T-1280R Spectrum', 'Belt', 'Water Pump Belt (current)', '781736', NULL, true)
) AS v(manufacturer, unit_family, part_category, part_function, oem_part_number, notes, verified)
WHERE NOT EXISTS (
  SELECT 1
  FROM   public.hd_parts_reference p,
         LATERAL regexp_split_to_table(COALESCE(p.oem_part_number, ''), '\s*/\s*') AS tok
  WHERE  p.manufacturer = 'TK'
    AND  CASE
           WHEN tok ~ '^[0-9]{2}-[0-9]{1,4}$'
             THEN split_part(tok, '-', 1) || lpad(split_part(tok, '-', 2), 4, '0')
           ELSE regexp_replace(tok, '[^0-9]', '', 'g')
         END = v.oem_part_number
);
