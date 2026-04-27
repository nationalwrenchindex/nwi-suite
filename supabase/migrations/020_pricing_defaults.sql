-- Adds mechanic-configurable pricing defaults to the profiles table.
-- These values seed the QuickWrench quote sliders and inspection-generated quotes.

ALTER TABLE profiles
  ADD COLUMN IF NOT EXISTS default_labor_rate            numeric(10,2) NOT NULL DEFAULT 125,
  ADD COLUMN IF NOT EXISTS default_parts_markup_percent  numeric(5,2)  NOT NULL DEFAULT 20,
  ADD COLUMN IF NOT EXISTS default_tax_percent           numeric(5,2)  NOT NULL DEFAULT 8.5;
