-- ╔═══════════════════════════════════════════════════════════════════════════╗
-- ║ 142 — Billable extras, and documents that stand on their own              ║
-- ╚═══════════════════════════════════════════════════════════════════════════╝
--
-- Batched because every one of these is the same defect: a document does not
-- record the terms it was priced under, so reopening it re-prices it from
-- whatever Settings says today.
--
-- Covers BIG RUN THREE items 1a, 1b, 1c, 1d, 2a, 2b, 2c and 7c.
--
-- SAFE TO RUN ON A LIVE DATABASE. Every statement is additive or drops a
-- DEFAULT. Nothing is backfilled, nothing is dropped, no existing row changes
-- value. Every new nullable column means "not recorded" on an existing row,
-- which is deliberate and is what the UI must show — see the NULL CONTRACT note
-- at the foot of this file.
--
-- IDEMPOTENT. Re-running it is a no-op.

BEGIN;

-- ─────────────────────────────────────────────────────────────────────────────
-- 1. PRICING DEFAULTS (profiles)
--
-- Travel, mileage and shop supplies join the existing pricing block
-- (default_labor_rate, default_parts_markup_percent, default_tax_percent) so
-- Settings reads as one page rather than three.
--
-- travel_rate_per_hour is NULLABLE ON PURPOSE: NULL means "bill travel at the
-- labour rate", which is what most shops do. A number here overrides it. That
-- is why it is not DEFAULT 0 — zero is a real answer meaning "free travel", and
-- it must be distinguishable from "not set".
-- ─────────────────────────────────────────────────────────────────────────────
ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS bill_travel            BOOLEAN       DEFAULT false,
  ADD COLUMN IF NOT EXISTS travel_rate_per_hour   NUMERIC(10,2),
  ADD COLUMN IF NOT EXISTS bill_mileage           BOOLEAN       DEFAULT false,
  ADD COLUMN IF NOT EXISTS mileage_rate_per_mile  NUMERIC(10,4),
  ADD COLUMN IF NOT EXISTS bill_shop_supplies     BOOLEAN       DEFAULT false,
  ADD COLUMN IF NOT EXISTS shop_supplies_percent  NUMERIC(6,3),
  ADD COLUMN IF NOT EXISTS shop_supplies_cap      NUMERIC(10,2);

COMMENT ON COLUMN public.profiles.travel_rate_per_hour IS
  'Hourly travel rate. NULL means bill travel at default_labor_rate; 0 means travel is free.';
COMMENT ON COLUMN public.profiles.mileage_rate_per_mile IS
  'Per-mile rate. 4 decimal places because IRS-style rates are quoted to the tenth of a cent.';
COMMENT ON COLUMN public.profiles.shop_supplies_percent IS
  'Percent of the PARTS subtotal only. Never labour, travel or mileage.';
COMMENT ON COLUMN public.profiles.shop_supplies_cap IS
  'Optional dollar cap per document. NULL means uncapped.';

-- ─────────────────────────────────────────────────────────────────────────────
-- 2. BILLABLE EXTRAS, PER DOCUMENT (LD + HD, work order / quote / invoice)
--
-- Each extra stores THREE things: the input the tech typed, the rate in force
-- at that moment, and the resulting amount. Storing only the input would mean
-- reopening a six-month-old work order re-prices its travel at today's rate.
--
-- WHY shop_supplies_fee AND NOT shop_supplies_total.
-- invoices.shop_supplies_total already exists and is something else entirely:
-- the sum of the hand-itemised consumables list in invoices.shop_supplies
-- (migration 012), billed to the customer at cost and simultaneously booked as
-- a COGS expense row. shop_supplies_fee is the computed percentage-of-parts
-- charge, which has no cost basis and is margin. Two names because they are two
-- mechanisms, and collapsing them would double-bill a shop that uses both.
-- ─────────────────────────────────────────────────────────────────────────────
DO $$
DECLARE
  t text;
BEGIN
  FOR t IN SELECT * FROM unnest(ARRAY[
    'work_orders', 'quotes', 'invoices',
    'hd_work_orders', 'hd_quotes', 'hd_invoices'
  ]::text[])
  LOOP
    IF EXISTS (SELECT 1 FROM information_schema.tables
               WHERE table_schema = 'public' AND table_name = t) THEN
      EXECUTE format($f$
        ALTER TABLE public.%I
          ADD COLUMN IF NOT EXISTS travel_hours                  NUMERIC(8,2)  DEFAULT 0,
          ADD COLUMN IF NOT EXISTS travel_rate                   NUMERIC(10,2),
          ADD COLUMN IF NOT EXISTS travel_amount                 NUMERIC(10,2) DEFAULT 0,
          ADD COLUMN IF NOT EXISTS mileage_miles                 NUMERIC(10,2) DEFAULT 0,
          ADD COLUMN IF NOT EXISTS mileage_rate                  NUMERIC(10,4),
          ADD COLUMN IF NOT EXISTS mileage_amount                NUMERIC(10,2) DEFAULT 0,
          ADD COLUMN IF NOT EXISTS shop_supplies_percent_applied NUMERIC(6,3),
          ADD COLUMN IF NOT EXISTS shop_supplies_cap_applied     NUMERIC(10,2),
          ADD COLUMN IF NOT EXISTS shop_supplies_fee             NUMERIC(10,2) DEFAULT 0
      $f$, t);
    END IF;
  END LOOP;
