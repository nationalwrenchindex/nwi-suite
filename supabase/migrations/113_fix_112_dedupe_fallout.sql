-- Migration 113: correct fallout from the 112 bulk load.
--
-- Two problems, both caused by how 112 deduplicated.
--
-- 1. The digits-only comparison in 112 was too aggressive. It correctly matched
--    "78-629" to 780629, but it also collapsed part numbers that differ only by a
--    LETTER suffix -- and that suffix is the variant. Eight pairs collided and one of
--    each was silently dropped:
--      17-44015-00   vs 17-44015-00PB    (standard vs pre-bored)      <- distinct
--      22-50099-01   vs 22-50099-01A     (60-pin plug vs pin terminal) <- distinct
--      25-39335-00   vs 25-39335-00-K    (manifold vs manifold kit)   <- distinct
--      07-00375-00   vs 07-00375-00SV    identical description
--      08-00330-00   vs 08-00330-00SV    identical description
--      25-15568-00   vs 25-15568-00SV    identical description
--      18-00091-106RM vs 18-00091-106-R  both "remanufactured"
--      17-44742-00   vs 17-44742-00-EMPTY  "-EMPTY" looks like a source artifact
--    Only the first three are re-inserted here. The SV/RM pairs and the -EMPTY row
--    describe the same part twice and are deliberately left as single rows.
--    NOTE the guard below matches on the EXACT string, not on digits -- a normalized
--    guard would skip these three again for the same reason it dropped them.
--
-- 2. Where a part number repeated inside one source file with different wording, 112
--    kept the FIRST line. For four SR-controller parts that kept the vaguer text
--    ("Micro kit component", "Control board"). Those are sharpened here, and 845-2372
--    also has its unit_family widened from SR3 to the SR2/SR3/SR4 range the other
--    source line gives.
--
-- 33-6021 needed no change: keep-first had already retained "(REV 6)" over "(REV 4)".

UPDATE public.hd_parts_reference
   SET part_function = 'HMI controller / LCD screen', unit_family = 'SR2, SR3, SR4 HMIs'
 WHERE manufacturer = 'TK' AND oem_part_number = '845-2372';

UPDATE public.hd_parts_reference
   SET part_function = 'SR2 PC board controller', unit_family = 'SR2'
 WHERE manufacturer = 'TK' AND oem_part_number = '845-2570';

UPDATE public.hd_parts_reference
   SET part_function = 'SR2 PC relay board', unit_family = 'SR2'
 WHERE manufacturer = 'TK' AND oem_part_number = '845-2571';

UPDATE public.hd_parts_reference
   SET part_function = 'SR3 PC board microprocessor', unit_family = 'SR3'
 WHERE manufacturer = 'TK' AND oem_part_number = '845-2721';

INSERT INTO public.hd_parts_reference
  (manufacturer, unit_family, part_category, part_function, oem_part_number, verified)
SELECT v.manufacturer, v.unit_family, v.part_category, v.part_function, v.oem_part_number, v.verified
FROM (VALUES
  ('Carrier', '05G', 'Hardware', 'Main front bearing, pre-bored, set of 2', '17-44015-00PB', true),
  ('Carrier', 'MOD IV', 'Hardware', 'Pin terminal, snap in', '22-50099-01A', true),
  ('Carrier', 'V2203', 'Other', 'Exhaust manifold kit', '25-39335-00-K', true)
) AS v(manufacturer, unit_family, part_category, part_function, oem_part_number, verified)
WHERE NOT EXISTS (
  SELECT 1 FROM public.hd_parts_reference p
  WHERE p.manufacturer = v.manufacturer
    AND p.oem_part_number = v.oem_part_number
);
