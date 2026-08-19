-- Migration 103: attach an aerial inspection to the invoice that billed it.
--
-- hd_aerial_inspections (099) deliberately mirrors hd_dot_inspections, but was
-- created without the invoice_id link 083 gave the DOT table. That left aerial
-- records unable to appear in an invoice's Attached Reports, so a customer billed
-- for an ANSI A92 inspection received an invoice with no reference to the report.
--
-- Same shape as the DOT column: ON DELETE SET NULL, because deleting an invoice
-- must never take the inspection record with it — the inspection is a compliance
-- document with its own retention life, the invoice is just what billed it.

ALTER TABLE public.hd_aerial_inspections
  ADD COLUMN IF NOT EXISTS invoice_id UUID REFERENCES public.hd_invoices(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS hd_aerial_inspections_invoice_idx
  ON public.hd_aerial_inspections (invoice_id)
  WHERE invoice_id IS NOT NULL;
