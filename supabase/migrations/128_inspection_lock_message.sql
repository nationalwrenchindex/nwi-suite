-- Migration 128: tidy the message raised by the inspection lock.
--
-- Cosmetic only. Migration 127's enforcement is correct and unchanged — this replaces
-- the function body so the text a developer meets when a write is refused reads like a
-- sentence. The old message came out as:
--
--   Inspection 07d019d5… is signed and locked (2026-08-08 05:10:21.76+00 ) and cannot be update .
--
-- Two faults. The format string had a space before the closing paren and before the
-- full stop, and `lower(TG_OP)` yields the bare verb, so it read "cannot be update"
-- rather than "cannot be updated". TG_OP is always UPDATE or DELETE here, so the past
-- participle is a two-case mapping rather than anything clever.
--
-- The timestamp is formatted rather than interpolated raw: to_char gives a stable,
-- readable stamp instead of leaning on whatever the session's DateStyle happens to be.
-- COALESCE covers a row locked before locked_at existed.
--
-- CREATE OR REPLACE on the function alone. The four triggers from 127 bind to the
-- function by name and keep working untouched, so nothing needs re-attaching and the
-- lock is never off, even momentarily, while this runs.

CREATE OR REPLACE FUNCTION public.reject_locked_inspection_write()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
DECLARE
  verb   TEXT;
  stamp  TEXT;
BEGIN
  IF COALESCE(OLD.locked, false) THEN
    verb  := CASE TG_OP WHEN 'DELETE' THEN 'deleted' ELSE 'modified' END;
    stamp := COALESCE(to_char(OLD.locked_at AT TIME ZONE 'UTC', 'YYYY-MM-DD HH24:MI UTC'), 'an earlier date');

    RAISE EXCEPTION
      'This inspection was signed and locked on % and cannot be %. Record %.',
      stamp, verb, OLD.id
      USING
        ERRCODE = 'check_violation',
        HINT    = 'Signed inspections are immutable compliance records. To amend one deliberately, disable the trigger on this table as the postgres role, make the change, then re-enable it. See migration 127.';
  END IF;

  IF TG_OP = 'DELETE' THEN
    RETURN OLD;
  END IF;
  RETURN NEW;
END;
$$;

COMMENT ON FUNCTION public.reject_locked_inspection_write() IS
  'Blocks UPDATE and DELETE on any inspection row whose locked flag is true. Applies to every role including service_role, which is why this is a trigger rather than an RLS policy. See migrations 127 and 128.';

-- Verification — should raise, with the message reading as a sentence:
--   UPDATE public.hd_pm_checklists SET tech_name = tech_name WHERE locked;
-- Expected:
--   This inspection was signed and locked on 2026-08-08 05:14 UTC and cannot be
--   modified. Record 9ca35a91-….
