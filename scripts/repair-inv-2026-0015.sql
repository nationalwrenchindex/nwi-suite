-- +===========================================================================+
-- | REPAIR - INV-2026-0015 states a charge that is not inside its total        |
-- +===========================================================================+
--
-- NOT RUN BY ME. This UPDATES a finalized invoice that is awaiting payment.
--
-- -- WHAT IS WRONG -----------------------------------------------------------
--
-- The row currently holds:
--
--   line_items          labor 135.00 + parts 3.86   = 138.86
--   shop_supplies_fee   0.77                        <- STATED
--   subtotal            138.86                      <- does NOT include the fee
--   tax_amount          10.76                       on a parts base of 3.86
--   total               149.62
--
-- It prints a 0.77 shop supplies line that is not in its subtotal, its tax, or its
-- total. The customer is under-billed by 0.83.
--
-- The correct figures, which the converter originally wrote:
--
--   subtotal            139.63   = 138.86 + 0.77
--   tax parts base      4.63     = 3.86 + 0.77, taxed at 7.75% = 0.36
--   tax labor base      135.00   taxed at 7.75% = 10.46
--   tax_amount          10.82    = 0.36 + 10.46
--   total               150.45
--
-- -- HOW IT GOT LIKE THIS -----------------------------------------------------
--
-- The in-progress editor recomputed the money on every render. useExtrasSettings
-- reports "bills nothing" until the profile fetch resolves, so on first render the
-- recomputed supplies fee was 0.00 and the screen subtracted a charge the invoice
-- already carried. Finalize then wrote those recomputed figures over the correct
-- ones. The code fix makes a recorded percentage win over the live setting, so this
-- cannot recur - but it does not repair a row already written.
--
-- -- WHY THIS IS A JUDGEMENT CALL, NOT AN OBVIOUS FIX -------------------------
--
-- This invoice is in awaiting_payment. If the customer has ALREADY BEEN SENT the
-- 149.62 figure, raising it to 150.45 means billing more than they were told. The
-- standing rule here is that anything already sent keeps what it was sent with.
--
-- So decide which you want BEFORE running step 2:
--
--   OPTION A - correct the invoice to 150.45. Right when nothing has been sent yet,
--              or the customer has not paid and will accept a corrected bill.
--
--   OPTION B - keep 149.62 and drop the stated fee to 0.00 instead, so the row stops
--              claiming a charge it is not billing. Right when the customer already
--              has the 149.62 figure. The shop absorbs 0.83.
--
-- Both leave a self-consistent row. Doing NEITHER leaves an invoice that contradicts
-- itself on paper, which is the one outcome to avoid.

BEGIN;

-- -----------------------------------------------------------------------------
-- STEP 1 - look at it first. Keep this output.
-- -----------------------------------------------------------------------------
SELECT invoice_number,
       invoice_status,
       sent_at,
       subtotal,
       tax_amount,
       total,
       shop_supplies_fee,
       shop_supplies_percent_applied,
       jsonb_pretty(tax_breakdown) AS tax_breakdown,
       (SELECT sum((l->>'total')::numeric)
          FROM jsonb_array_elements(line_items) l) AS lines_sum
FROM   public.invoices
WHERE  invoice_number = 'INV-2026-0015';

-- SENT_AT IS THE DECIDING FIELD. If it is not null, the customer has the old figure
-- and OPTION B is the honest choice.

-- -----------------------------------------------------------------------------
-- STEP 2 - OPTION A: correct the invoice up to 150.45
-- Uncomment this block only if you want the customer billed the full amount.
-- -----------------------------------------------------------------------------
-- UPDATE public.invoices
-- SET    subtotal      = 139.63,
--        tax_amount    = 10.82,
--        total         = 150.45,
--        tax_rate      = 0.0775,
--        tax_breakdown = jsonb_build_object(
--          'version', 1,
--          'parts', jsonb_build_object('base', 4.63, 'rate', 7.75, 'taxed', true, 'amount', 0.36),
--          'labor', jsonb_build_object('base', 135,  'rate', 7.75, 'taxed', true, 'amount', 10.46)
--        ),
--        updated_at    = now()
-- WHERE  invoice_number = 'INV-2026-0015'
--   -- Guards: only touch the row if it is still in the exact broken state described
--   -- above. If anything has changed since, this does nothing and you re-read it.
--   AND  subtotal          = 138.86
--   AND  tax_amount        = 10.76
--   AND  total             = 149.62
--   AND  shop_supplies_fee = 0.77;

-- -----------------------------------------------------------------------------
-- STEP 2 - OPTION B: keep 149.62 and stop claiming the fee
-- Uncomment this block only if the customer already has the 149.62 figure.
-- -----------------------------------------------------------------------------
-- UPDATE public.invoices
-- SET    shop_supplies_fee             = 0,
--        shop_supplies_percent_applied = NULL,
--        shop_supplies_cap_applied     = NULL,
--        updated_at                    = now()
-- WHERE  invoice_number = 'INV-2026-0015'
--   AND  subtotal          = 138.86
--   AND  total             = 149.62
--   AND  shop_supplies_fee = 0.77;

-- -----------------------------------------------------------------------------
-- STEP 3 - confirm whichever option you ran leaves a consistent row
-- -----------------------------------------------------------------------------
-- states_what_it_bills must be true. That is the whole point of the repair.
SELECT invoice_number,
       subtotal,
       tax_amount,
       total,
       shop_supplies_fee,
       (SELECT sum((l->>'total')::numeric)
          FROM jsonb_array_elements(line_items) l) AS lines_sum,
       (subtotal = (SELECT sum((l->>'total')::numeric)
                      FROM jsonb_array_elements(line_items) l) + shop_supplies_fee)
                                                   AS states_what_it_bills,
       (round(subtotal + tax_amount, 2) = total)   AS adds_up
FROM   public.invoices
WHERE  invoice_number = 'INV-2026-0015';

-- If states_what_it_bills and adds_up are both true:
--   COMMIT;
-- Otherwise:
--   ROLLBACK;
ROLLBACK;  -- <= change to COMMIT when the checks above look right
