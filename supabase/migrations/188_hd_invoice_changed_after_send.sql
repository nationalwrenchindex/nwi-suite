-- 188_hd_invoice_changed_after_send.sql
--
-- WHAT IS WRONG. An unpaid HD invoice may be corrected after it has been sent - by the
-- editor, or by the new refresh-from-work-order path - and nothing on the row said
-- so. The customer is then holding a copy, and maybe paying from a figure, that no
-- longer matches the invoice, and the shop cannot see it.
--
-- WHAT THIS DOES. Adds hd_invoices.changed_after_send_at: when the invoice last changed
-- in a way the customer reads (lines, money, customer, unit) after it had been sent.
--   - Set by the app only: the invoice PUT and POST /api/hd/invoices/[id]/refresh.
--   - The invoice screen shows "Changed after it was sent" while it is later than
--     last_sent_at (else sent_at). Sending again clears that by moving last_sent_at.
--   - Nothing is backfilled. Existing invoices stay NULL; the app also appends a dated
--     line to internal_notes on every such change, with or without this column.
--
-- No money column is touched; the self-check compares every invoice total.
--
-- Until this is applied the code writes the internal note only, and the banner does
-- not show.
--
-- Plain ASCII. Ends in ROLLBACK: run it once to see the checks pass, then change the
-- last line to COMMIT and run it again to apply. Any failed check raises.

BEGIN;

CREATE TEMP TABLE _inv_before ON COMMIT DROP AS
  SELECT id, total, tax_amount, status FROM public.hd_invoices;

ALTER TABLE public.hd_invoices
  ADD COLUMN IF NOT EXISTS changed_after_send_at TIMESTAMPTZ;

COMMENT ON COLUMN public.hd_invoices.changed_after_send_at IS
  'When the invoice last changed in a way the customer reads, after it had been sent. Later than last_sent_at (else sent_at) means the customer holds an older copy. Set by the app only.';

-- Self-check.
DO $$
DECLARE
  changed integer;
  filled  integer;
  lost    integer;
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'hd_invoices' AND column_name = 'changed_after_send_at'
  ) THEN
    RAISE EXCEPTION '188: hd_invoices.changed_after_send_at was not created';
  END IF;

  SELECT count(*) INTO filled FROM public.hd_invoices WHERE changed_after_send_at IS NOT NULL;
  IF filled <> 0 THEN
    RAISE EXCEPTION '188: expected no invoice stamped yet, found %', filled;
  END IF;

  SELECT count(*) INTO lost FROM _inv_before b
  WHERE NOT EXISTS (SELECT 1 FROM public.hd_invoices i WHERE i.id = b.id);
  SELECT count(*) INTO changed FROM _inv_before b
  JOIN public.hd_invoices i ON i.id = b.id
  WHERE i.total IS DISTINCT FROM b.total
     OR i.tax_amount IS DISTINCT FROM b.tax_amount
     OR i.status IS DISTINCT FROM b.status;
  IF lost <> 0 OR changed <> 0 THEN
    RAISE EXCEPTION '188: % invoice(s) lost and % changed - nothing should move', lost, changed;
  END IF;

  RAISE NOTICE '188 ok: changed_after_send_at added, 0 stamped, % invoice(s) unchanged',
    (SELECT count(*) FROM _inv_before);
END $$;

-- Ends in ROLLBACK so a dry run changes nothing. Change to COMMIT to apply.
ROLLBACK;