END $$;

-- ─────────────────────────────────────────────────────────────────────────────
-- 3. UNIT NUMBER (item 1b)
--
-- hd_units.unit_number has existed since migration 047 and Fleet Pro reads it
-- everywhere. No DOCUMENT has ever captured it: hd_invoices carries
-- unit_manufacturer / unit_model / unit_serial / unit_year and no unit number,
-- so a fleet customer cannot match the invoice to their own equipment list.
--
-- Denormalised onto the document on purpose, exactly as the other unit fields
-- already are: an invoice is billed history and must still read correctly after
-- the unit is renumbered or deleted.
--
-- vehicles gets one too. LD has non_vin_identifier and license_plate, neither of
-- which is a fleet's own unit number.
-- ─────────────────────────────────────────────────────────────────────────────
DO $$
DECLARE
  t text;
BEGIN
  FOR t IN SELECT * FROM unnest(ARRAY[
    -- Documents
    'work_orders', 'quotes', 'invoices',
    'hd_work_orders', 'hd_quotes', 'hd_invoices',
    -- Inspection reports. These are customer-facing documents too — a DOT
    -- certificate or an ANSI A92 record goes in the customer's file, and
    -- without the unit number they cannot file it against their own equipment.
    'hd_dot_inspections', 'hd_aerial_inspections',
    'hd_equipment_inspections', 'hd_pm_checklists',
    -- The unit record itself, so LD has somewhere to hold it at all.
    'vehicles'
  ]::text[])
  LOOP
    IF EXISTS (SELECT 1 FROM information_schema.tables
               WHERE table_schema = 'public' AND table_name = t) THEN
      EXECUTE format('ALTER TABLE public.%I ADD COLUMN IF NOT EXISTS unit_number TEXT', t);
    END IF;
  END LOOP;
END $$;

COMMENT ON COLUMN public.vehicles.unit_number IS
  'The fleet''s own identifier for this unit (chassis 1, reefer 1R, APU 2APU). Printed FIRST in the unit block; the serial is for warranty.';

-- ─────────────────────────────────────────────────────────────────────────────
-- 4. INTERNAL NOTES (item 2c)
--
-- LD had nowhere to put a note that does not reach a customer: `notes` and
-- `job_notes` both print on /invoice/[token]. That is why the work-order
-- converter was left unable to carry a tech's notes forward — publishing them
-- was the only option available, and that is not a choice a converter should
-- make silently.
--
-- NOTHING customer-facing may ever read this column.
-- ─────────────────────────────────────────────────────────────────────────────
DO $$
DECLARE
  t text;
BEGIN
  FOR t IN SELECT * FROM unnest(ARRAY[
    'work_orders', 'quotes', 'invoices',
    'hd_work_orders', 'hd_quotes', 'hd_invoices'
  ]::text[])
  LOOP
    IF EXISTS (SELECT 1 FROM information_schema.tables
               WHERE table_schema = 'public' AND table_name = t) THEN
      EXECUTE format('ALTER TABLE public.%I ADD COLUMN IF NOT EXISTS internal_notes TEXT', t);
    END IF;
  END LOOP;
END $$;

COMMENT ON COLUMN public.invoices.internal_notes IS
  'Shop-only. MUST NOT be rendered on /invoice/[token], any PDF, any email or any SMS.';

-- ─────────────────────────────────────────────────────────────────────────────
-- 5. THE MARKUP IN FORCE, AND A SELF-CONTAINED INVOICE (items 1a + 2a)
--
-- THE MONEY BUG. work_orders and quotes both store parts_markup_percent.
-- `invoices` does not — it has no markup, no parts_subtotal, no labor_subtotal,
-- no labor_hours and no labor_rate. Every reader that needs them reaches through
-- invoices.source_quote_id to the quote, and when there is no source quote
-- (a work-order conversion, or a from-scratch invoice) the markup silently
-- reads 0. calcBreakdown() in api/invoices/[id] then reports parts revenue
-- equal to parts cost and gross profit of exactly zero.
--
-- These columns make the invoice answer for itself.
--
-- EVERY ONE IS NULLABLE AND NOTHING IS BACKFILLED. NULL means "not recorded",
-- and the UI must print "markup not recorded" rather than 0% — a stored 0 would
-- be a claim that the shop marked nothing up.
-- ─────────────────────────────────────────────────────────────────────────────
ALTER TABLE public.invoices
  ADD COLUMN IF NOT EXISTS parts_markup_percent NUMERIC(6,2),
  ADD COLUMN IF NOT EXISTS parts_subtotal       NUMERIC(10,2),
  ADD COLUMN IF NOT EXISTS parts_cost_total     NUMERIC(10,2),
  ADD COLUMN IF NOT EXISTS labor_subtotal       NUMERIC(10,2),
  ADD COLUMN IF NOT EXISTS labor_hours          NUMERIC(8,2),
  ADD COLUMN IF NOT EXISTS labor_rate           NUMERIC(10,2);

