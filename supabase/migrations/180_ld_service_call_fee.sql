-- 180_ld_service_call_fee.sql
--
-- A flat service call fee for LD: a setting, and a record on each LD document.
--
-- WHY THIS EXISTS
--
-- 1. LD HAD NO FLAT FEE OF ANY KIND. It bills drive time, mileage and shop supplies
--    (migration 142) but has no service call, road call or diagnostic fee. Migration
--    178 added a service call fee to HD only (hd_* columns and the hd_ documents).
--
-- 2. THE SETTING: an on/off, an amount, and its own tax treatment - 'labor' (taxed in
--    the labor bucket, so it follows the labor tax setting) or 'none'. Every state
--    differs, so it is a setting, defaulting to 'labor'. Same three answers HD asks.
--
-- 3. EACH DOCUMENT RECORDS ITS OWN FEE AND TAX TREATMENT. Money is frozen: a quote,
--    work order or invoice keeps what it was priced with, and changing the setting
--    later never re-taxes a document a customer already has.
--
-- NO DOCUMENT ROW IS WRITTEN. quotes, work_orders and invoices gain two NULL columns;
-- the self-checks compare every money column on every row before and after, and
-- anything that moved rolls the whole thing back. No profile starts billing a fee:
-- bill_service_call is set false on every row.
--
-- No table, view or policy is created, so there is no grant or policy to scope.
--
-- ASCII ONLY, per the standing rule. Ends in COMMIT; any failed check raises and
-- nothing is applied.

BEGIN;

-- What every LD document carries before this runs.
CREATE TEMP TABLE _q_before   ON COMMIT DROP AS SELECT id, grand_total, tax_amount, tax_breakdown::text AS bd FROM public.quotes;
CREATE TEMP TABLE _wo_before  ON COMMIT DROP AS SELECT id, grand_total, tax_amount, tax_breakdown::text AS bd FROM public.work_orders;
CREATE TEMP TABLE _inv_before ON COMMIT DROP AS SELECT id, total, subtotal, tax_amount, tax_breakdown::text AS bd FROM public.invoices;
CREATE TEMP TABLE _p_before   ON COMMIT DROP AS SELECT id, bill_travel, bill_mileage, bill_shop_supplies FROM public.profiles;

-- 1. LD's defaults on profiles. (HD's are hd_bill_service_call etc. from 178.)
ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS bill_service_call BOOLEAN,
  ADD COLUMN IF NOT EXISTS service_call_fee  NUMERIC(10,2),
  ADD COLUMN IF NOT EXISTS service_call_tax  TEXT;

UPDATE public.profiles SET bill_service_call = false   WHERE bill_service_call IS NULL;
UPDATE public.profiles SET service_call_tax  = 'labor' WHERE service_call_tax  IS NULL;

ALTER TABLE public.profiles
  ALTER COLUMN bill_service_call SET DEFAULT false,
  ALTER COLUMN service_call_tax  SET DEFAULT 'labor';

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'profiles_service_call_tax_check') THEN
    ALTER TABLE public.profiles ADD CONSTRAINT profiles_service_call_tax_check
      CHECK (service_call_tax IN ('labor', 'none'));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'profiles_service_call_fee_nonnegative') THEN
    ALTER TABLE public.profiles ADD CONSTRAINT profiles_service_call_fee_nonnegative
      CHECK (COALESCE(service_call_fee, 0) >= 0);
  END IF;
END $$;

COMMENT ON COLUMN public.profiles.bill_service_call IS
  'LD: seed a flat service call fee into new quotes, work orders and invoices.';
COMMENT ON COLUMN public.profiles.service_call_fee IS
  'LD service call fee, seeded when bill_service_call is on. Editable per document.';
COMMENT ON COLUMN public.profiles.service_call_tax IS
  'labor = taxed in the labor bucket (follows the labor tax setting); none = never taxed. Recorded on each document when it is priced.';

-- 2. The fee and its tax treatment, on each LD document. NULL = no service call fee.
DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['quotes', 'work_orders', 'invoices'] LOOP
    EXECUTE format('ALTER TABLE public.%I ADD COLUMN IF NOT EXISTS service_call_fee NUMERIC(10,2), ADD COLUMN IF NOT EXISTS service_call_tax TEXT', t);
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = t || '_service_call_check') THEN
      EXECUTE format('ALTER TABLE public.%I ADD CONSTRAINT %I CHECK ((service_call_tax IS NULL OR service_call_tax IN (''labor'', ''none'')) AND COALESCE(service_call_fee, 0) >= 0)', t, t || '_service_call_check');
    END IF;
  END LOOP;
END $$;

COMMENT ON COLUMN public.quotes.service_call_fee      IS 'Flat service call fee on this quote. NULL = none. Its own line, never folded into labor.';
COMMENT ON COLUMN public.work_orders.service_call_fee IS 'Flat service call fee on this work order. NULL = none. Its own line, never folded into labor.';
COMMENT ON COLUMN public.invoices.service_call_fee    IS 'Flat service call fee on this invoice. NULL = none. Its own line, never folded into labor.';

