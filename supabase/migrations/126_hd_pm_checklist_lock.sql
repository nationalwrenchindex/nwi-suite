-- Migration 126: locked / locked_at on hd_pm_checklists.
--
-- The reefer PM was the only one of the four HD inspection families without them.
-- hd_dot_inspections (049/083), hd_aerial_inspections (099) and
-- hd_equipment_inspections all stamp locked=true and locked_at=NOW() at insert, and
-- their detail pages and PDFs print "Record locked <timestamp>" from it. A PM carried
-- a signature and a completed_at but nothing saying when it became final, so the one
-- inspection type a customer is most likely to receive as a service record was the one
-- that could not show it had been closed out.
--
-- ── WHAT THIS LOCK IS, AND WHAT IT IS NOT ────────────────────────────────────
-- Be clear about this, because the column name promises more than the system
-- delivers. Across ALL FOUR inspection tables the lock is DOCUMENTARY, not enforced:
-- nothing in the codebase reads `locked` to refuse a write. It is safe today only
-- because these tables are insert-only — there is no update route on any of them — so
-- the lock records a fact rather than preventing an action.
--
-- This migration deliberately matches that existing model rather than inventing a
-- stricter one for a single table, because a lock that means one thing on three tables
-- and another on the fourth is worse than a consistent weak one. If the lock should
-- actually prevent modification, the fix is a policy or trigger applied to all four
-- together, so the guarantee is uniform. That is a separate change.

ALTER TABLE public.hd_pm_checklists
  ADD COLUMN IF NOT EXISTS locked    BOOLEAN DEFAULT false,
  ADD COLUMN IF NOT EXISTS locked_at TIMESTAMPTZ;

COMMENT ON COLUMN public.hd_pm_checklists.locked IS
  'True once the PM has been signed and submitted. Documentary only — no code path enforces it; the table is insert-only. Matches hd_dot_inspections, hd_aerial_inspections and hd_equipment_inspections.';

COMMENT ON COLUMN public.hd_pm_checklists.locked_at IS
  'When the PM was signed and closed out. Printed on the report as the signing timestamp.';

-- ── BACKFILL ─────────────────────────────────────────────────────────────────
-- Every existing PM row is already a finished, signed record — the form only writes on
-- submit, so completed_at is populated and there is no draft state to protect. Leaving
-- them locked=false would misreport finished inspections as open, which is the exact
-- confusion the column exists to remove. locked_at takes completed_at rather than NOW()
-- so the stamp reflects when the work was actually signed off, not when this migration
-- happened to run.
UPDATE public.hd_pm_checklists
SET    locked    = true,
       locked_at = COALESCE(completed_at, created_at)
WHERE  locked IS DISTINCT FROM true
  AND  completed_at IS NOT NULL;

-- Verification:
--   SELECT count(*) FILTER (WHERE locked) AS locked,
--          count(*) FILTER (WHERE NOT locked OR locked IS NULL) AS unlocked,
--          count(*) AS total
--   FROM public.hd_pm_checklists;
-- Expect unlocked = 0 while every row has a completed_at.
