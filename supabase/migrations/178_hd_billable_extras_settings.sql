-- 178_hd_billable_extras_settings.sql
--
-- HD's own travel, mileage and shop supplies defaults, and a service call fee.
--
-- WHY THIS EXISTS
--
-- 1. HD HAD NO EXTRAS SETTINGS OF ITS OWN. The HD quote and invoice forms read LD's
--    columns from migration 142 (bill_travel, travel_rate_per_hour, ...), which only
--    the LD Settings screen can edit. A shop whose HD labor rate is 145 had travel
--    billed at its LD figure, and changing one product's setting changed the other's.
--    These are the HD copies, edited on HD Settings (and Reefer Standalone's, which is
--    the same screen).
--
-- 2. A SERVICE CALL FEE. A flat fee, separate from the road call fee (156), with its
--    own on/off and its own tax treatment: 'labor' (follows the labor tax rate) or
--    'none'. Every shop's state differs, so it is a setting, defaulting to 'labor'.
--
-- 3. EACH DOCUMENT RECORDS ITS OWN SERVICE CALL FEE AND TAX TREATMENT. Money is frozen:
--    a quote, work order or invoice keeps what it was priced with, and changing the
--    setting later never re-taxes a document a customer already has.
--
-- THE BACKFILL copies each profile's LD extras settings into the new HD columns,
-- because that is exactly what the HD forms bill with today. Nothing a shop bills
-- changes on the day this runs; the shop then edits HD's own figures.
--
-- NO DOCUMENT ROW IS WRITTEN. hd_quotes, hd_work_orders and hd_invoices gain two
-- NULL columns; the self-checks compare every money column on every row before and
-- after, and anything that moved rolls the whole thing back.
--
-- ASCII ONLY, per the standing rule. Ends in COMMIT; any failed check raises and
-- nothing is applied.

BEGIN;

-- What every document carries before this runs.
CREATE TEMP TABLE _q_before   ON COMMIT DROP AS SELECT id, total, tax_amount FROM public.hd_quotes;
CREATE TEMP TABLE _wo_before  ON COMMIT DROP AS SELECT id, total_amount, tax_amount, travel_amount, mileage_amount, shop_supplies_fee FROM public.hd_work_orders;
CREATE TEMP TABLE _inv_before ON COMMIT DROP AS SELECT id, total, tax_amount, subtotal_labor, subtotal_parts, travel_amount, mileage_amount, shop_supplies_fee FROM public.hd_invoices;

-- 1. HD's own defaults on profiles.
ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS hd_bill_travel            BOOLEAN,
  ADD COLUMN IF NOT EXISTS hd_travel_rate_per_hour   NUMERIC(10,2),
  ADD COLUMN IF NOT EXISTS hd_bill_mileage           BOOLEAN,
  ADD COLUMN IF NOT EXISTS hd_mileage_rate_per_mile  NUMERIC(10,4),
  ADD COLUMN IF NOT EXISTS hd_bill_shop_supplies     BOOLEAN,
  ADD COLUMN IF NOT EXISTS hd_shop_supplies_percent  NUMERIC(6,3),
  ADD COLUMN IF NOT EXISTS hd_shop_supplies_cap      NUMERIC(10,2),
  ADD COLUMN IF NOT EXISTS hd_bill_service_call      BOOLEAN,
  ADD COLUMN IF NOT EXISTS hd_service_call_fee       NUMERIC(10,2),
  ADD COLUMN IF NOT EXISTS hd_service_call_tax       TEXT;

-- The backfill: what the HD forms bill with today. Only rows not yet set, so a re-run
-- never overwrites a figure the shop has since edited.
UPDATE public.profiles SET
  hd_bill_travel           = COALESCE(bill_travel, false),
  hd_travel_rate_per_hour  = travel_rate_per_hour,
  hd_bill_mileage          = COALESCE(bill_mileage, false),
  hd_mileage_rate_per_mile = mileage_rate_per_mile,
  hd_bill_shop_supplies    = COALESCE(bill_shop_supplies, false),
  hd_shop_supplies_percent = shop_supplies_percent,
  hd_shop_supplies_cap     = shop_supplies_cap
WHERE hd_bill_travel IS NULL;

UPDATE public.profiles SET hd_bill_service_call = false WHERE hd_bill_service_call IS NULL;
UPDATE public.profiles SET hd_service_call_tax = 'labor' WHERE hd_service_call_tax IS NULL;

