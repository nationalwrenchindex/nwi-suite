-- =============================================================================
-- Delete test data: INV-2026-0030, WO-2026-1573 and Q-2026-0015 (Brock's account). ONE file.
-- =============================================================================
--
-- All three are "brock fleeman test" rows made the night of Nov 6, 2026. Q-2026-0015 is a
-- $145 diagnostic fee with no lines; WO-2026-1573 and INV-2026-0030 carry one $0 labor line. Because
-- they are the newest real quote and invoice on the account, the smoke suite's Pe flow
-- copies them, finds nothing to discount, and stops - about 25 print-surface checks do
-- not run while they exist.
--
-- The chain is quote -> work order -> invoice:
--   Q-2026-0015    0521f8b5-f729-427a-8066-686cd3174af3  approved, never sent, $201.24
--   WO-2026-1573   aa46a8d4-c1aa-42cf-81b0-a728586d4889  invoiced, quote_id = the quote
--   INV-2026-0030  42a7da16-262d-4130-aee0-effc79477c9d  unpaid, never sent, $201.24,
--                                                        quote_id = the quote, work_order_id = the WO
--
-- RUN ORDER, inside this one transaction: the INVOICE, then the WORK ORDER, then the QUOTE.
--   hd_invoices.quote_id references hd_quotes with NO ACTION (migration 057), so the
--   quote cannot be deleted while the invoice still points at it.
--   hd_invoices.work_order_id is ON DELETE SET NULL, so deleting the work order before
--   the invoice would leave the invoice behind with its link silently blanked.
--   The work order goes before the quote so its quote_id is never blanked either.
--   WO-2026-1573's 1 line item ("rtberberg") and 1 job cascade with it. A read on Nov 7 found no stock
-- movements or allocations and no DOT / aerial / equipment inspections or PM checklists
-- on any of the three.
--
-- The checks refuse the whole file if any row is not exactly what was read.
--
-- ENDS IN ROLLBACK. Read what it prints, then change the last line to COMMIT.

BEGIN;

DO $$
DECLARE n BIGINT;
BEGIN
  IF (SELECT count(*) FROM public.hd_invoices
       WHERE id = '42a7da16-262d-4130-aee0-effc79477c9d'
         AND invoice_number = 'INV-2026-0030'
         AND user_id = '4a8c046f-7db3-42bb-8422-fd47efb7678c'
         AND quote_id = '0521f8b5-f729-427a-8066-686cd3174af3'
         AND work_order_id = 'aa46a8d4-c1aa-42cf-81b0-a728586d4889'
         AND total = 201.24
         AND paid_at IS NULL AND sent_at IS NULL) <> 1 THEN
    RAISE EXCEPTION 'INV-2026-0030 is not the unpaid, unsent $201.24 test invoice read on Nov 7 - nothing deleted';
  END IF;
  IF (SELECT count(*) FROM public.hd_quotes
       WHERE id = '0521f8b5-f729-427a-8066-686cd3174af3'
         AND quote_number = 'Q-2026-0015'
         AND user_id = '4a8c046f-7db3-42bb-8422-fd47efb7678c'
         AND total = 201.24
         AND sent_at IS NULL) <> 1 THEN
    RAISE EXCEPTION 'Q-2026-0015 is not the unsent $201.24 test quote read on Nov 7 - nothing deleted';
  END IF;
  IF (SELECT count(*) FROM public.hd_invoices WHERE quote_id = '0521f8b5-f729-427a-8066-686cd3174af3') <> 1 THEN
    RAISE EXCEPTION 'Q-2026-0015 has another invoice now - nothing deleted';
  END IF;
  IF (SELECT count(*) FROM public.hd_work_orders WHERE quote_id = '0521f8b5-f729-427a-8066-686cd3174af3') <> 1 THEN
    RAISE EXCEPTION 'Q-2026-0015 has another work order now - nothing deleted';
  END IF;
  IF (SELECT count(*) FROM public.hd_work_orders
       WHERE id = 'aa46a8d4-c1aa-42cf-81b0-a728586d4889'
         AND work_order_number = 'WO-2026-1573'
         AND user_id = '4a8c046f-7db3-42bb-8422-fd47efb7678c'
         AND quote_id = '0521f8b5-f729-427a-8066-686cd3174af3') <> 1 THEN
    RAISE EXCEPTION 'WO-2026-1573 is not the test work order read on Nov 7 - nothing deleted';
  END IF;
  IF (SELECT count(*) FROM public.hd_invoices WHERE work_order_id = 'aa46a8d4-c1aa-42cf-81b0-a728586d4889') <> 1 THEN
    RAISE EXCEPTION 'WO-2026-1573 has another invoice now - nothing deleted';
  END IF;
  IF EXISTS (SELECT 1 FROM public.stock_allocation WHERE work_order_id = 'aa46a8d4-c1aa-42cf-81b0-a728586d4889') THEN
    RAISE EXCEPTION 'stock is allocated to WO-2026-1573 now - release it first; nothing deleted';
  END IF;
  IF EXISTS (SELECT 1 FROM public.stock_movement
              WHERE source_id IN ('42a7da16-262d-4130-aee0-effc79477c9d', '0521f8b5-f729-427a-8066-686cd3174af3', 'aa46a8d4-c1aa-42cf-81b0-a728586d4889')) THEN
    RAISE EXCEPTION 'a stock movement now points at these rows - put the stock back first; nothing deleted';
  END IF;

  -- 1. The invoice.
  DELETE FROM public.hd_invoices WHERE id = '42a7da16-262d-4130-aee0-effc79477c9d';
  GET DIAGNOSTICS n = ROW_COUNT;
  IF n <> 1 THEN RAISE EXCEPTION 'deleted % invoices, not 1 - nothing deleted', n; END IF;

  -- 2. The work order (its 1 line item and 1 job cascade).
  DELETE FROM public.hd_work_orders WHERE id = 'aa46a8d4-c1aa-42cf-81b0-a728586d4889';
  GET DIAGNOSTICS n = ROW_COUNT;
  IF n <> 1 THEN RAISE EXCEPTION 'deleted % work orders, not 1 - nothing deleted', n; END IF;

  -- 3. The quote.
  DELETE FROM public.hd_quotes WHERE id = '0521f8b5-f729-427a-8066-686cd3174af3';
  GET DIAGNOSTICS n = ROW_COUNT;
  IF n <> 1 THEN RAISE EXCEPTION 'deleted % quotes, not 1 - nothing deleted', n; END IF;
END $$;

-- After: every count must be 0.
SELECT 'hd_invoices' AS tbl, count(*) AS left_behind FROM public.hd_invoices WHERE id = '42a7da16-262d-4130-aee0-effc79477c9d'
UNION ALL SELECT 'hd_quotes', count(*) FROM public.hd_quotes WHERE id = '0521f8b5-f729-427a-8066-686cd3174af3'
UNION ALL SELECT 'hd_work_orders', count(*) FROM public.hd_work_orders WHERE id = 'aa46a8d4-c1aa-42cf-81b0-a728586d4889'
UNION ALL SELECT 'hd_work_order_line_items', count(*) FROM public.hd_work_order_line_items WHERE work_order_id = 'aa46a8d4-c1aa-42cf-81b0-a728586d4889'
UNION ALL SELECT 'hd_work_order_jobs', count(*) FROM public.hd_work_order_jobs WHERE work_order_id = 'aa46a8d4-c1aa-42cf-81b0-a728586d4889';

ROLLBACK;
