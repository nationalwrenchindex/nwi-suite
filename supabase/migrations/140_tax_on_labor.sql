-- --- 140. Tax parts and labor separately --------------------------------------
--
-- WHY
-- Tax has always been applied to the whole subtotal. Most states tax parts but not
-- separately-stated repair labor, so a shop in a state that exempts labor has been
-- over-collecting on every invoice. Measured on production at the time of writing:
-- across 13 HD invoices, $387.95 more tax was charged than a parts-only base would
-- have produced. It varies by state, so it has to be per business, not a constant.
--
-- -- 1. Per-business settings --------------------------------------------------
ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS tax_parts      boolean NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS tax_labor      boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS tax_rate_parts numeric NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS tax_rate_labor numeric NOT NULL DEFAULT 0;

COMMENT ON COLUMN public.profiles.tax_rate_parts IS
  'Percent, e.g. 7.75 -- same unit as the default_tax_percent it replaces.';
COMMENT ON COLUMN public.profiles.tax_rate_labor IS
  'Percent. Only applied when tax_labor is true.';

-- -- 2. Carry the existing rate across, so there is ONE source of truth --------
-- profiles.default_tax_percent (migration 020, percent, default 8.5) is the only
-- per-business tax rate today. Both new rate columns are seeded from it: parts
-- because that is the rate that keeps applying, and labor so that a shop which
-- later turns tax_labor ON gets its real rate instead of silently taxing at 0%.
UPDATE public.profiles
   SET tax_rate_parts = COALESCE(default_tax_percent, 0),
       tax_rate_labor = COALESCE(default_tax_percent, 0)
 WHERE tax_rate_parts = 0
   AND tax_rate_labor = 0;

-- -- 3. EXISTING BUSINESSES KEEP TODAY'S BEHAVIOUR -----------------------------
-- The column default is false, which is the right default for a NEW signup. But
-- flipping every existing business to false would silently stop them charging tax
-- on labor, and not every state exempts it -- North Carolina, where most of these
-- accounts are, taxes repair labor. Under-collecting is worse than the bug being
-- fixed here: over-collected tax is a refund, under-collected tax is money the
-- shop owes out of its own pocket.
--
-- So every business that exists today is switched ON, preserving its current
-- totals exactly, and turning labor tax OFF becomes a deliberate choice each shop
-- makes in Settings for its own state. Nothing about anyone's invoices changes the
-- moment this migration runs.
UPDATE public.profiles
   SET tax_labor = true
 WHERE tax_labor = false;

-- default_tax_percent is deliberately NOT dropped yet. It is still read by
-- /api/user/profile and the HD forms until the application is deployed; dropping
-- it in the same migration would break the running production build. It becomes
-- dead once this ships and can be removed in a later migration.

-- -- 4. What each document actually taxed --------------------------------------
-- The customer's copy has to be able to say WHAT was taxed, not just show a total,
-- and that cannot be recovered after the fact: LD line_items are
-- {description, quantity, unit_price, total} with no parts/labor discriminator, and
-- invoices.subtotal is a single blended number.
--
-- One JSONB column per document table rather than six numeric columns each:
--
--   {"parts": {"base": 707.80, "rate": 7.75, "amount": 54.85},
--    "labor": {"base": 675.00, "rate": 0,    "amount": 0},
--    "version": 1}
--
-- NULL means "written before this shipped" -- a legacy document, taxed on the whole
-- subtotal. Readers MUST treat NULL as "no split is known" and fall back to showing
-- the single tax_amount, never assume zeros. That is what keeps already-sent
-- invoices displaying exactly what the customer agreed to.
--
-- tax_amount on every one of these tables keeps its existing meaning: the total.
-- Nothing that reads it needs to change.
ALTER TABLE public.quotes                      ADD COLUMN IF NOT EXISTS tax_breakdown jsonb;
ALTER TABLE public.invoices                    ADD COLUMN IF NOT EXISTS tax_breakdown jsonb;
ALTER TABLE public.work_orders                 ADD COLUMN IF NOT EXISTS tax_breakdown jsonb;
ALTER TABLE public.work_order_segments         ADD COLUMN IF NOT EXISTS tax_breakdown jsonb;
ALTER TABLE public.work_order_segment_options  ADD COLUMN IF NOT EXISTS tax_breakdown jsonb;
ALTER TABLE public.hd_quotes                   ADD COLUMN IF NOT EXISTS tax_breakdown jsonb;
ALTER TABLE public.hd_invoices                 ADD COLUMN IF NOT EXISTS tax_breakdown jsonb;

-- -- 5. The services seam ------------------------------------------------------
-- Detailer documents bill through service_lines and adjustments, which are neither
-- parts nor separately-stated repair labor. They keep EXACTLY today's behaviour:
-- still in the taxable base, still at the shop's existing rate. Nothing is dropped
-- out of anyone's tax base.
--
-- They are recorded in tax_breakdown under a third key, 'services', from day one:
--
--   {"services": {"base": 250.00, "rate": 7.75, "amount": 19.38, "taxed": true}}
--
-- There is deliberately NO tax_services / tax_rate_services column. Services are
-- unconditionally taxed at the parts rate, which is what produces today's numbers
-- exactly. Because the shape is jsonb and the bucket is already being written,
-- turning services into a real toggle later is two profile columns and a settings
-- checkbox -- it does not need another document migration, and it does not need a
-- backfill, because the data is already there.

-- -- 6. OPTIONAL, NOT RUN BY THIS MIGRATION ------------------------------------
-- Section 3 leaves every existing shop taxing labor exactly as it does today, which
-- means the Florida shop keeps over-collecting until someone turns it off. That is
-- one click in Settings once this ships, and it is the shop's own call about its
-- own state -- which is why it is not automated here.
--
-- If you would rather fix it in SQL at the same time as running this, uncomment:
--
--   UPDATE public.profiles SET tax_labor = false WHERE state = 'FL';
--
-- At the time of writing that matches exactly one account: C&K UTILITY EQUIPMENT
-- SERVICE. It changes no existing invoice -- only what new ones will charge.
