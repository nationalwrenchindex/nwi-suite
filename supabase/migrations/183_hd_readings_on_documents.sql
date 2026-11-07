-- 183_hd_readings_on_documents.sql
--
-- Two readings at the time of service, frozen on each HD document:
--
--   unit_hours        the reefer unit's hour meter. On hd_work_orders and hd_invoices
--                     since 179; this adds it to hd_quotes, SAME type and check, so a
--                     reading taken at the quote carries to the work order and the
--                     invoice. INV-2026-0027 (from a work order) printed "Hours: 20,351";
--                     INV-2026-0028 (from a quote) could not print any.
--   vehicle_odometer  the truck or trailer's odometer, whole miles. New on all three.
--                     For warranty: a receipt at 123,000 miles is the proof of what was
--                     done and when, if the repair fails at 153,000.
--
-- NULL MEANS NO READING WAS TAKEN, and the document prints nothing - no "0", no
-- placeholder. Nothing is backfilled. 0 is a real reading and is not the same as NULL.
-- Never read live from hd_units or anywhere else: the reading at THAT service.
--
-- Additive only. No money column is touched; the self-checks compare every total.
-- ASCII only. Ends in ROLLBACK: run it once to see the checks pass, then change the
-- last line to COMMIT and run it again to apply. Any failed check raises.

BEGIN;

CREATE TEMP TABLE _q_before   ON COMMIT DROP AS SELECT id, total, tax_amount FROM public.hd_quotes;
CREATE TEMP TABLE _wo_before  ON COMMIT DROP AS SELECT id, total_amount, tax_amount FROM public.hd_work_orders;
CREATE TEMP TABLE _inv_before ON COMMIT DROP AS SELECT id, total, tax_amount, subtotal_labor, subtotal_parts FROM public.hd_invoices;

ALTER TABLE public.hd_quotes      ADD COLUMN IF NOT EXISTS unit_hours NUMERIC(10,1);
ALTER TABLE public.hd_quotes      ADD COLUMN IF NOT EXISTS vehicle_odometer INTEGER;
ALTER TABLE public.hd_work_orders ADD COLUMN IF NOT EXISTS vehicle_odometer INTEGER;
ALTER TABLE public.hd_invoices    ADD COLUMN IF NOT EXISTS vehicle_odometer INTEGER;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'hd_quotes_unit_hours_check') THEN
    ALTER TABLE public.hd_quotes ADD CONSTRAINT hd_quotes_unit_hours_check CHECK (unit_hours IS NULL OR unit_hours >= 0);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'hd_quotes_vehicle_odometer_check') THEN
    ALTER TABLE public.hd_quotes ADD CONSTRAINT hd_quotes_vehicle_odometer_check CHECK (vehicle_odometer IS NULL OR vehicle_odometer BETWEEN 0 AND 9999999);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'hd_work_orders_vehicle_odometer_check') THEN
    ALTER TABLE public.hd_work_orders ADD CONSTRAINT hd_work_orders_vehicle_odometer_check CHECK (vehicle_odometer IS NULL OR vehicle_odometer BETWEEN 0 AND 9999999);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'hd_invoices_vehicle_odometer_check') THEN
    ALTER TABLE public.hd_invoices ADD CONSTRAINT hd_invoices_vehicle_odometer_check CHECK (vehicle_odometer IS NULL OR vehicle_odometer BETWEEN 0 AND 9999999);
  END IF;
END $$;

COMMENT ON COLUMN public.hd_quotes.unit_hours IS
  'Unit hour reading when quoted, entered by the tech. Carries to the work order and invoice. NULL = no reading taken. Never read live from hd_units.';
COMMENT ON COLUMN public.hd_quotes.vehicle_odometer IS
  'Truck or trailer odometer (whole miles) when quoted. Carries to the work order and invoice. NULL = no reading taken.';
COMMENT ON COLUMN public.hd_work_orders.vehicle_odometer IS
  'Truck or trailer odometer (whole miles) at the time of service. NULL = no reading taken. Frozen on this document.';