ALTER TABLE public.profiles
  ALTER COLUMN hd_bill_travel        SET DEFAULT false,
  ALTER COLUMN hd_bill_mileage       SET DEFAULT false,
  ALTER COLUMN hd_bill_shop_supplies SET DEFAULT false,
  ALTER COLUMN hd_bill_service_call  SET DEFAULT false,
  ALTER COLUMN hd_service_call_tax   SET DEFAULT 'labor';

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'profiles_hd_service_call_tax_check') THEN
    ALTER TABLE public.profiles ADD CONSTRAINT profiles_hd_service_call_tax_check
      CHECK (hd_service_call_tax IN ('labor', 'none'));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'profiles_hd_extras_nonnegative') THEN
    ALTER TABLE public.profiles ADD CONSTRAINT profiles_hd_extras_nonnegative
      CHECK (COALESCE(hd_travel_rate_per_hour, 0) >= 0 AND COALESCE(hd_mileage_rate_per_mile, 0) >= 0
         AND COALESCE(hd_shop_supplies_percent, 0) >= 0 AND COALESCE(hd_shop_supplies_cap, 0) >= 0
         AND COALESCE(hd_service_call_fee, 0) >= 0);
  END IF;
END $$;

COMMENT ON COLUMN public.profiles.hd_travel_rate_per_hour IS
  'HD drive time rate per hour. NULL bills drive time at the HD labor rate. Taxed as labor.';
COMMENT ON COLUMN public.profiles.hd_mileage_rate_per_mile IS
  'HD per-mile rate. Mileage is never taxed.';
COMMENT ON COLUMN public.profiles.hd_shop_supplies_percent IS
  'Percent of HD PARTS sales only - never labor, drive time, mileage or a fee. Taxed as parts.';
COMMENT ON COLUMN public.profiles.hd_shop_supplies_cap IS
  'Optional dollar cap on HD shop supplies per document. NULL means uncapped.';
COMMENT ON COLUMN public.profiles.hd_service_call_fee IS
  'HD service call fee seeded into new quotes, work orders and invoices when hd_bill_service_call is on. Separate from hd_road_call_fee.';
COMMENT ON COLUMN public.profiles.hd_service_call_tax IS
  'labor = taxed at the labor rate (when labor is taxed); none = never taxed. Recorded on each document when it is priced.';

-- 2. The fee and its tax treatment, on each HD document. NULL = no service call fee.
DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['hd_quotes', 'hd_work_orders', 'hd_invoices'] LOOP
    EXECUTE format('ALTER TABLE public.%I ADD COLUMN IF NOT EXISTS service_call_fee NUMERIC(10,2), ADD COLUMN IF NOT EXISTS service_call_tax TEXT', t);
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = t || '_service_call_check') THEN
      EXECUTE format('ALTER TABLE public.%I ADD CONSTRAINT %I CHECK ((service_call_tax IS NULL OR service_call_tax IN (''labor'', ''none'')) AND COALESCE(service_call_fee, 0) >= 0)', t, t || '_service_call_check');
    END IF;
  END LOOP;
END $$;

