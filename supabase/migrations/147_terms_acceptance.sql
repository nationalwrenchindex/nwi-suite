-- =============================================================================
-- 147  Terms and Privacy acceptance, recorded per account
-- =============================================================================
--
-- ADDITIVE ONLY. Five nullable columns, one trigger. No existing row is modified,
-- no column is dropped, nothing is backfilled. Safe to run while the site is up.
--
-- -- WHY A TRIGGER AND NOT A CHECK IN THE APP --------------------------------
--
-- Clause 10.4 of the Terms says acceptance is recorded against a version, and that
-- clause only has value if it cannot be bypassed. Onboarding writes the profile
-- DIRECTLY FROM THE BROWSER through RLS - there is no API route in the middle - so a
-- disabled button and a client-side check are the only things standing between an
-- unchecked box and a usable account. Anyone can call the same update from a console.
--
-- So the refusal lives in the database, which is the one place a browser cannot talk
-- its way past.
--
-- -- WHAT THE TRIGGER DOES, AND WHAT IT DELIBERATELY DOES NOT -----------------
--
-- It fires ONLY when business_name goes from NULL to a value - that is the moment
-- onboarding completes and the account becomes usable. At that moment
-- terms_accepted_at must be set.
--
-- It does NOT fire when:
--   * business_name is already set and something else is edited. Every existing
--     subscriber has a business_name and no acceptance on record, and locking them out
--     of their own settings page would be an outage of our own making.
--   * business_name is being cleared, or is unchanged.
--   * a profile row is INSERTed. Profile creation happens at signup before the user has
--     seen anything to accept; the gate belongs at the point the account becomes usable,
--     not before.
--
-- Existing subscribers are prompted to accept on their next visit by the application,
-- which records it the same way. They are asked, not locked out.

BEGIN;

-- -----------------------------------------------------------------------------
-- 1. The columns
-- -----------------------------------------------------------------------------
ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS terms_accepted_at      TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS terms_version          TEXT,
  ADD COLUMN IF NOT EXISTS privacy_accepted_at    TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS acceptance_ip          TEXT,
  ADD COLUMN IF NOT EXISTS acceptance_user_agent  TEXT;

COMMENT ON COLUMN public.profiles.terms_accepted_at IS
  'When this account accepted the Terms of Service. NULL means never accepted - which is true of every account created before 2026-10-06, so it is not an error.';

COMMENT ON COLUMN public.profiles.terms_version IS
  'Which version of the Terms was accepted, as the date string shown on /terms (e.g. 2026-10-06). Compared against the current version to decide whether to re-prompt. NULL with a non-null terms_accepted_at would mean a recording bug.';

COMMENT ON COLUMN public.profiles.privacy_accepted_at IS
  'When this account accepted the Privacy Policy. Recorded alongside the Terms because they are presented together; kept separate so either can be versioned independently later.';

COMMENT ON COLUMN public.profiles.acceptance_ip IS
  'The IP the acceptance was submitted from, as seen by the server. Evidence of who agreed and from where. Captured server-side because a client cannot report its own IP honestly.';

COMMENT ON COLUMN public.profiles.acceptance_user_agent IS
  'The User-Agent string at acceptance. Weak evidence on its own, but it is what distinguishes a person clicking from a script replaying a request.';

-- An index is deliberately omitted. These columns are read one row at a time by
-- primary key, and the only aggregate query - "who has not accepted the current
-- version" - runs across 27 rows.

-- -----------------------------------------------------------------------------
-- 2. The gate
-- -----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.require_terms_acceptance()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
  -- Only the transition that makes an account usable.
  IF OLD.business_name IS NULL
     AND NEW.business_name IS NOT NULL
     AND NEW.terms_accepted_at IS NULL
  THEN
    RAISE EXCEPTION
      'Terms of Service must be accepted before completing setup.'
      USING ERRCODE = 'check_violation',
            HINT    = 'POST /api/legal/accept first, then save the profile.';
  END IF;

  RETURN NEW;
END;
$$;

COMMENT ON FUNCTION public.require_terms_acceptance() IS
  'Refuses to let a profile complete onboarding without a recorded Terms acceptance. Fires only on the NULL-to-value transition of business_name, so existing subscribers editing their settings are never blocked.';

DROP TRIGGER IF EXISTS trg_require_terms_acceptance ON public.profiles;

CREATE TRIGGER trg_require_terms_acceptance
  BEFORE UPDATE ON public.profiles
  FOR EACH ROW
  EXECUTE FUNCTION public.require_terms_acceptance();

-- -----------------------------------------------------------------------------
-- 3. Check it
-- -----------------------------------------------------------------------------
-- Expect all five columns listed.
SELECT column_name, data_type, is_nullable
FROM   information_schema.columns
WHERE  table_schema = 'public'
  AND  table_name   = 'profiles'
  AND  column_name IN ('terms_accepted_at', 'terms_version', 'privacy_accepted_at',
                       'acceptance_ip', 'acceptance_user_agent')
ORDER  BY column_name;

-- Expect one row: trg_require_terms_acceptance on profiles, BEFORE UPDATE.
SELECT trigger_name, event_manipulation, action_timing
FROM   information_schema.triggers
WHERE  event_object_schema = 'public'
  AND  event_object_table  = 'profiles'
  AND  trigger_name        = 'trg_require_terms_acceptance';

-- Expect: total 27-ish, accepted 0, pending all of them. Nothing is backfilled, so
-- every existing account reads as not yet accepted and will be prompted on next visit.
SELECT count(*)                                            AS profiles_total,
       count(*) FILTER (WHERE terms_accepted_at IS NOT NULL) AS accepted,
       count(*) FILTER (WHERE terms_accepted_at IS NULL)     AS pending
FROM   public.profiles;

-- Expect zero rows. A set acceptance timestamp with no version is a recording bug.
SELECT id, terms_accepted_at, terms_version
FROM   public.profiles
WHERE  terms_accepted_at IS NOT NULL
  AND  terms_version IS NULL;

COMMIT;
