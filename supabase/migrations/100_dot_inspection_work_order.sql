-- Migration 100: let a DOT inspection hang off a work order.
--
-- 099 gave hd_aerial_inspections a work_order_id on day one, so aerial records
-- already show up on the job they were performed for. hd_dot_inspections predates
-- that decision (049/083) and only ever linked upward to an invoice, which is the
-- billing artifact, not the job — a DOT sheet done during a service call had no way
-- back to the work order. That asymmetry is only visible now that the work-order
-- detail page lists both families in one stream: without this column that section
-- could only ever show half the compliance record for the job.
--
-- ON DELETE SET NULL mirrors 099 and the existing invoice_id: a signed inspection is
-- a regulatory record with its own retention requirement, so deleting the work order
-- must detach it, never cascade it away.

ALTER TABLE public.hd_dot_inspections
  ADD COLUMN IF NOT EXISTS work_order_id UUID REFERENCES public.hd_work_orders(id) ON DELETE SET NULL;

-- Partial index: the only query is "inspections attached to this work order", and
-- most DOT inspections are standalone annuals with no work order, so indexing the
-- NULLs would roughly double the index for rows it can never serve.
CREATE INDEX IF NOT EXISTS idx_hd_dot_inspections_work_order
  ON public.hd_dot_inspections (work_order_id)
  WHERE work_order_id IS NOT NULL;
