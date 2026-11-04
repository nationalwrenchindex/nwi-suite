-- 182: is_single_model accepts a Thermo King model whose name ends in "+".
--
-- WHY. 148's is_single_model rejects every "+" because "SB100-310+" in the old data meant
-- "SB-100 through SB-310 and up" - a group. But Thermo King names real, single units with
-- a "+": SB-210+, SB-310+, SB-110+, SB-230+, Super II SR+, SB-III SR+, SB-III SR MP IV+ TG
-- Rail. The reefer sources of Nov 4, 2026 list 1,300+ fitment rows on those models, and
-- 148 refuses every one, so a tech with an SB-210+ in the bay finds nothing.
--
-- THE CHANGE, and only this: a "+" is accepted when it ENDS a word - directly after a
-- letter or digit, and followed by a space or the end of the string. Everything else 148
-- refuses is still refused, because those rules run first and are unchanged:
--   SB100-310+   still refused (numeric range)        Supra 6xx+   still refused (x mask)
--   + Spectrum   still refused (+ starts a word)      SB-210+/310+ still refused (slash)
--   A+B          still refused (+ inside a word)      SB series+   still refused (series)
--
-- Strictly LOOSER than 148: every row that passes today still passes. CHECK constraints are
-- not re-run against existing rows when a function is replaced, and the self-check below
-- proves none would fail anyway.
--
-- WHAT THIS DOES NOT DO. No row is inserted, updated or deleted. No table changes.
-- Preview and production share one database. Applying this applies it to both.

BEGIN;

CREATE OR REPLACE FUNCTION public.is_single_model(value TEXT)
RETURNS BOOLEAN
LANGUAGE sql
IMMUTABLE
PARALLEL SAFE
AS $$
  SELECT CASE
    WHEN value IS NULL THEN TRUE
    WHEN btrim(value) = '' THEN FALSE
    WHEN value LIKE '%,%' THEN FALSE
    WHEN value LIKE '%/%' THEN FALSE
    WHEN value ~* '(^|[^a-z])(series|family|all|various|universal|and|thru|through)([^a-z]|$)' THEN FALSE
    WHEN value ~* '[0-9]x{2,}' THEN FALSE
    WHEN value ~ '[0-9]{2,}[[:space:]]*-[[:space:]]*[0-9]{2,}' THEN FALSE
    -- 182: a "+" must end a word (SB-210+, SR+ MP); anywhere else it is still a group.
    WHEN value ~ '(^|[^A-Za-z0-9])\+' THEN FALSE
    WHEN value ~ '\+[^[:space:]]' THEN FALSE
    ELSE TRUE
  END;
$$;

COMMENT ON FUNCTION public.is_single_model(TEXT) IS
  'FALSE when a model field holds a group rather than one model: a comma or slash list, a numeric range, the words series/family/all, an x-masked family like Supra 6xx, or a + that does not end a word. 182: a + that ends a word is a real Thermo King model (SB-210+, Super II SR+).';

DO $$
DECLARE n BIGINT;
BEGIN
  -- Real single models now accepted.
  IF NOT (public.is_single_model('SB-210+') AND public.is_single_model('Super II SR+')
      AND public.is_single_model('SB-III SR MP IV+ TG Rail') AND public.is_single_model('Supra 660')
      AND public.is_single_model('S-600M')) THEN
    RAISE EXCEPTION '182: a single model is refused - nothing applied';
  END IF;
  -- Groups 148 refused, still refused.
  IF public.is_single_model('SB100-310+') OR public.is_single_model('Supra 6xx+') OR public.is_single_model('+ Spectrum')
  OR public.is_single_model('SB-210+/310+') OR public.is_single_model('A+B') OR public.is_single_model('SB series+')
  OR public.is_single_model('Supra 650,Supra 750') OR public.is_single_model('V-500/V-520') OR public.is_single_model('SB series')
  OR public.is_single_model('all units') OR public.is_single_model('T-600 and T-800') OR public.is_single_model('') THEN
    RAISE EXCEPTION '182: a group is accepted - nothing applied';
  END IF;
  -- Every existing fitment row still passes.
  SELECT count(*) INTO n FROM public.part_fitment
   WHERE NOT public.is_single_model(unit_model) OR NOT public.is_single_model(engine_model) OR NOT public.is_single_model(compressor_model);
  IF n <> 0 THEN
    RAISE EXCEPTION '182: % existing fitment row(s) would fail - nothing applied', n;
  END IF;
END $$;

-- Check (last, so it is the result the editor shows). Expect: true, true, false, false.
SELECT public.is_single_model('SB-210+')    AS sb210_plus_accepted,
       public.is_single_model('Super II SR+') AS super_ii_sr_plus_accepted,
       public.is_single_model('SB100-310+') AS range_still_refused,
       public.is_single_model('+ Spectrum') AS leading_plus_still_refused;

COMMIT;
