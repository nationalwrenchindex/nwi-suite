-- 156_hd_fee_settings.sql
--
-- The shop's own diagnostic fee and road call fee.
--
-- WHY THIS EXISTS
--
-- Both HD forms hardcode them. src/app/hd/quotes/new/page.tsx and
-- src/app/hd/invoices/new/page.tsx each open with
--
--     labor_rate: 125, diagnostic_fee: 125, include_diagnostic: ...,
--     road_call_fee: 0,
--
-- so every quote and every invoice starts at $125 and $0 regardless of what the shop
-- charges, and the tech retypes both on every document or bills the wrong number. The
-- quote form has include_diagnostic defaulted ON, which means $125 of someone else's
-- diagnostic fee is on the quote before anyone touches it.
--
-- There is nowhere to put the right figure: profiles has hd_labor_rate (and
-- hd_parts_markup_percent, and the four tax columns) but no fee columns at all. These
-- two are the missing pair.
--
-- NULL MEANS NEVER SET, and the forms keep their current fallbacks for it - 125 for
-- the diagnostic, 0 for the road call. A shop that has not opened Settings sees
-- exactly what it sees today. That is why these are nullable with no DEFAULT: a
-- DEFAULT 125 would make "I charge nothing to diagnose" indistinguishable from "I
-- never said", and 0 is a legitimate answer a shop must be able to save.
--
-- ZERO IS A REAL VALUE. Anything reading these columns must treat NULL and 0 as
-- different; collapsing them is the bug that the billable-extras pass already cost a
-- week on.
--
-- A DOCUMENT'S RECORDED FEE STILL WINS. These are seeds for a new quote or invoice
-- only. hd_quotes.diagnostic_fee and hd_invoices.diagnostic_fee are what that document
-- charges, and nothing re-derives a saved document from these columns.
--
-- SAFE TO RUN TWICE. Both statements are IF NOT EXISTS. Additive only: nothing is
-- dropped, no type changes, no data rewritten.
--
-- ASCII ONLY, per the standing rule.

ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS hd_diagnostic_fee NUMERIC(10, 2),
  ADD COLUMN IF NOT EXISTS hd_road_call_fee  NUMERIC(10, 2);

COMMENT ON COLUMN public.profiles.hd_diagnostic_fee IS
  'What this shop charges to diagnose, seeded into new HD quotes and invoices. NULL = never set (the form falls back to 125). 0 is a real answer and is not the same as NULL. Taxed as labor, per the sales tax settings.';
COMMENT ON COLUMN public.profiles.hd_road_call_fee IS
  'What this shop charges to roll a truck, seeded into new HD quotes and invoices. NULL = never set (the form falls back to 0). 0 is a real answer and is not the same as NULL. Taxed as labor, per the sales tax settings.';

-- Sanity: a negative fee is a typo, not a discount. A CHECK rather than client-side
-- validation only, because /api/hd/settings is not the only thing that could ever
-- write these.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'profiles_hd_fees_nonnegative'
  ) THEN
    ALTER TABLE public.profiles
      ADD CONSTRAINT profiles_hd_fees_nonnegative
      CHECK (
        (hd_diagnostic_fee IS NULL OR hd_diagnostic_fee >= 0)
        AND (hd_road_call_fee IS NULL OR hd_road_call_fee >= 0)
      );
  END IF;
END $$;

-- Verification. Expect two rows, then one row.
--
--   SELECT column_name, data_type, is_nullable, column_default
--     FROM information_schema.columns
--    WHERE table_schema = 'public'
--      AND table_name   = 'profiles'
--      AND column_name IN ('hd_diagnostic_fee','hd_road_call_fee')
--    ORDER BY column_name;
--
--   SELECT conname FROM pg_constraint WHERE conname = 'profiles_hd_fees_nonnegative';
