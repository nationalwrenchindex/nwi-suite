-- 185_hd_tech_cert_note.sql
--
-- WHAT IS WRONG. Every HD invoice footer printed "EPA Section 608 certified
-- refrigeration work - All work performed by certified technicians", a claim about
-- the subscriber that the software cannot know. The code now prints no claim by
-- default. A subscriber who wants a certification line types it in HD Settings.
--
-- WHAT THIS DOES. Adds profiles.hd_tech_cert_note: an optional free-text technician
-- certification note, blank (NULL) by default. The EPA 608 number already has its
-- own column, profiles.hd_epa_cert_number (migration 048).
--
-- No data is changed. No row gets a value. Safe to re-run.
-- Until this is applied the code reads the note as absent and the settings screen
-- does not offer the field.

BEGIN;

ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS hd_tech_cert_note TEXT;

-- Self-check: the column exists and nothing was filled in.
DO $$
DECLARE
  filled integer;
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'profiles' AND column_name = 'hd_tech_cert_note'
  ) THEN
    RAISE EXCEPTION '185: profiles.hd_tech_cert_note was not created';
  END IF;
  SELECT count(*) INTO filled FROM public.profiles WHERE hd_tech_cert_note IS NOT NULL;
  IF filled <> 0 THEN
    RAISE EXCEPTION '185: expected no filled notes, found %', filled;
  END IF;
  RAISE NOTICE '185 ok: profiles.hd_tech_cert_note exists, 0 filled';
END $$;

-- Applied by hand in the Supabase SQL editor on Nov 12, 2026. Ends in COMMIT as run.
COMMIT;
