-- Parts store: take a retailer's web address out of `source`. Brock, Nov 5, 2026.
-- Run after 15.
--
-- A read of the four store tables on Nov 5 (parts 2720, part_fitment 20636, part_supersession 61,
-- part_cross_reference 168), every text column of every row, found ONE store name and nothing else:
-- the web address of the vendor listing loaded on Oct 8 from data/parts/parts.csv and
-- data/parts/fitment.csv (scripts/load-parts.ts). It is the whole value of `source` on
--   105 parts           -> becomes 'parts-csv-2026-10-08'
--   108 part_fitment    -> becomes 'fitment-csv-2026-10-08'
-- (every one of the 108 fitment rows hangs off one of the 105 parts). Neutral keys, named for the
-- file and the load date the way the seed keys are (seed-parts-2026-10-23); mapped to their files
-- in data/parts-sources/SOURCES.md. part_supersession and part_cross_reference carry no store name.
--
-- Changes `source` on exactly those 213 rows and nothing else. No INSERT, no DELETE.
-- The name is matched by pattern below so this file does not have to spell it out.
--
-- ENDS IN ROLLBACK. Read the table it prints, then change the last line to COMMIT to keep it.
-- Preview and production share one database.

BEGIN;

DO $$
BEGIN
  IF (SELECT count(*) FROM public.parts) <> 2720 OR (SELECT count(*) FROM public.part_fitment) <> 20636
  OR (SELECT count(*) FROM public.part_supersession) <> 61 OR (SELECT count(*) FROM public.part_cross_reference) <> 168 THEN
    RAISE EXCEPTION 'store name: the store is not 2720 / 20636 / 61 / 168 - nothing applied';
  END IF;
  IF (SELECT count(*) FROM public.parts WHERE source ~* '^mincarone\.net$') <> 105
  OR (SELECT count(*) FROM public.part_fitment WHERE source ~* '^mincarone\.net$') <> 108 THEN
    RAISE EXCEPTION 'store name: not exactly 105 parts and 108 fitment rows carry it - nothing applied';
  END IF;
  IF EXISTS (SELECT 1 FROM public.parts WHERE source IN ('parts-csv-2026-10-08', 'fitment-csv-2026-10-08'))
  OR EXISTS (SELECT 1 FROM public.part_fitment WHERE source IN ('parts-csv-2026-10-08', 'fitment-csv-2026-10-08')) THEN
    RAISE EXCEPTION 'store name: a neutral key is already in use - nothing applied';
  END IF;
END $$;

UPDATE public.parts        SET source = 'parts-csv-2026-10-08'   WHERE source ~* '^mincarone\.net$';
UPDATE public.part_fitment SET source = 'fitment-csv-2026-10-08' WHERE source ~* '^mincarone\.net$';

DO $$
BEGIN
  IF (SELECT count(*) FROM public.parts WHERE source = 'parts-csv-2026-10-08') <> 105
  OR (SELECT count(*) FROM public.part_fitment WHERE source = 'fitment-csv-2026-10-08') <> 108 THEN
    RAISE EXCEPTION 'store name: not exactly 105 + 108 rows re-keyed - nothing applied';
  END IF;
  -- Nothing left anywhere in the four tables that looks like a web address or a known store.
  IF EXISTS (SELECT 1 FROM public.parts p WHERE concat_ws(' ', p.source, p.description, p.notes, p.part_type, p.manufacturer)
               ~* 'mincarone|https?:|www\.|\.(com|net|ca)\M|napa|carquest|autozone|reilly|rockauto|fridayparts|diselmart|ebay|amazon')
  OR EXISTS (SELECT 1 FROM public.part_fitment f WHERE concat_ws(' ', f.source, f.note, f.unit_model, f.engine_model, f.tier)
               ~* 'mincarone|https?:|www\.|\.(com|net|ca)\M|napa|carquest|autozone|reilly|rockauto|fridayparts|diselmart|ebay|amazon')
  OR EXISTS (SELECT 1 FROM public.part_supersession s WHERE concat_ws(' ', s.source, s.note)
               ~* 'mincarone|https?:|www\.|\.(com|net|ca)\M|napa|carquest|autozone|reilly|rockauto|fridayparts|diselmart|ebay|amazon')
  OR EXISTS (SELECT 1 FROM public.part_cross_reference x WHERE concat_ws(' ', x.source, x.brand)
               ~* 'mincarone|https?:|www\.|\.(com|net|ca)\M|napa|carquest|autozone|reilly|rockauto|fridayparts|diselmart|ebay|amazon') THEN
    RAISE EXCEPTION 'store name: a store name or web address is still in the store - nothing applied';
  END IF;
  IF (SELECT count(*) FROM public.parts) <> 2720 OR (SELECT count(*) FROM public.part_fitment) <> 20636 THEN
    RAISE EXCEPTION 'store name: row counts changed - nothing applied';
  END IF;
END $$;

-- Check (last, so it is the result the editor shows). Expect parts-csv-2026-10-08 105 and
-- fitment-csv-2026-10-08 108, and no row naming a store.
SELECT 'parts' AS tbl, source, count(*) AS rows FROM public.parts GROUP BY source
UNION ALL
SELECT 'part_fitment', source, count(*) FROM public.part_fitment GROUP BY source
ORDER BY 1, 2;

ROLLBACK;
