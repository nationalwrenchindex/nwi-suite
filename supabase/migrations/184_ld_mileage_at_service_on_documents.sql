-- 184_ld_mileage_at_service_on_documents.sql
--
-- The vehicle's odometer at the time of service, frozen on each LD document - LD's
-- equivalent of HD's 183.
--
-- ONE NAME, NOT TWO. LD invoices have had mileage_at_service INTEGER since 098 ("odometer
-- reading when the work was performed"), set from the send dialog and synced to the NWI
-- Garage service record. This EXTENDS that same column to quotes and work_orders rather
-- than adding a parallel vehicle_odometer beside it, so a reading taken at the quote
-- carries to the work order and the invoice under one name. On Nov 8, 2026 two invoices
-- held a value (277705 and 412); both are inside the check below and are not changed.
--
-- Odometer only. No LD document has ever recorded an hour meter, so no hours column is
-- added (HD's unit_hours stays HD's).
--
-- NULL MEANS NO READING WAS TAKEN, and the document prints nothing - no "0", no
-- placeholder. 0 is a real reading and is not the same as NULL. Nothing is backfilled,
-- and nothing is read live from vehicles.mileage: the reading at THAT service.
--
-- The check is 183's: whole miles, 0 to 9,999,999. invoices gets it too, so all three
-- documents hold the same thing.
--
-- Additive only. No money column is touched; the self-checks compare every total.
-- ASCII only. Ends in ROLLBACK: run it once to see the checks pass, then change the
-- last line to COMMIT and run it again to apply. Any failed check raises.

BEGIN;

CREATE TEMP TABLE _q_before   ON COMMIT DROP AS SELECT id, grand_total, tax_amount FROM public.quotes;
CREATE TEMP TABLE _wo_before  ON COMMIT DROP AS SELECT id, grand_total, tax_amount FROM public.work_orders;
CREATE TEMP TABLE _inv_before ON COMMIT DROP AS SELECT id, total, tax_amount, mileage_at_service FROM public.invoices;

ALTER TABLE public.quotes      ADD COLUMN IF NOT EXISTS mileage_at_service INTEGER;
ALTER TABLE public.work_orders ADD COLUMN IF NOT EXISTS mileage_at_service INTEGER;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'quotes_mileage_at_service_check') THEN
    ALTER TABLE public.quotes ADD CONSTRAINT quotes_mileage_at_service_check CHECK (mileage_at_service IS NULL OR mileage_at_service BETWEEN 0 AND 9999999);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'work_orders_mileage_at_service_check') THEN
    ALTER TABLE public.work_orders ADD CONSTRAINT work_orders_mileage_at_service_check CHECK (mileage_at_service IS NULL OR mileage_at_service BETWEEN 0 AND 9999999);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'invoices_mileage_at_service_check') THEN
    ALTER TABLE public.invoices ADD CONSTRAINT invoices_mileage_at_service_check CHECK (mileage_at_service IS NULL OR mileage_at_service BETWEEN 0 AND 9999999);
  END IF;
END $$;

COMMENT ON COLUMN public.quotes.mileage_at_service IS
  'Vehicle odometer (whole miles) when quoted, entered by the tech. Carries to the work order and invoice. NULL = no reading taken. Never read live from vehicles.';
COMMENT ON COLUMN public.work_orders.mileage_at_service IS
  'Vehicle odometer (whole miles) at the time of service. NULL = no reading taken. Frozen on this document.';
COMMENT ON COLUMN public.invoices.mileage_at_service IS
  'Vehicle odometer (whole miles) at the time of service, carried from the quote or work order or entered here. Frozen: never re-read. NULL = none recorded.';

DO $$
DECLARE n bigint;
BEGIN
  SELECT (SELECT count(*) FROM public.quotes WHERE mileage_at_service IS NOT NULL)
       + (SELECT count(*) FROM public.work_orders WHERE mileage_at_service IS NOT NULL) INTO n;
  IF n <> 0 THEN RAISE EXCEPTION '184: % quote/work order(s) gained a reading - nothing applied', n; END IF;

  SELECT count(*) INTO n FROM _q_before b LEFT JOIN public.quotes q ON q.id = b.id
   WHERE q.id IS NULL OR q.grand_total IS DISTINCT FROM b.grand_total OR q.tax_amount IS DISTINCT FROM b.tax_amount;
  IF n <> 0 OR (SELECT count(*) FROM public.quotes) <> (SELECT count(*) FROM _q_before) THEN
    RAISE EXCEPTION '184: % quote(s) changed - nothing applied', n; END IF;

  SELECT count(*) INTO n FROM _wo_before b LEFT JOIN public.work_orders w ON w.id = b.id
   WHERE w.id IS NULL OR w.grand_total IS DISTINCT FROM b.grand_total OR w.tax_amount IS DISTINCT FROM b.tax_amount;
  IF n <> 0 OR (SELECT count(*) FROM public.work_orders) <> (SELECT count(*) FROM _wo_before) THEN
    RAISE EXCEPTION '184: % work order(s) changed - nothing applied', n; END IF;

  SELECT count(*) INTO n FROM _inv_before b LEFT JOIN public.invoices i ON i.id = b.id
   WHERE i.id IS NULL OR i.total IS DISTINCT FROM b.total OR i.tax_amount IS DISTINCT FROM b.tax_amount
      OR i.mileage_at_service IS DISTINCT FROM b.mileage_at_service;
  IF n <> 0 OR (SELECT count(*) FROM public.invoices) <> (SELECT count(*) FROM _inv_before) THEN
    RAISE EXCEPTION '184: % invoice(s) changed - nothing applied', n; END IF;
END $$;

-- What the editor shows last. Expect: columns_present = 3, quote_wo_readings = 0,
-- invoice_readings = 2 (unchanged), changed_* = 0.
SELECT (SELECT count(*) FROM information_schema.columns WHERE table_schema = 'public'
          AND table_name IN ('quotes', 'work_orders', 'invoices') AND column_name = 'mileage_at_service') AS columns_present,
       (SELECT count(*) FROM public.quotes WHERE mileage_at_service IS NOT NULL)
     + (SELECT count(*) FROM public.work_orders WHERE mileage_at_service IS NOT NULL) AS quote_wo_readings,
       (SELECT count(*) FROM public.invoices WHERE mileage_at_service IS NOT NULL) AS invoice_readings,
       (SELECT count(*) FROM _q_before b JOIN public.quotes q ON q.id = b.id WHERE q.grand_total IS DISTINCT FROM b.grand_total) AS changed_quote_totals,
       (SELECT count(*) FROM _wo_before b JOIN public.work_orders w ON w.id = b.id WHERE w.grand_total IS DISTINCT FROM b.grand_total) AS changed_work_order_totals,
       (SELECT count(*) FROM _inv_before b JOIN public.invoices i ON i.id = b.id WHERE i.total IS DISTINCT FROM b.total) AS changed_invoice_totals;

ROLLBACK;
