-- Migration 127: make the inspection lock actually hold.
--
-- All four HD inspection families carry locked/locked_at, and until now the column was
-- DOCUMENTARY — it recorded that a record had been signed, and nothing stopped anyone
-- changing it afterwards. That was survivable only by accident: an audit of every
-- access to these four tables found exclusively .insert() and .select() calls, zero
-- .update() and zero .delete(). The records were immutable because no code had been
-- written to modify them, which is not the same as a guarantee. Anyone adding an edit
-- screen, a bulk fix-up script, or a support tool would have silently removed it.
--
-- These are signed compliance documents. A DOT annual, an ANSI A92 aerial inspection,
-- an OSHA equipment inspection and a reefer PM are all things a customer, an inspector
-- or an insurer may rely on. "Signed at 14:32 and unchanged since" has to be a fact
-- about the database, not an observation about the current codebase.
--
-- ── WHY A TRIGGER AND NOT RLS ────────────────────────────────────────────────
-- The obvious implementation is an RLS policy: keep the owner's FOR ALL policy for
-- SELECT and INSERT, and add `AND locked IS NOT TRUE` to UPDATE and DELETE. It does not
-- work here, for two reasons.
--
-- First, RLS does not apply to the service-role key. Several of these routes already
-- use the service client — the PM checklist inserts through it — so an RLS-only rule
-- would be bypassed by exactly the code most likely to be written next. The hole would
-- sit precisely where the guarantee is needed.
--
-- Second, every one of these tables carries a FOR ALL owner policy, some of them
-- defined twice across different migrations (hd_pm_checklists has both "Users manage
-- own hd pm checklists" and "own pm checklists"). Splitting FOR ALL into four
-- per-command policies on four tables means dropping and recreating policies that
-- other migrations also define, and getting one name wrong silently removes a tenant
-- boundary. That is a large amount of risk to the thing that keeps subscribers' records
-- apart, in service of a weaker guarantee.
--
-- A BEFORE UPDATE OR DELETE trigger applies to every role, service_role included,
-- leaves the existing policies untouched, and is one function shared by four tables.
-- RLS still does its job — deciding whose rows you can see and write. This decides
-- whether a signed row may change at all, which is a different question.

CREATE OR REPLACE FUNCTION public.reject_locked_inspection_write()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
  -- Only locked rows are protected. A row is locked at insert by its route, so in
  -- practice every row is protected from the moment it exists; the check is on OLD so
  -- an unlocked legacy row can still be corrected and then locked.
  IF COALESCE(OLD.locked, false) THEN
    RAISE EXCEPTION
      'Inspection % is signed and locked (% ) and cannot be % .',
      OLD.id, OLD.locked_at, lower(TG_OP)
      USING
        ERRCODE = 'check_violation',
        HINT    = 'Signed inspections are immutable compliance records. To correct one deliberately, disable this trigger as the postgres role, make the change, and re-enable it — see migration 127.';
  END IF;

  -- DELETE returns OLD; UPDATE returns NEW. Unlocked rows pass straight through.
  IF TG_OP = 'DELETE' THEN
    RETURN OLD;
  END IF;
  RETURN NEW;
END;
$$;

COMMENT ON FUNCTION public.reject_locked_inspection_write() IS
  'Blocks UPDATE and DELETE on any inspection row whose locked flag is true. Applies to every role including service_role, which is why this is a trigger rather than an RLS policy. See migration 127.';

-- ── Attach to all four families ──────────────────────────────────────────────
-- DROP then CREATE rather than CREATE OR REPLACE: Postgres has no CREATE OR REPLACE
-- TRIGGER before 14, and the DROP form is idempotent on every version.

DROP TRIGGER IF EXISTS trg_lock_pm_checklists ON public.hd_pm_checklists;
CREATE TRIGGER trg_lock_pm_checklists
  BEFORE UPDATE OR DELETE ON public.hd_pm_checklists
  FOR EACH ROW EXECUTE FUNCTION public.reject_locked_inspection_write();

DROP TRIGGER IF EXISTS trg_lock_dot_inspections ON public.hd_dot_inspections;
CREATE TRIGGER trg_lock_dot_inspections
  BEFORE UPDATE OR DELETE ON public.hd_dot_inspections
  FOR EACH ROW EXECUTE FUNCTION public.reject_locked_inspection_write();

DROP TRIGGER IF EXISTS trg_lock_aerial_inspections ON public.hd_aerial_inspections;
CREATE TRIGGER trg_lock_aerial_inspections
  BEFORE UPDATE OR DELETE ON public.hd_aerial_inspections
  FOR EACH ROW EXECUTE FUNCTION public.reject_locked_inspection_write();

DROP TRIGGER IF EXISTS trg_lock_equipment_inspections ON public.hd_equipment_inspections;
CREATE TRIGGER trg_lock_equipment_inspections
  BEFORE UPDATE OR DELETE ON public.hd_equipment_inspections
  FOR EACH ROW EXECUTE FUNCTION public.reject_locked_inspection_write();

-- ── WHAT THIS BLOCKS, AND THE DELIBERATE WAY OUT ─────────────────────────────
-- Blocked on a locked row: every UPDATE and every DELETE, from every role. That
-- includes clearing the lock itself — `SET locked = false` is an UPDATE on a locked
-- row, so a record cannot quietly unlock itself. It also includes attaching an invoice
-- after the fact; no code does that today (invoice_id is set at insert), and if it is
-- ever wanted it should be an explicit exception added here, not a loophole left open.
--
-- Not blocked: INSERT, and any write to a row that is not locked.
--
-- To correct a signed record deliberately, as the postgres role in the SQL editor:
--
--   ALTER TABLE public.hd_pm_checklists DISABLE TRIGGER trg_lock_pm_checklists;
--   -- make the correction
--   ALTER TABLE public.hd_pm_checklists ENABLE  TRIGGER trg_lock_pm_checklists;
--
-- Deliberately awkward. Amending a signed compliance document should be a decision
-- somebody makes on purpose and can account for, not something a stray query does.
--
-- Verification — both of these should raise, not succeed:
--   UPDATE public.hd_pm_checklists SET tech_name = 'x' WHERE locked LIMIT 1;
--   DELETE FROM public.hd_dot_inspections WHERE locked;
