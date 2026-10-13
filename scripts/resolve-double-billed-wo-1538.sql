-- =============================================================================
-- WO-2026-1538 was billed twice. You choose which invoice stands.
-- =============================================================================
--
-- FOR EDWARD. I am not running this and I am not choosing for you. These are billing
-- records for a real customer and the decision is a business one.
--
-- -- WHAT HAPPENED -----------------------------------------------------------
--
-- Found while building the HD work-order-to-invoice converter, by checking for
-- duplicate work_order_id before writing a unique index that assumes there are none:
--
--   work order  WO-2026-1538   customer: Trailer Source   status: invoiced
--
--     INV-2026-0003    total 183.18     1 line    created 2026-09-11 13:43
--                                                 sent    2026-09-11 13:43   UNPAID
--     INV-2026-0005    total 1286.60    9 lines   created 2026-09-14 03:03
--                                                 sent    2026-09-14 15:39   UNPAID
--
-- Both were SENT. Neither is paid. Trailer Source may be holding both of them.
--
-- This is what an application-level double-convert guard looks like when it loses:
-- there was no database constraint, the "Create Invoice" path was a client-side query
-- string, and nothing stopped a second bill three days later.
--
-- -- WHICH ONE IS PROBABLY RIGHT, AND WHY I AM NOT DECIDING ----------------
--
-- INV-2026-0005 has 9 lines and 1286.60; INV-2026-0003 has 1 line and 183.18. The
-- shape suggests 0003 was a partial or abandoned first attempt and 0005 is the real
-- job - but "suggests" is not good enough to void a customer's invoice on. Only you
-- know whether Trailer Source was invoiced 183.18 for something separate, whether they
-- have already been told to pay one of them, and whether 0003 was sent in error.
--
-- Open both, read the lines, then pick a block below.
--
-- -- WHY VOID AND NOT DELETE -------------------------------------------------
--
-- 'void' is already an allowed hd_invoices.status (migration 077). Deleting a sent
-- invoice destroys the record that it was ever sent, which is the thing you would need
-- if the customer says "you billed me twice". Voiding leaves the history and takes the
-- invoice out of the books.
--
-- Voiding also frees the work_order_id, because a voided invoice should not hold the
-- one-invoice-per-work-order slot. The UPDATE blocks below do both.
--
-- ENDS IN ROLLBACK. Read STEP 1, uncomment ONE block, then change the last line to
-- COMMIT.

-- -----------------------------------------------------------------------------
-- STEP 1. Read both invoices in full, including every line.
-- -----------------------------------------------------------------------------
SELECT invoice_number, status, total, subtotal_labor, subtotal_parts,
       tax_amount, created_at, sent_at, paid_at, sent_count,
       customer_name, unit_manufacturer, unit_model, complaint
FROM   public.hd_invoices
WHERE  work_order_id = '713eaa47-9cb9-4a4a-8040-377f130b1838'
ORDER  BY created_at;

-- Every line on both, so you can see what each one actually bills for.
SELECT i.invoice_number,
       li ->> 'type'        AS line_type,
       li ->> 'description' AS description,
       li ->> 'part_number' AS part_number,
       li ->> 'quantity'    AS quantity,
       li ->> 'unit_cost'   AS unit_cost,
       li ->> 'amount'      AS amount
FROM   public.hd_invoices i
CROSS  JOIN LATERAL jsonb_array_elements(i.line_items) AS li
WHERE  i.work_order_id = '713eaa47-9cb9-4a4a-8040-377f130b1838'
ORDER  BY i.created_at, (li ->> 'amount')::numeric DESC;

-- And the work order itself, for comparison.
SELECT work_order_number, status, service_requests, comments,
       labor_hours, labor_rate, total_amount, created_at, completed_at
FROM   public.hd_work_orders
WHERE  id = '713eaa47-9cb9-4a4a-8040-377f130b1838';

BEGIN;

-- -----------------------------------------------------------------------------
-- STEP 2. Uncomment EXACTLY ONE block.
-- -----------------------------------------------------------------------------

-- OPTION A - keep INV-2026-0005 (9 lines, 1286.60), void INV-2026-0003.
-- This is the one I would expect to be right, but it is your call.
--
-- UPDATE public.hd_invoices
-- SET    status = 'void',
--        work_order_id = NULL,
--        notes = concat_ws(' ', notes,
--                  'VOIDED 2026-10-13: duplicate bill for WO-2026-1538. INV-2026-0005 is the invoice of record.')
-- WHERE  invoice_number = 'INV-2026-0003';

-- OPTION B - keep INV-2026-0003 (1 line, 183.18), void INV-2026-0005.
--
-- UPDATE public.hd_invoices
-- SET    status = 'void',
--        work_order_id = NULL,
--        notes = concat_ws(' ', notes,
--                  'VOIDED 2026-10-13: duplicate bill for WO-2026-1538. INV-2026-0003 is the invoice of record.')
-- WHERE  invoice_number = 'INV-2026-0005';

-- OPTION C - both are legitimate and bill separate work. Then the work order link on
-- one of them is simply wrong, and clearing it keeps both invoices intact and payable:
--
-- UPDATE public.hd_invoices
-- SET    work_order_id = NULL,
--        notes = concat_ws(' ', notes,
--                  '2026-10-13: work order link cleared - this invoice bills work separate from WO-2026-1538.')
-- WHERE  invoice_number = 'INV-2026-0003';

-- -----------------------------------------------------------------------------
-- STEP 3. Check it. Expect exactly ONE row, and no duplicates anywhere.
-- -----------------------------------------------------------------------------
SELECT invoice_number, status, total, work_order_id
FROM   public.hd_invoices
WHERE  work_order_id = '713eaa47-9cb9-4a4a-8040-377f130b1838';

-- Expect zero rows. Once this is empty, migration 154 will apply.
SELECT work_order_id, count(*) AS invoice_count,
       string_agg(invoice_number, ', ') AS invoices
FROM   public.hd_invoices
WHERE  work_order_id IS NOT NULL
GROUP  BY work_order_id
HAVING count(*) > 1;

-- Expect 19. Nothing is deleted by any option above.
SELECT count(*) AS total_invoices FROM public.hd_invoices;

-- -----------------------------------------------------------------------------
-- Read STEP 1, uncomment ONE block in STEP 2, then change this to COMMIT.
-- -----------------------------------------------------------------------------
ROLLBACK;
