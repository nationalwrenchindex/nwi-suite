-- +===========================================================================+
-- | OPTIONAL - delete the ACCEPTANCE TEST rows I created                       |
-- +===========================================================================+
--
-- NOT RUN BY ME. This DELETES rows, which cannot be undone without a restore.
--
-- -- WHAT THESE ARE -----------------------------------------------------------
--
-- Six work orders created while chasing a deployment that kept not landing, one per
-- run of scripts/live-convert-check.ts, plus the one invoice the successful run
-- produced. All of them carry "ACCEPTANCE TEST" in job_description, so nothing real
-- can match that.
--
--   WO-2026-0022 .. WO-2026-0027   work orders
--   INV-2026-0020                  the invoice WO-2026-0027 converted into, proving
--                                  the 753.18 figure end to end
--
-- The script no longer does this: it reuses an existing unconverted ACCEPTANCE TEST
-- work order rather than creating another one each run.
--
-- -- THE ONE THING TO KNOW BEFORE RUNNING IT ----------------------------------
--
-- NUMBERING. Both work orders and invoices get their next number by reading the most
-- recent existing number and adding one. Deleting the highest-numbered rows frees
-- those numbers, so the next real work order will be WO-2026-0022 again and the next
-- invoice INV-2026-0020 again. That is harmless, but if you would rather the sequence
-- never reused a number, leave these rows in place - they are inert.
--
-- -- ORDER MATTERS ------------------------------------------------------------
--
-- The invoice is deleted FIRST, and the work order's converted_invoice_id cleared,
-- because work_orders.converted_invoice_id references invoices and a work order
-- pointing at a deleted invoice is worse than either row existing.

BEGIN;

-- -----------------------------------------------------------------------------
-- STEP 1 - exactly what will be deleted. Read this before going further.
-- Expect 6 work orders and 1 invoice.
-- -----------------------------------------------------------------------------
SELECT 'work_order' AS kind,
       work_order_number AS number,
       status,
       grand_total,
       converted_invoice_id IS NOT NULL AS converted,
       job_description
FROM   public.work_orders
WHERE  job_description LIKE 'ACCEPTANCE TEST%'
UNION ALL
SELECT 'invoice',
       i.invoice_number,
       i.invoice_status,
       i.total,
       NULL,
       i.notes
FROM   public.invoices i
WHERE  i.id IN (
         SELECT w.converted_invoice_id
         FROM   public.work_orders w
         WHERE  w.job_description LIKE 'ACCEPTANCE TEST%'
           AND  w.converted_invoice_id IS NOT NULL
       )
ORDER  BY kind, number;

-- -----------------------------------------------------------------------------
-- STEP 2 - break the link, then delete the invoice, then the work orders
-- -----------------------------------------------------------------------------

-- Keep the ids before the link is cleared.
CREATE TEMP TABLE acc_test_invoices AS
SELECT DISTINCT w.converted_invoice_id AS id
FROM   public.work_orders w
WHERE  w.job_description LIKE 'ACCEPTANCE TEST%'
  AND  w.converted_invoice_id IS NOT NULL;

UPDATE public.work_orders
SET    converted_invoice_id = NULL,
       converted_at         = NULL
WHERE  job_description LIKE 'ACCEPTANCE TEST%';

DELETE FROM public.invoices
WHERE  id IN (SELECT id FROM acc_test_invoices);

DELETE FROM public.work_orders
WHERE  job_description LIKE 'ACCEPTANCE TEST%';

-- -----------------------------------------------------------------------------
-- STEP 3 - confirm. Both counts must be 0.
-- -----------------------------------------------------------------------------
SELECT (SELECT count(*) FROM public.work_orders
          WHERE job_description LIKE 'ACCEPTANCE TEST%')        AS work_orders_left,
       (SELECT count(*) FROM public.invoices i
          JOIN acc_test_invoices a ON a.id = i.id)              AS invoices_left;

-- And nothing real was touched: this must still return every other work order.
SELECT count(*) AS other_work_orders_untouched
FROM   public.work_orders
WHERE  job_description IS NULL
   OR  job_description NOT LIKE 'ACCEPTANCE TEST%';

-- If both "left" counts are 0 and the untouched count looks right:
--   COMMIT;
-- Otherwise:
--   ROLLBACK;
ROLLBACK;  -- <= change to COMMIT when the checks above look right
