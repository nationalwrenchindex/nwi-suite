-- ANSI A92 / OSHA 1926.453 aerial equipment inspections.
--
-- One table for all three cadences (pre-use, frequent, annual) rather than
-- three: they share the same 8 sections and differ only by the items appended
-- and the credentials required. Separate tables would triple the work-order
-- attachment, dashboard and PDF work for no gain, and a unit's inspection
-- history is only meaningful read as one ordered stream.
--
-- Deliberately mirrors hd_dot_inspections (049/083) so both inspection families
-- share the locked/locked_at signing model, JSONB payload and free-text unit
-- context for jobs not tied to a registered hd_unit.

CREATE TABLE IF NOT EXISTS public.hd_aerial_inspections (
  id                    UUID        DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id               UUID        REFERENCES auth.users(id) ON DELETE CASCADE,
  unit_id               UUID        REFERENCES public.hd_units(id),
  fleet_account_id      UUID        REFERENCES public.hd_fleet_accounts(id),
  -- Item 5: any inspection can hang off a work order.
  work_order_id         UUID        REFERENCES public.hd_work_orders(id) ON DELETE SET NULL,

  inspection_type       TEXT        NOT NULL
                          CHECK (inspection_type IN ('pre_use', 'frequent', 'annual')),
  inspection_date       DATE        NOT NULL,

  -- Pre-use context (OSHA 1926.453: per shift, by the operator).
  shift                 TEXT,
  operator_name         TEXT,
  operator_cert_current BOOLEAN,

  -- Free-text unit identity, so an inspection can be run on a machine that is
  -- not a registered hd_unit — same concession 083 made for DOT.
  unit_identifier       TEXT,
  unit_make             TEXT,
  unit_model            TEXT,
  unit_serial           TEXT,

  -- Frequent/annual context (ANSI A92: 3 months or 150 hours; 13 months).
  hour_meter            NUMERIC,
  last_frequent_date    DATE,
  last_annual_date      DATE,

  -- Section/item results. Shape is defined by src/types/aerial.ts.
  inspection_data       JSONB       NOT NULL DEFAULT '{}',
  deficiencies          JSONB       DEFAULT '[]',

  overall_result        TEXT        NOT NULL DEFAULT 'pass'
                          CHECK (overall_result IN ('pass', 'fail')),
  -- OSHA requires a machine with a critical deficiency be taken out of service;
  -- recorded explicitly rather than inferred so the sign-off is auditable.
  removed_from_service  BOOLEAN     DEFAULT FALSE,

  inspector_name        TEXT,
  -- ANSI A92.20 requires the annual to be performed by a qualified person; the
  -- credential is enforced in the form, stored here for the record.
  inspector_cert_number TEXT,
  signature_data        TEXT,

  -- Item 7: submission locks the record and stamps the time.
  locked                BOOLEAN     DEFAULT FALSE,
  locked_at             TIMESTAMPTZ,
  inspection_id         TEXT        UNIQUE,

  created_at            TIMESTAMPTZ DEFAULT NOW()
);

-- Dashboard (item 6) reads "latest of each type per unit"; unit history (item 5)
-- reads one unit newest-first. Both are served by this.
CREATE INDEX IF NOT EXISTS hd_aerial_inspections_unit_idx
  ON public.hd_aerial_inspections (unit_id, inspection_type, inspection_date DESC);

CREATE INDEX IF NOT EXISTS hd_aerial_inspections_user_idx
  ON public.hd_aerial_inspections (user_id, inspection_date DESC);

CREATE INDEX IF NOT EXISTS hd_aerial_inspections_work_order_idx
  ON public.hd_aerial_inspections (work_order_id)
  WHERE work_order_id IS NOT NULL;

ALTER TABLE public.hd_aerial_inspections ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Users manage own aerial inspections" ON public.hd_aerial_inspections;
CREATE POLICY "Users manage own aerial inspections"
  ON public.hd_aerial_inspections
  FOR ALL TO authenticated
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);
