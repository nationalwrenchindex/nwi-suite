-- Migration 110: remaining Carrier belts from the reefer parts catalog.
--
-- Migration 107 covered the Ultra/TM1000/Ultima/Supra belt lists. This picks up the
-- five belts that appear in the wider Carrier parts catalog but were not in that
-- data: Solara, two Comfort Pro APU belts, the Supra 844/850/860 alternator belt and
-- a second Supra water pump belt.
--
-- Four further rows in the source mention "belt" but are NOT belts and are excluded:
--   25-34424-00  water pump belt tensioner
--   48-60451-00  alternator belt adjuster
--   50-01184-22  drive/condenser pulley assembly
--   76-61533-00  standby belts tool kit
-- They belong under Hardware if they are wanted; filing them as 'Belt' would hand a
-- tech searching for a belt a pulley instead.
--
-- Flagged for review: 50-60197-06 here versus the already-stored 50-60197-04, both
-- described as a Supra water pump belt. Two catalogs, one digit apart -- either two
-- real variants or a transcription error in one of them.
--
-- No cross-reference columns: the source supplied OEM numbers only.
-- Safe to re-run; hd_parts_reference has no unique constraint on oem_part_number.

INSERT INTO public.hd_parts_reference
  (manufacturer, unit_family, part_category, part_function, oem_part_number, notes, verified)
SELECT v.manufacturer, v.unit_family, v.part_category, v.part_function, v.oem_part_number, v.notes, v.verified
FROM (VALUES
  ('Carrier', 'Solara', 'Belt', 'Belt', '50-00162-10', 'Source catalog lists this only as "Belt" with no function given.', true),
  ('Carrier', 'Comfort Pro', 'Belt', 'APU Belt', '50-01194-03', NULL, true),
  ('Carrier', 'Supra 844,Supra 850,Supra 860', 'Belt', 'Alternator Belt', '50-60288-02', 'Distinct from 50-60288-21, which is the Supra 550 alternator belt.', true),
  ('Carrier', 'Supra', 'Belt', 'Water Pump Belt', '50-60197-06', 'Close to the stored 50-60197-04 (Supra 844/850 water pump). Both come from supplied catalogs; if one is a transcription error the other should be retired.', true),
  ('Carrier', 'Comfort Pro', 'Belt', 'APU Alternator Belt', '96-969-03K', NULL, true)
) AS v(manufacturer, unit_family, part_category, part_function, oem_part_number, notes, verified)
WHERE NOT EXISTS (
  SELECT 1
  FROM   public.hd_parts_reference p,
         LATERAL regexp_split_to_table(COALESCE(p.oem_part_number, ''), '\s*/\s*') AS tok
  WHERE  p.manufacturer = 'Carrier'
    AND  regexp_replace(tok, '[^0-9]', '', 'g') = regexp_replace(v.oem_part_number, '[^0-9]', '', 'g')
);
