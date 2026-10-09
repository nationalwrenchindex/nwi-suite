-- =============================================================================
-- Four hd_parts_reference rows whose manufacturer contradicts their model
-- =============================================================================
--
-- FOR EDWARD TO RUN, AND TO DECIDE ON FIRST. I am not running it.
--
-- -- WHY THIS MATTERS NOW ----------------------------------------------------
--
-- The QuickWrench panel now constrains by manufacturer: a Carrier unit never returns
-- a Thermo King part. That is the fix for six TK parts coming back for a Supra 660.
--
-- The side effect is that a row whose manufacturer is WRONG now disappears from the
-- search it belongs in. These four rows say manufacturer = TK while naming Carrier
-- units, so a Supra 660 search no longer offers them - and before the fix they were
-- being offered to Thermo King units instead, which was worse.
--
-- -- WHY I THINK THEY ARE CARRIER, AND WHERE THAT STOPS BEING EVIDENCE -------
--
--   58-60209-01  Hose, oil, 36.5"   [Supra 660, 760, 860]
--   58-60209-02  Hose, oil, 18"     [Supra 660, 760, 860]
--        A row ALREADY IN THIS TABLE as Carrier is 58-60209-00, "Hose, oil, 44.29
--        long", [Supra 950, Supra 960]. Same 58-60209 family, same part function,
--        already filed as Carrier. That is good evidence.
--
--   58-60316-00  Air filter hose    [Supra 550/560]
--        The table already holds Carrier 58-01359-00 "Air filter hose" for
--        [Supra 6xx, Supra 7xx, Supra 8xx]. Same function, Carrier, Supra.
--
--   3355-BUMPER  Protective bumper  [7300, Vector, 2100A]
--        7300, Vector and 2100A are all Carrier units and appear nowhere else as
--        Thermo King. But "3355-BUMPER" is not a Carrier-shaped part number and I
--        cannot source it to a Carrier catalogue. THIS ONE IS A GUESS ABOUT THE
--        MANUFACTURER, and it is separated below so you can run the three and leave
--        it, which is what I would do.
--
-- Supra, Vector, 7300 and 2100A are Carrier product lines; none of them is a Thermo
-- King model. So the MODEL side of each row is not in doubt - only which column is
-- wrong. I am assuming the manufacturer is wrong rather than the model, because the
-- models are specific and consistent and a manufacturer field is one keystroke.
--
-- If you would rather I left all four alone, say so and I will revert the
-- manufacturer constraint to chip-only instead - that keeps these rows findable at
-- the cost of a Carrier search offering TK parts when no chip is pressed.
--
-- ENDS IN ROLLBACK. Read STEP 1, then change the last line to COMMIT.

-- -----------------------------------------------------------------------------
-- STEP 1. Look at them, and at the sibling rows that are the evidence.
-- -----------------------------------------------------------------------------
SELECT oem_part_number, manufacturer, unit_family, part_category, part_function
FROM   public.hd_parts_reference
WHERE  oem_part_number IN ('58-60209-01', '58-60209-02', '58-60316-00', '3355-BUMPER',
                           '58-60209-00', '58-01359-00')
ORDER  BY oem_part_number;

BEGIN;

-- -----------------------------------------------------------------------------
-- STEP 2. The three with a sibling row as evidence.
-- -----------------------------------------------------------------------------
UPDATE public.hd_parts_reference
SET    manufacturer = 'Carrier',
       notes = coalesce(notes || ' ', '')
               || 'Manufacturer corrected from TK to Carrier: the unit family names Carrier Supra models.'
WHERE  manufacturer = 'TK'
  AND  oem_part_number IN ('58-60209-01', '58-60209-02', '58-60316-00');

-- -----------------------------------------------------------------------------
-- STEP 3. The guess. Delete these three lines if you would rather leave it.
-- -----------------------------------------------------------------------------
UPDATE public.hd_parts_reference
SET    manufacturer = 'Carrier',
       notes = coalesce(notes || ' ', '')
               || 'Manufacturer corrected from TK to Carrier: 7300, Vector and 2100A are Carrier units. The part number was not sourced to a Carrier catalogue.'
WHERE  manufacturer = 'TK'
  AND  oem_part_number = '3355-BUMPER';

-- -----------------------------------------------------------------------------
-- STEP 4. Check it. Expect all four to read Carrier, and zero rows from the
-- second query.
-- -----------------------------------------------------------------------------
SELECT oem_part_number, manufacturer, unit_family, part_function
FROM   public.hd_parts_reference
WHERE  oem_part_number IN ('58-60209-01', '58-60209-02', '58-60316-00', '3355-BUMPER')
ORDER  BY oem_part_number;

-- Expect zero rows: no TK row should name a Carrier Supra, Vector, Ultra or Ultima.
-- X426/X430/X214/X418/X640 are THERMO KING COMPRESSORS and are excluded - they are
-- correctly filed as TK, and an earlier version of this check wrongly flagged 49 of
-- them as Carrier.
SELECT oem_part_number, manufacturer, unit_family, part_function
FROM   public.hd_parts_reference
WHERE  manufacturer = 'TK'
  AND  unit_family ~* '(supra|vector|ultima|solara|maxima)'
  AND  unit_family !~* 'x(214|418|426|430|640)';

-- Expect the total to be unchanged at 960. This script edits four rows, never adds
-- or removes any.
SELECT count(*) AS parts_reference_rows FROM public.hd_parts_reference;

-- -----------------------------------------------------------------------------
-- Read STEP 1 and STEP 4, then change this to COMMIT and run it again.
-- -----------------------------------------------------------------------------
ROLLBACK;
