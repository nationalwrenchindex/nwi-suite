-- Put the dropped $35.00 road call fee back on INV-2026-0020.
--
-- Q-2026-0010 totals 260.11 with a 35.00 road call fee. Its invoice, via WO-2026-1563,
-- came out 225.11 with road_call_fee 0 - but kept the quote's tax_breakdown, whose labor
-- bucket (base 237.50, tax 18.41) already includes the fee. So the stored tax is right
-- and only the fee and the total are wrong. Nothing is recomputed here: the fee and the
-- total are set to the quote's own figures.
--
-- Checked read-only on 2026-10-17: of every HD invoice converted from a quote-sourced
-- work order, this is the only one whose fees differ from its quote. It is unpaid.
--
-- Fixing this also clears the one red smoke step ("HD / invoice edit shows the stored
-- total"), which opens the newest HD invoice and found this one's figures inconsistent.
--
-- Ends in ROLLBACK. Read the checks, then change ROLLBACK to COMMIT to keep it.

BEGIN;

-- Before: expect total 225.11, road_call_fee 0, status unpaid.
SELECT invoice_number, status, total, road_call_fee, diagnostic_fee, tax_amount
  FROM hd_invoices WHERE invoice_number = 'INV-2026-0020';

UPDATE hd_invoices
   SET road_call_fee = 35.00, total = 260.11, updated_at = NOW()
 WHERE id = '4fcaf7d7-ffdd-4cfd-af39-ee137f5cef67'
   AND invoice_number = 'INV-2026-0020'
   AND total = 225.11
   AND status = 'unpaid';

-- After: expect total 260.11, road_call_fee 35.00.
SELECT invoice_number, status, total, road_call_fee, diagnostic_fee, tax_amount
  FROM hd_invoices WHERE invoice_number = 'INV-2026-0020';

-- Expect the two totals to match.
SELECT q.quote_number, q.total AS quote_total, i.total AS invoice_total
  FROM hd_invoices i
  JOIN hd_work_orders w ON w.id = i.work_order_id
  JOIN hd_quotes q ON q.id = w.quote_id
 WHERE i.invoice_number = 'INV-2026-0020';

ROLLBACK;
