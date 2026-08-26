-- Migration 111: Carrier belt-adjacent hardware.
--
-- The four rows migration 110 set aside. Each mentions "belt" in the source catalog
-- but none is a belt -- a tensioner, an adjuster, a pulley assembly and a tool kit.
-- They are filed as part_category 'Hardware' so a tech searching belts is not handed
-- a pulley, while still being findable by part number.
--
-- Note this makes Hardware the second-smallest category in the table; before this it
-- held a single row (the TK fuel-inlet crush washers).
--
-- No cross-reference columns: the source supplied OEM numbers only.
-- Safe to re-run; hd_parts_reference has no unique constraint on oem_part_number.

INSERT INTO public.hd_parts_reference
  (manufacturer, unit_family, part_category, part_function, oem_part_number, notes, verified)
SELECT v.manufacturer, v.unit_family, v.part_category, v.part_function, v.oem_part_number, v.notes, v.verified
FROM (VALUES
  ('Carrier', 'Supra', 'Hardware', 'Water Pump Belt Tensioner', '25-34424-00', NULL, true),
  ('Carrier', 'Supra', 'Hardware', 'Alternator Belt Adjuster', '48-60451-00', NULL, true),
  ('Carrier', 'X2,X4', 'Hardware', 'Drive/Condenser Belt Pulley Assembly (4.50)', '50-01184-22', NULL, true),
  ('Carrier', 'Supra S', 'Hardware', 'Standby Belts Tool Kit', '76-61533-00', 'Tooling, not a wear part.', true)
) AS v(manufacturer, unit_family, part_category, part_function, oem_part_number, notes, verified)
WHERE NOT EXISTS (
  SELECT 1
  FROM   public.hd_parts_reference p,
         LATERAL regexp_split_to_table(COALESCE(p.oem_part_number, ''), '\s*/\s*') AS tok
  WHERE  p.manufacturer = 'Carrier'
    AND  regexp_replace(tok, '[^0-9]', '', 'g') = regexp_replace(v.oem_part_number, '[^0-9]', '', 'g')
);
