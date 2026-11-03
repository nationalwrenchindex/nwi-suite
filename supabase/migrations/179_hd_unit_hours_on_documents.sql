-- 179_hd_unit_hours_on_documents.sql
--
-- The unit's hour reading AT THE TIME OF SERVICE, recorded on the HD work order and
-- carried to its invoice.
--
-- WHY: a fleet files invoices by unit and tracks its own PM intervals off the hour
-- reading. The reading must be the one taken when the work was done, frozen on that
-- document - never the unit's current hours read live off hd_units. A year from now
-- an invoice has to show the hours it had the day it was billed, or the PM record is
-- worthless. Same rule as money: a document keeps what it was recorded with.
--
-- NULL MEANS NO READING WAS TAKEN, and the document prints no hours. Nothing is
-- backfilled: every existing work order and invoice keeps NULL and prints exactly as
-- it does today. 0 is a real reading and is not the same as NULL.
--
-- Additive only. No money column is touched; the self-checks compare every total.
-- ASCII only. Ends in COMMIT; any failed check raises and nothing is applied.

BEGIN;

CREATE TEMP TABLE _wo_before  ON COMMIT DROP AS SELECT id, total_amount, tax_amount FROM public.hd_work_orders;
CREATE TEMP TABLE _inv_before ON COMMIT DROP AS SELECT id, total, tax_amount, subtotal_labor, subtotal_parts FROM public.hd_invoices;

ALTER TABLE public.hd_work_orders ADD COLUMN IF NOT EXISTS unit_hours NUMERIC(10,1);
ALTER TABLE public.hd_invoices    ADD COLUMN IF NOT EXISTS unit_hours NUMERIC(10,1);

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'hd_work_orders_unit_hours_check') THEN
    ALTER TABLE public.hd_work_orders ADD CONSTRAINT hd_work_orders_unit_hours_check CHECK (unit_hours IS NULL OR unit_hours >= 0);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'hd_invoices_unit_hours_check') THEN
    ALTER TABLE public.hd_invoices ADD CONSTRAINT hd_invoices_unit_hours_check CHECK (unit_hours IS NULL OR unit_hours >= 0);
  END IF;
END $$;

COMMENT ON COLUMN public.hd_work_orders.unit_hours IS
  'Unit hour reading at the time of service, entered by the tech. NULL = no reading taken. Never read live from hd_units.';
COMMENT ON COLUMN public.hd_invoices.unit_hours IS
  'Unit hour reading carried from the work order at convert. Frozen: never re-read from hd_units. NULL = none recorded.';

DO $$
DECLARE n bigint;
BEGIN
  SELECT (SELECT count(*) FROM public.hd_work_orders WHERE unit_hours IS NOT NULL)
       + (SELECT count(*) FROM public.hd_invoices WHERE unit_hours IS NOT NULL) INTO n;
  IF n <> 0 THEN RAISE EXCEPTION '179: % document(s) gained an hour reading - nothing applied', n; END IF;

  SELECT count(*) INTO n FROM _wo_before b LEFT JOIN public.hd_work_orders w ON w.id = b.id
   WHERE w.id IS NULL OR w.total_amount IS DISTINCT FROM b.total_amount OR w.tax_amount IS DISTINCT FROM b.tax_amount;
  IF n <> 0 OR (SELECT count(*) FROM public.hd_work_orders) <> (SELECT count(*) FROM _wo_before) THEN
    RAISE EXCEPTION '179: % work order(s) changed - nothing applied', n; END IF;

  SELECT count(*) INTO n FROM _inv_before b LEFT JOIN public.hd_invoices i ON i.id = b.id
   WHERE i.id IS NULL OR i.total IS DISTINCT FROM b.total OR i.tax_amount IS DISTINCT FROM b.tax_amount
      OR i.subtotal_labor IS DISTINCT FROM b.subtotal_labor OR i.subtotal_parts IS DISTINCT FROM b.subtotal_parts;
  IF n <> 0 OR (SELECT count(*) FROM public.hd_invoices) <> (SELECT count(*) FROM _inv_before) THEN
    RAISE EXCEPTION '179: % invoice(s) changed - nothing applied', n; END IF;
END $$;

-- What the editor shows last. Expect: documents_with_hours = 0 and changed_* = 0.
SELECT (SELECT count(*) FROM public.hd_work_orders WHERE unit_hours IS NOT NULL)
     + (SELECT count(*) FROM public.hd_invoices WHERE unit_hours IS NOT NULL)        AS documents_with_hours,
       (SELECT count(*) FROM _wo_before b JOIN public.hd_work_orders w ON w.id = b.id WHERE w.total_amount IS DISTINCT FROM b.total_amount) AS changed_work_order_totals,
       (SELECT count(*) FROM _inv_before b JOIN public.hd_invoices i ON i.id = b.id WHERE i.total IS DISTINCT FROM b.total) AS changed_invoice_totals;

COMMIT;
