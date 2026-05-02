-- Cleanup: delete phantom $0 invoices that were auto-created on job completion
-- (legacy behavior removed in Phase 4.6 Sub-3).
-- These are invoices with a $0 total that have no source_quote_id and were not
-- manually created by a user.
--
-- REVIEW before running: confirm the invoice IDs in the SELECT match what you expect.

-- Step 1: preview what would be deleted
SELECT id, invoice_number, invoice_status, total, source, created_at
FROM invoices
WHERE total = 0
  AND source_quote_id IS NULL
  AND source IS DISTINCT FROM 'quickwrench'
  AND invoice_status IN ('in_progress', 'paid', 'awaiting_payment')
ORDER BY created_at DESC;

-- Step 2: unlink expenses first (so they are NOT deleted with the invoice)
UPDATE expenses
SET linked_invoice_id = NULL
WHERE linked_invoice_id IN (
  SELECT id FROM invoices
  WHERE total = 0
    AND source_quote_id IS NULL
    AND source IS DISTINCT FROM 'quickwrench'
    AND invoice_status IN ('in_progress', 'paid', 'awaiting_payment')
);

-- Step 3: delete the phantom invoices
DELETE FROM invoices
WHERE total = 0
  AND source_quote_id IS NULL
  AND source IS DISTINCT FROM 'quickwrench'
  AND invoice_status IN ('in_progress', 'paid', 'awaiting_payment');