COMMENT ON COLUMN public.hd_invoices.vehicle_odometer IS
  'Truck or trailer odometer carried from the quote or work order. Frozen: never re-read. NULL = none recorded.';

DO $$
DECLARE n bigint;
BEGIN
  SELECT (SELECT count(*) FROM public.hd_quotes WHERE unit_hours IS NOT NULL OR vehicle_odometer IS NOT NULL)
       + (SELECT count(*) FROM public.hd_work_orders WHERE vehicle_odometer IS NOT NULL)
       + (SELECT count(*) FROM public.hd_invoices WHERE vehicle_odometer IS NOT NULL) INTO n;
  IF n <> 0 THEN RAISE EXCEPTION '183: % document(s) gained a reading - nothing applied', n; END IF;

  SELECT count(*) INTO n FROM _q_before b LEFT JOIN public.hd_quotes q ON q.id = b.id
   WHERE q.id IS NULL OR q.total IS DISTINCT FROM b.total OR q.tax_amount IS DISTINCT FROM b.tax_amount;
  IF n <> 0 OR (SELECT count(*) FROM public.hd_quotes) <> (SELECT count(*) FROM _q_before) THEN
    RAISE EXCEPTION '183: % quote(s) changed - nothing applied', n; END IF;

  SELECT count(*) INTO n FROM _wo_before b LEFT JOIN public.hd_work_orders w ON w.id = b.id
   WHERE w.id IS NULL OR w.total_amount IS DISTINCT FROM b.total_amount OR w.tax_amount IS DISTINCT FROM b.tax_amount;
  IF n <> 0 OR (SELECT count(*) FROM public.hd_work_orders) <> (SELECT count(*) FROM _wo_before) THEN
    RAISE EXCEPTION '183: % work order(s) changed - nothing applied', n; END IF;

  SELECT count(*) INTO n FROM _inv_before b LEFT JOIN public.hd_invoices i ON i.id = b.id
   WHERE i.id IS NULL OR i.total IS DISTINCT FROM b.total OR i.tax_amount IS DISTINCT FROM b.tax_amount
      OR i.subtotal_labor IS DISTINCT FROM b.subtotal_labor OR i.subtotal_parts IS DISTINCT FROM b.subtotal_parts;
  IF n <> 0 OR (SELECT count(*) FROM public.hd_invoices) <> (SELECT count(*) FROM _inv_before) THEN
    RAISE EXCEPTION '183: % invoice(s) changed - nothing applied', n; END IF;
END $$;

-- What the editor shows last. Expect: four columns_present = 4, documents_with_readings = 0, changed_* = 0.
SELECT (SELECT count(*) FROM information_schema.columns WHERE table_schema = 'public'
          AND ((table_name = 'hd_quotes' AND column_name IN ('unit_hours', 'vehicle_odometer'))
            OR (table_name IN ('hd_work_orders', 'hd_invoices') AND column_name = 'vehicle_odometer'))) AS columns_present,
       (SELECT count(*) FROM public.hd_quotes WHERE unit_hours IS NOT NULL OR vehicle_odometer IS NOT NULL)
     + (SELECT count(*) FROM public.hd_work_orders WHERE vehicle_odometer IS NOT NULL)
     + (SELECT count(*) FROM public.hd_invoices WHERE vehicle_odometer IS NOT NULL) AS documents_with_readings,
       (SELECT count(*) FROM _q_before b JOIN public.hd_quotes q ON q.id = b.id WHERE q.total IS DISTINCT FROM b.total) AS changed_quote_totals,
       (SELECT count(*) FROM _wo_before b JOIN public.hd_work_orders w ON w.id = b.id WHERE w.total_amount IS DISTINCT FROM b.total_amount) AS changed_work_order_totals,
       (SELECT count(*) FROM _inv_before b JOIN public.hd_invoices i ON i.id = b.id WHERE i.total IS DISTINCT FROM b.total) AS changed_invoice_totals;

ROLLBACK;