COMMENT ON COLUMN public.invoices.parts_markup_percent IS
  'The markup in force when this invoice was created. NULL means not recorded — never display it as 0%.';

-- HD prices parts off its own markup (profiles.hd_parts_markup_percent, 30%)
-- rather than the LD one, so the HD documents need the same record.
ALTER TABLE public.hd_invoices
  ADD COLUMN IF NOT EXISTS parts_markup_percent NUMERIC(6,2),
  ADD COLUMN IF NOT EXISTS labor_hours          NUMERIC(8,2);

ALTER TABLE public.hd_quotes
  ADD COLUMN IF NOT EXISTS parts_markup_percent NUMERIC(6,2),
  ADD COLUMN IF NOT EXISTS labor_hours          NUMERIC(8,2);

ALTER TABLE public.hd_work_orders
  ADD COLUMN IF NOT EXISTS parts_markup_percent NUMERIC(6,2);

-- ─────────────────────────────────────────────────────────────────────────────
-- 6. THE PHANTOM DIAGNOSTIC FEE (item 2b)
--
-- Migration 057 declared `diagnostic_fee DECIMAL(10,2) DEFAULT 125.00`. Four
-- inspection routes never set the column, so Postgres supplied 125, the printed
-- invoice showed a "Diagnostic Fee $125.00" line, and the stored total excluded
-- it. Three live invoices went out billing a fee nobody charged.
--
-- The writers were fixed in 0419a938. This disarms the trap itself. Existing
-- values are untouched — dropping a DEFAULT does not rewrite rows.
-- ─────────────────────────────────────────────────────────────────────────────
ALTER TABLE public.hd_invoices ALTER COLUMN diagnostic_fee DROP DEFAULT;
ALTER TABLE public.hd_quotes   ALTER COLUMN diagnostic_fee DROP DEFAULT;

-- A fee column that defaults to a charge is the same trap, so neither of these
-- is allowed to acquire one either.
ALTER TABLE public.hd_invoices ALTER COLUMN road_call_fee  SET DEFAULT 0;
ALTER TABLE public.hd_quotes   ALTER COLUMN road_call_fee  SET DEFAULT 0;

-- ─────────────────────────────────────────────────────────────────────────────
-- 7. hd_quotes.customer_id (item 7c)
--
-- hd_invoices got one in migration 118. hd_quotes still stores customer_name,
-- customer_phone and customer_email as loose text with no link, so a quote
-- cannot be found from the customer record and the customer cannot be corrected
-- from the quote.
--
-- ON DELETE SET NULL, matching 118: deleting a customer must not delete the
-- quote history that justifies the money.
-- ─────────────────────────────────────────────────────────────────────────────
ALTER TABLE public.hd_quotes
  ADD COLUMN IF NOT EXISTS customer_id UUID REFERENCES public.customers(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS hd_quotes_customer_id_idx
  ON public.hd_quotes (customer_id)
  WHERE customer_id IS NOT NULL;

-- ─────────────────────────────────────────────────────────────────────────────
-- 8. Lookup indexes for the new linkage
-- ─────────────────────────────────────────────────────────────────────────────
CREATE INDEX IF NOT EXISTS invoices_unit_number_idx
  ON public.invoices (user_id, unit_number)
  WHERE unit_number IS NOT NULL;

CREATE INDEX IF NOT EXISTS hd_invoices_unit_number_idx
  ON public.hd_invoices (user_id, unit_number)
  WHERE unit_number IS NOT NULL;

COMMIT;

-- ╔═══════════════════════════════════════════════════════════════════════════╗
-- ║ THE NULL CONTRACT                                                         ║
-- ╠═══════════════════════════════════════════════════════════════════════════╣
-- ║ Every column added here is NULL or 0 on all existing rows, and that is    ║
-- ║ the correct state. It means "this document was written before the field   ║
-- ║ existed", which is different from "the answer is zero":                   ║
-- ║                                                                           ║
-- ║   parts_markup_percent NULL  -> print "markup not recorded", never "0%"   ║
-- ║   unit_number          NULL  -> print nothing, do not fall back to serial ║
-- ║   travel_amount        0     -> print no travel line at all               ║
-- ║   mileage_amount       0     -> print no mileage line at all              ║
-- ║   shop_supplies_fee    0     -> print no shop supplies fee line at all    ║
-- ║   internal_notes       NULL  -> nothing to show, and never customer-facing ║
-- ║                                                                           ║
-- ║ NOTHING IS BACKFILLED. A markup guessed onto a sent invoice would be a    ║
-- ║ claim about money that nobody made.                                       ║
-- ╚═══════════════════════════════════════════════════════════════════════════╝
