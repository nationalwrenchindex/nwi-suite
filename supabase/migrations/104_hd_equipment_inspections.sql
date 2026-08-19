-- Migration 104: construction and heavy-equipment inspection records.
--
-- One table for every machine class — excavator, skid steer, dozer, backhoe,
-- trencher, telehandler, forklift, crane, compactor, UTV and the compact
-- variants. The classes differ only in which checklist sections they carry,
-- which is data in lib/hd/equipment/forms.ts, not schema. Eleven tables would
-- multiply the work-order attachment, dashboard, print and PDF work with nothing
-- gained, and a unit's inspection history is only meaningful read as one ordered
-- stream. This is the same call migration 099 made for the three aerial cadences.
--
-- Deliberately mirrors hd_aerial_inspections (099/103) so both families share the
-- locked/locked_at signing model, JSONB payload, free-text unit context for
-- machines that are not registered hd_units, and the work-order/invoice links.

CREATE TABLE IF NOT EXISTS public.hd_equipment_inspections (
  id                    UUID        DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id               UUID        REFERENCES auth.users(id) ON DELETE CASCADE,
  unit_id               UUID        REFERENCES public.hd_units(id),
  fleet_account_id      UUID        REFERENCES public.hd_fleet_accounts(id),
  -- Any inspection can hang off a work order, same as aerial and DOT.
  work_order_id         UUID        REFERENCES public.hd_work_orders(id) ON DELETE SET NULL,
  -- Billed onto an invoice; SET NULL because deleting an invoice must never take
  -- a compliance document with it.
  invoice_id            UUID        REFERENCES public.hd_invoices(id) ON DELETE SET NULL,

  -- Machine class. Not a CHECK constraint: new equipment classes ship as a new
  -- form definition in application code, and a DB migration should not be needed
  -- to start inspecting a machine type the checklist already covers.
  equipment_type        TEXT        NOT NULL,
  inspection_date       DATE        NOT NULL,

  -- Daily pre-use context (performed by the operator, per shift).
  shift                 TEXT,
  operator_name         TEXT,
  operator_cert_current BOOLEAN,

  -- Free-text unit identity, so an inspection can run on a machine that is not a
  -- registered hd_unit — the same concession 083 and 099 made.
  unit_identifier       TEXT,
  unit_make             TEXT,
  unit_model            TEXT,
  unit_serial           TEXT,

  -- Periodic cadences (crane frequent/annual) capture service history.
  hour_meter            NUMERIC,
  last_frequent_date    DATE,
  last_annual_date      DATE,

  -- Crane annual records its load test on sign-off (ASME B30.5).
  load_test_performed   BOOLEAN     DEFAULT FALSE,
  load_test_date        DATE,
  load_test_notes       TEXT,

  -- Section/item results. Shape is defined by src/types/equipment.ts.
  inspection_data       JSONB       NOT NULL DEFAULT '{}',
  deficiencies          JSONB       DEFAULT '[]',

  overall_result        TEXT        NOT NULL DEFAULT 'pass'
                          CHECK (overall_result IN ('pass', 'fail')),
  -- A machine with a safety-critical failure may not be operated; recorded
  -- explicitly rather than inferred so the sign-off is auditable.
  removed_from_service  BOOLEAN     DEFAULT FALSE,

  inspector_name        TEXT,
  inspector_cert_number TEXT,
  signature_data        TEXT,

  -- Submission locks the record and stamps the time.
  locked                BOOLEAN     DEFAULT FALSE,
  locked_at             TIMESTAMPTZ,
  inspection_id         TEXT        UNIQUE,

  created_at            TIMESTAMPTZ DEFAULT NOW()
);

-- Dashboard reads "latest of each type per unit"; unit history reads one unit
-- newest-first. Both are served by this.
CREATE INDEX IF NOT EXISTS hd_equipment_inspections_unit_idx
  ON public.hd_equipment_inspections (unit_id, equipment_type, inspection_date DESC);

CREATE INDEX IF NOT EXISTS hd_equipment_inspections_user_idx
  ON public.hd_equipment_inspections (user_id, inspection_date DESC);

CREATE INDEX IF NOT EXISTS hd_equipment_inspections_work_order_idx
  ON public.hd_equipment_inspections (work_order_id)
  WHERE work_order_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS hd_equipment_inspections_invoice_idx
  ON public.hd_equipment_inspections (invoice_id)
  WHERE invoice_id IS NOT NULL;

ALTER TABLE public.hd_equipment_inspections ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Users manage own equipment inspections" ON public.hd_equipment_inspections;
CREATE POLICY "Users manage own equipment inspections"
  ON public.hd_equipment_inspections
  FOR ALL TO authenticated
  USING (user_id = auth.uid())
  WITH CHECK (user_id = auth.uid());
