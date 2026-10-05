-- +===========================================================================+
-- | REPAIR - INV-2026-0015 states a charge that is not inside its total        |
-- | OPTION A SELECTED: correct the invoice up to 150.45                        |
-- +===========================================================================+
--
-- ARMED. This run keeps the repair. The UPDATE is guarded on all four broken
-- values, so it either does exactly the correction below or it does nothing.
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
-- -- WHY OPTION A IS SAFE HERE, CHECKED NOT ASSUMED ---------------------------
--
-- Correcting a bill UPWARDS is only honest if the customer has not been given the
-- lower figure. Verified read-only against the row before arming this:
--
--   sent_to_customer_at   NULL
--   times_sent            0
--   customer_viewed_at    NULL
--   customer_view_count   0
--
-- Nothing was sent and nobody has opened the public link, so no one has seen 149.62.
--
-- NOTE: `sent_at` does NOT exist on public.invoices. An earlier draft of this script
-- selected it and would have failed on that line before reaching the UPDATE. The four
-- columns above are the real ones.
--
-- OPTION B, kept for the record and NOT run: had the invoice been sent, the honest
-- repair would be to keep 149.62 and set shop_supplies_fee to 0 instead, so the row
-- stops claiming a charge it is not billing, with the shop absorbing the 0.83.

BEGIN;

-- -----------------------------------------------------------------------------
-- STEP 1 - the row as it stands. Keep this output.
-- -----------------------------------------------------------------------------
SELECT invoice_number,
       invoice_status,
       sent_to_customer_at,
       times_sent,
       customer_viewed_at,
       subtotal,
       tax_amount,
       total,
       shop_supplies_fee,
       shop_supplies_percent_applied,
       (SELECT sum((l->>'total')::numeric)
          FROM jsonb_array_elements(line_items) l) AS lines_sum
FROM   public.invoices
WHERE  invoice_number = 'INV-2026-0015';

-- -----------------------------------------------------------------------------
-- STEP 2 - OPTION A: correct the invoice to 150.45
--
-- The four guards are the whole safety of this script. If anything about the row
-- has changed since it was read, zero rows update and nothing is lost.
-- -----------------------------------------------------------------------------
UPDATE public.invoices
SET    subtotal      = 139.63,
       tax_amount    = 10.82,
       total         = 150.45,
       tax_rate      = 0.0775,
       -- Rebuilt with the fee inside the parts base, each bucket rounded once:
       -- parts 4.63 at 7.75% = 0.36, labor 135.00 at 7.75% = 10.46, total 10.82.
       tax_breakdown = jsonb_build_object(
         'version', 1,
         'parts', jsonb_build_object('base', 4.63, 'rate', 7.75, 'taxed', true, 'amount', 0.36),
         'labor', jsonb_build_object('base', 135,  'rate', 7.75, 'taxed', true, 'amount', 10.46)
       ),
       updated_at    = now()
WHERE  invoice_number = 'INV-2026-0015'
  AND  subtotal          = 138.86
  AND  tax_amount        = 10.76
  AND  total             = 149.62
  AND  shop_supplies_fee = 0.77;

-- -----------------------------------------------------------------------------
-- STEP 3 - confirm. Both flags must read true.
-- -----------------------------------------------------------------------------
SELECT invoice_number,
       subtotal,
       tax_amount,
       total,
       shop_supplies_fee,
       (SELECT sum((l->>'total')::numeric)
          FROM jsonb_array_elements(line_items) l) AS lines_sum,
       -- The invariant that was broken: the subtotal must contain every charge the
       -- document states.
       (subtotal = (SELECT sum((l->>'total')::numeric)
                      FROM jsonb_array_elements(line_items) l) + shop_supplies_fee)
                                                   AS states_what_it_bills,
       (round(subtotal + tax_amount, 2) = total)   AS adds_up
FROM   public.invoices
WHERE  invoice_number = 'INV-2026-0015';

-- Expect: subtotal 139.63, tax_amount 10.82, total 150.45, lines_sum 138.86,
--         states_what_it_bills TRUE, adds_up TRUE.

COMMIT;   -- ARMED. The guards above mean this commits the correction or nothing.
