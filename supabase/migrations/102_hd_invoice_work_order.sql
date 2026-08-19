-- Migration 102: link an HD invoice back to the work order it was billed from.
--
-- The "Create Invoice" button on the work order detail page converts a work order
-- into a new invoice. These columns preserve that relationship so an invoice can be
-- traced back to the job it came from. work_order_number is denormalized alongside
-- the FK because the printed invoice has to keep showing the number even if the
-- work order is later deleted (the FK nulls out, the text stays).

ALTER TABLE public.hd_invoices
  ADD COLUMN IF NOT EXISTS work_order_id     UUID REFERENCES public.hd_work_orders(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS work_order_number TEXT;

CREATE INDEX IF NOT EXISTS idx_hd_invoices_work_order
  ON public.hd_invoices (work_order_id);
