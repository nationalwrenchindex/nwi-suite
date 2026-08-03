-- Migration 080: link a PM checklist to an invoice.
-- The PM setup form can attach the PM to an existing open invoice, create a new
-- invoice on completion, or stay standalone (invoice_id null).

ALTER TABLE public.hd_pm_checklists
  ADD COLUMN IF NOT EXISTS invoice_id UUID REFERENCES public.hd_invoices(id) ON DELETE SET NULL;