-- 3. Self-checks. Any failure raises and nothing above is applied.
DO $$
DECLARE n bigint;
BEGIN
  SELECT count(*) INTO n FROM information_schema.columns
   WHERE table_schema = 'public'
     AND ((table_name = 'profiles' AND column_name IN ('bill_service_call', 'service_call_fee', 'service_call_tax'))
       OR (table_name IN ('quotes', 'work_orders', 'invoices') AND column_name IN ('service_call_fee', 'service_call_tax')));
  IF n <> 9 THEN RAISE EXCEPTION '180: expected 9 new columns, found % - nothing applied', n; END IF;

  SELECT count(*) INTO n FROM public.profiles
   WHERE bill_service_call IS DISTINCT FROM false OR service_call_tax IS DISTINCT FROM 'labor' OR service_call_fee IS NOT NULL;
  IF n <> 0 THEN RAISE EXCEPTION '180: % profile(s) start with a service call fee set - nothing applied', n; END IF;

  -- The extras toggles a shop has today are untouched, so nothing it bills changes.
  SELECT count(*) INTO n FROM _p_before b LEFT JOIN public.profiles p ON p.id = b.id
   WHERE p.id IS NULL OR p.bill_travel IS DISTINCT FROM b.bill_travel OR p.bill_mileage IS DISTINCT FROM b.bill_mileage
      OR p.bill_shop_supplies IS DISTINCT FROM b.bill_shop_supplies;
  IF n <> 0 THEN RAISE EXCEPTION '180: % profile(s) changed what they bill - nothing applied', n; END IF;

  SELECT (SELECT count(*) FROM public.quotes      WHERE service_call_fee IS NOT NULL OR service_call_tax IS NOT NULL)
       + (SELECT count(*) FROM public.work_orders WHERE service_call_fee IS NOT NULL OR service_call_tax IS NOT NULL)
       + (SELECT count(*) FROM public.invoices    WHERE service_call_fee IS NOT NULL OR service_call_tax IS NOT NULL) INTO n;
  IF n <> 0 THEN RAISE EXCEPTION '180: % document(s) gained a service call fee - nothing applied', n; END IF;

  SELECT count(*) INTO n FROM _q_before b LEFT JOIN public.quotes q ON q.id = b.id
   WHERE q.id IS NULL OR q.grand_total IS DISTINCT FROM b.grand_total OR q.tax_amount IS DISTINCT FROM b.tax_amount
      OR q.tax_breakdown::text IS DISTINCT FROM b.bd;
  IF n <> 0 OR (SELECT count(*) FROM public.quotes) <> (SELECT count(*) FROM _q_before) THEN
    RAISE EXCEPTION '180: % quote(s) changed - nothing applied', n; END IF;

  SELECT count(*) INTO n FROM _wo_before b LEFT JOIN public.work_orders w ON w.id = b.id
   WHERE w.id IS NULL OR w.grand_total IS DISTINCT FROM b.grand_total OR w.tax_amount IS DISTINCT FROM b.tax_amount
      OR w.tax_breakdown::text IS DISTINCT FROM b.bd;
  IF n <> 0 OR (SELECT count(*) FROM public.work_orders) <> (SELECT count(*) FROM _wo_before) THEN
    RAISE EXCEPTION '180: % work order(s) changed - nothing applied', n; END IF;

  SELECT count(*) INTO n FROM _inv_before b LEFT JOIN public.invoices i ON i.id = b.id
   WHERE i.id IS NULL OR i.total IS DISTINCT FROM b.total OR i.subtotal IS DISTINCT FROM b.subtotal
      OR i.tax_amount IS DISTINCT FROM b.tax_amount OR i.tax_breakdown::text IS DISTINCT FROM b.bd;
  IF n <> 0 OR (SELECT count(*) FROM public.invoices) <> (SELECT count(*) FROM _inv_before) THEN
    RAISE EXCEPTION '180: % invoice(s) changed - nothing applied', n; END IF;
END $$;

-- What the editor shows last. Expect: new_columns = 9, profiles_billing_a_fee = 0,
-- documents_with_a_fee = 0, changed_* all 0.
SELECT (SELECT count(*) FROM information_schema.columns WHERE table_schema = 'public'
          AND ((table_name = 'profiles' AND column_name IN ('bill_service_call', 'service_call_fee', 'service_call_tax'))
            OR (table_name IN ('quotes', 'work_orders', 'invoices') AND column_name IN ('service_call_fee', 'service_call_tax')))) AS new_columns,
       (SELECT count(*) FROM public.profiles WHERE bill_service_call IS DISTINCT FROM false)       AS profiles_billing_a_fee,
       (SELECT count(*) FROM public.quotes WHERE service_call_fee IS NOT NULL)
         + (SELECT count(*) FROM public.work_orders WHERE service_call_fee IS NOT NULL)
         + (SELECT count(*) FROM public.invoices WHERE service_call_fee IS NOT NULL)             AS documents_with_a_fee,
       (SELECT count(*) FROM _q_before b JOIN public.quotes q ON q.id = b.id WHERE q.grand_total IS DISTINCT FROM b.grand_total) AS changed_quote_totals,
       (SELECT count(*) FROM _wo_before b JOIN public.work_orders w ON w.id = b.id WHERE w.grand_total IS DISTINCT FROM b.grand_total) AS changed_work_order_totals,
       (SELECT count(*) FROM _inv_before b JOIN public.invoices i ON i.id = b.id WHERE i.total IS DISTINCT FROM b.total) AS changed_invoice_totals;

COMMIT;
