-- Migration 082: guarantee the hd_pm_checklists table + all columns exist.
-- Originally created in 047; invoice_id added in 080. This idempotent migration ensures
-- the table exists (even if 047 never ran) and that invoice_id is present (even if 080
-- never ran), which is the likely cause of the "database error on complete".

CREATE TABLE IF NOT EXISTS public.hd_pm_checklists (
  id                     UUID        DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id                UUID        NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  work_order_id          UUID        REFERENCES public.hd_work_orders(id) ON DELETE SET NULL,
  unit_id                UUID        REFERENCES public.hd_units(id) ON DELETE SET NULL,
  invoice_id             UUID        REFERENCES public.hd_invoices(id) ON DELETE SET NULL,
  pm_type                TEXT        NOT NULL,
  checklist_data         JSONB       NOT NULL DEFAULT '{}',
  safety_acknowledged    BOOLEAN     DEFAULT false,
  safety_acknowledged_at TIMESTAMPTZ,
  safety_initials        TEXT,
  alarm_codes_found      TEXT,
  alarm_codes_cleared    TEXT,
  battery_cca            INTEGER,
  flagged_items          JSONB,
  signature_base64       TEXT,
  tech_name              TEXT,
  completed_at           TIMESTAMPTZ,
  created_at             TIMESTAMPTZ DEFAULT NOW()
);

-- Backfill columns onto a partially-migrated table.
ALTER TABLE public.hd_pm_checklists
  ADD COLUMN IF NOT EXISTS invoice_id UUID REFERENCES public.hd_invoices(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS unit_id    UUID REFERENCES public.hd_units(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS completed_at TIMESTAMPTZ;

ALTER TABLE public.hd_pm_checklists ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "own pm checklists" ON public.hd_pm_checklists;
CREATE POLICY "own pm checklists" ON public.hd_pm_checklists
  FOR ALL TO authenticated
  USING (user_id = auth.uid())
  WITH CHECK (user_id = auth.uid());

CREATE INDEX IF NOT EXISTS idx_hd_pm_checklists_user ON public.hd_pm_checklists (user_id);
CREATE INDEX IF NOT EXISTS idx_hd_pm_checklists_unit ON public.hd_pm_checklists (unit_id);
