-- =============================================================================
-- 146  invoices.source_work_order_id
-- =============================================================================
--
-- An LD invoice records source = 'work_order' and source_quote_id, but nothing
-- naming the WORK ORDER it was converted from. So from an invoice you cannot get
-- back to the segments that priced it, which is why the INV-2026-0008 re-itemize
-- script has to name both documents by hand instead of joining.
--
-- -- WHAT ALREADY EXISTS, because this is a half-built link and not a missing one -
--
--   work_orders.converted_invoice_id   LD work order -> invoice.  POPULATED:
--                                      10 of 10 conversions, zero orphans.
--   work_orders.converted_at           when that happened.
--   hd_invoices.work_order_id          HD already has the back-pointer, plus
--   hd_invoices.work_order_number      the human number. HD needs NOTHING here.
--
-- So the relationship is recorded, one-directionally. This adds the other
-- direction, which is the one every reader of an invoice actually needs.
--
-- -- WHY THE BACKFILL IS EXACT AND NOT A GUESS --------------------------------
--
-- It is derived from converted_invoice_id, which the converter itself wrote at the
-- moment of conversion. That is the authoritative record of which work order became
-- which invoice. Nothing is matched on customer, date or totals, so no invoice can
-- be attached to the wrong job.
--
-- Verified read-only before writing this: all 10 work-order invoices are reachable
-- from a work order, so the backfill resolves every one of them.
--
-- ON DELETE SET NULL, not CASCADE. Deleting a work order must never delete the
-- invoice that billed it - that is billed history, and in most states a tax record.

-- -----------------------------------------------------------------------------
-- 1. The column
-- -----------------------------------------------------------------------------
ALTER TABLE public.invoices
  ADD COLUMN IF NOT EXISTS source_work_order_id UUID
    REFERENCES public.work_orders(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_invoices_source_work_order
  ON public.invoices (source_work_order_id)
  WHERE source_work_order_id IS NOT NULL;

COMMENT ON COLUMN public.invoices.source_work_order_id IS
  'The work order this invoice was converted from. NULL for an invoice typed by hand or converted from a quote - it is not an error. Mirrors hd_invoices.work_order_id. Backfilled in 146 from work_orders.converted_invoice_id, which the converter wrote at conversion time.';

-- -----------------------------------------------------------------------------
-- 2. The backfill, from the forward link that already exists
-- -----------------------------------------------------------------------------
UPDATE public.invoices i
SET    source_work_order_id = w.id
FROM   public.work_orders w
WHERE  w.converted_invoice_id = i.id
  AND  i.source_work_order_id IS NULL
  -- Belt and braces: a work order and the invoice it made always belong to the
  -- same subscriber, and a cross-user link would be a security problem, not a typo.
  AND  w.user_id = i.user_id;

-- -----------------------------------------------------------------------------
-- 3. Check it
-- -----------------------------------------------------------------------------
-- Expect: linked = 10, and orphans = 0.
--
-- An orphan here means an invoice that says it came from a work order but that no
-- work order claims. That is worth looking at rather than fixing blindly.
SELECT count(*) FILTER (WHERE source_work_order_id IS NOT NULL) AS linked,
       count(*) FILTER (WHERE source_work_order_id IS NULL)     AS orphans,
       count(*)                                                 AS work_order_invoices
FROM   public.invoices
WHERE  source = 'work_order';

-- And nothing should have been linked across users.
-- Expect zero rows.
SELECT i.invoice_number, i.user_id AS invoice_user, w.user_id AS work_order_user
FROM   public.invoices i
JOIN   public.work_orders w ON w.id = i.source_work_order_id
WHERE  w.user_id <> i.user_id;
