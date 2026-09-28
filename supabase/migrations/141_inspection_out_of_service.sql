-- ─── 141. FAIL and OUT OF SERVICE are two separate decisions ──────────────────
--
-- WHY
-- A fail on any checkpoint used to flag the whole unit, so a missing DOT decal read
-- exactly like a cracked boom weld. Shops will not use a form honestly when failing
-- an item shuts down a working machine -- they mark it Pass, and then the form is
-- worth nothing.
--
-- 49 CFR 396.11 asks the mechanic to certify whether a defect "would affect the
-- safety of operation." CVSA out-of-service criteria are a separate standard from
-- "something is wrong." The form has to ask both questions, so the record has to be
-- able to hold both answers.
--
-- Pass / Fail / N-A is unchanged. No fourth grade: a third button turns an objective
-- form into a judgment call and becomes a dumping ground.
--
-- ── SMALLER THAN IT LOOKS, and here is why ────────────────────────────────────
-- Only ONE of the six inspection form types stores item results as rows:
--
--   inspection_items                 LD multi-point       ROWS  <- this migration
--   hd_dot_inspections               inspection_data      JSONB
--   hd_aerial_inspections            inspection_data      JSONB
--   hd_equipment_inspections         inspection_data      JSONB
--   hd_pm_checklists                 checklist_data       JSONB
--   fleet_pro_pretrip_inspections    checklist_data       JSONB
--
-- The five JSONB forms carry the same two fields inside their item shape, which is
-- defined in TypeScript (src/lib/inspections/out-of-service.ts) and needs no DDL.
--
-- And there is NO checkpoint template table to put auto_oos on. Every checkpoint
-- list lives in application code -- src/lib/hd/dot-categories.ts,
-- src/lib/hd/aerial/sections.ts, src/lib/hd/equipment/sections/*.ts and the LD
-- 25-point list -- so the auto-out-of-service marker is a field on those
-- definitions, not a column. 79 of 796 checkpoints carry it (9.9%).

-- ── 1. LD multi-point item results ────────────────────────────────────────────
ALTER TABLE public.inspection_items
  ADD COLUMN IF NOT EXISTS out_of_service boolean,
  ADD COLUMN IF NOT EXISTS oos_note       text;

-- NULLABLE ON PURPOSE, and this is the backward-compatibility contract.
--
-- NULL means THE QUESTION WAS NEVER ASKED. It does not mean "no". Every existing
-- inspection_items row has a fail with no out-of-service position, and those are DOT
-- records -- a historical record must read exactly as it reads today. Readers treat
-- NULL as "not assessed" and fall back to the status they already display; they must
-- never coerce it to false, because false is a mechanic's certification that the
-- defect does not affect safety of operation, and nobody made that call.
COMMENT ON COLUMN public.inspection_items.out_of_service IS
  'TRUE = this defect takes the unit out of service. FALSE = mechanic certified it does not. NULL = never asked (pre-141 record) — never coerce to false.';
COMMENT ON COLUMN public.inspection_items.oos_note IS
  'Required whenever out_of_service is set either way. Deadlining a machine, or choosing not to, needs a reason on the record.';

-- The follow-up list reads "failed, in service, not yet closed out" across a shop's
-- whole history, so it gets the same partial-index treatment the declined-segment
-- list got in migration 137.
CREATE INDEX IF NOT EXISTS inspection_items_repairs_idx
  ON public.inspection_items (inspection_id)
  WHERE status IN ('fail', 'needs_attention') AND out_of_service IS NOT TRUE;

CREATE INDEX IF NOT EXISTS inspection_items_oos_idx
  ON public.inspection_items (inspection_id)
  WHERE out_of_service IS TRUE;

-- ── 2. Nothing is backfilled ──────────────────────────────────────────────────
-- Deliberately no UPDATE in this migration. Existing fails stay NULL, which is the
-- honest value, and every unit whose status rests on them reads "needs repair — not
-- assessed for OOS" rather than having an answer invented for it. New inspections
-- only, exactly as specified.

-- ── 3. The inspection-level flag, on the three tables that lacked it ───────────
--
-- hd_aerial_inspections and hd_equipment_inspections have carried
-- removed_from_service since migrations 099 and 104. The other three never had it, so
-- a DOT annual — the form that actually covers brakes, frame welds and coupling
-- devices — had nowhere to record an out-of-service determination at all.
--
-- The Fleet Pro rollups read this column directly. Without it, a DOT inspection could
-- store a per-item determination in its JSONB payload and no dashboard would ever see
-- it, which is the bug this whole change exists to fix.
--
-- NULLABLE, WITH NO DEFAULT, deliberately. 099 and 104 used DEFAULT FALSE, so their
-- historical rows read as "answered no" — defensible there, because those forms have
-- always refused to submit a safety-critical failure without an explicit
-- confirmation, so false really is an answer. These three have no such history, so a
-- default of false would fabricate one. NULL means never asked.
ALTER TABLE public.hd_dot_inspections
  ADD COLUMN IF NOT EXISTS removed_from_service boolean;
ALTER TABLE public.hd_pm_checklists
  ADD COLUMN IF NOT EXISTS removed_from_service boolean;
ALTER TABLE public.fleet_pro_pretrip_inspections
  ADD COLUMN IF NOT EXISTS removed_from_service boolean;

COMMENT ON COLUMN public.hd_dot_inspections.removed_from_service IS
  'TRUE = at least one defect takes the vehicle out of service. FALSE = inspector certified none do. NULL = never asked (pre-141) — never coerce to false.';