-- 3. Self-checks. Any failure raises and nothing above is applied.
DO $$
DECLARE n bigint;
BEGIN
  SELECT count(*) INTO n FROM public.profiles
   WHERE hd_bill_travel IS DISTINCT FROM COALESCE(bill_travel, false)
      OR hd_travel_rate_per_hour IS DISTINCT FROM travel_rate_per_hour
      OR hd_bill_mileage IS DISTINCT FROM COALESCE(bill_mileage, false)
      OR hd_mileage_rate_per_mile IS DISTINCT FROM mileage_rate_per_mile
      OR hd_bill_shop_supplies IS DISTINCT FROM COALESCE(bill_shop_supplies, false)
      OR hd_shop_supplies_percent IS DISTINCT FROM shop_supplies_percent
      OR hd_shop_supplies_cap IS DISTINCT FROM shop_supplies_cap;
  IF n <> 0 THEN RAISE EXCEPTION '178: % profile(s) do not carry their LD extras into HD - nothing applied', n; END IF;

  SELECT count(*) INTO n FROM public.profiles WHERE hd_bill_service_call IS DISTINCT FROM false OR hd_service_call_tax IS DISTINCT FROM 'labor' OR hd_service_call_fee IS NOT NULL;
  IF n <> 0 THEN RAISE EXCEPTION '178: % profile(s) start with a service call fee set - nothing applied', n; END IF;

  SELECT (SELECT count(*) FROM public.hd_quotes WHERE service_call_fee IS NOT NULL OR service_call_tax IS NOT NULL)
       + (SELECT count(*) FROM public.hd_work_orders WHERE service_call_fee IS NOT NULL OR service_call_tax IS NOT NULL)
       + (SELECT count(*) FROM public.hd_invoices WHERE service_call_fee IS NOT NULL OR service_call_tax IS NOT NULL) INTO n;
  IF n <> 0 THEN RAISE EXCEPTION '178: % document(s) gained a service call fee - nothing applied', n; END IF;

  SELECT count(*) INTO n FROM _q_before b LEFT JOIN public.hd_quotes q ON q.id = b.id
   WHERE q.id IS NULL OR q.total IS DISTINCT FROM b.total OR q.tax_amount IS DISTINCT FROM b.tax_amount;
  IF n <> 0 OR (SELECT count(*) FROM public.hd_quotes) <> (SELECT count(*) FROM _q_before) THEN
    RAISE EXCEPTION '178: % quote(s) changed - nothing applied', n; END IF;

  SELECT count(*) INTO n FROM _wo_before b LEFT JOIN public.hd_work_orders w ON w.id = b.id
   WHERE w.id IS NULL OR w.total_amount IS DISTINCT FROM b.total_amount OR w.tax_amount IS DISTINCT FROM b.tax_amount
      OR w.travel_amount IS DISTINCT FROM b.travel_amount OR w.mileage_amount IS DISTINCT FROM b.mileage_amount
      OR w.shop_supplies_fee IS DISTINCT FROM b.shop_supplies_fee;
  IF n <> 0 OR (SELECT count(*) FROM public.hd_work_orders) <> (SELECT count(*) FROM _wo_before) THEN
    RAISE EXCEPTION '178: % work order(s) changed - nothing applied', n; END IF;

  SELECT count(*) INTO n FROM _inv_before b LEFT JOIN public.hd_invoices i ON i.id = b.id
   WHERE i.id IS NULL OR i.total IS DISTINCT FROM b.total OR i.tax_amount IS DISTINCT FROM b.tax_amount
      OR i.subtotal_labor IS DISTINCT FROM b.subtotal_labor OR i.subtotal_parts IS DISTINCT FROM b.subtotal_parts
      OR i.travel_amount IS DISTINCT FROM b.travel_amount OR i.mileage_amount IS DISTINCT FROM b.mileage_amount
      OR i.shop_supplies_fee IS DISTINCT FROM b.shop_supplies_fee;
  IF n <> 0 OR (SELECT count(*) FROM public.hd_invoices) <> (SELECT count(*) FROM _inv_before) THEN
    RAISE EXCEPTION '178: % invoice(s) changed - nothing applied', n; END IF;
END $$;

-- What the editor shows last. Expect: profiles_not_carried = 0, documents_with_a_fee = 0,
-- changed_* all 0, and your own row's HD figures matching your LD Travel, Mileage &
-- Supplies settings.
SELECT (SELECT count(*) FROM public.profiles)                                        AS profiles,
       (SELECT count(*) FROM public.profiles WHERE hd_bill_travel IS DISTINCT FROM COALESCE(bill_travel, false)
          OR hd_shop_supplies_percent IS DISTINCT FROM shop_supplies_percent)        AS profiles_not_carried,
       (SELECT count(*) FROM public.hd_invoices WHERE service_call_fee IS NOT NULL)   AS documents_with_a_fee,
       (SELECT count(*) FROM _q_before b JOIN public.hd_quotes q ON q.id = b.id WHERE q.total IS DISTINCT FROM b.total) AS changed_quote_totals,
       (SELECT count(*) FROM _wo_before b JOIN public.hd_work_orders w ON w.id = b.id WHERE w.total_amount IS DISTINCT FROM b.total_amount) AS changed_work_order_totals,
       (SELECT count(*) FROM _inv_before b JOIN public.hd_invoices i ON i.id = b.id WHERE i.total IS DISTINCT FROM b.total) AS changed_invoice_totals;

COMMIT;
