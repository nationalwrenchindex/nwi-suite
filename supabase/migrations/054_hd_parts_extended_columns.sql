-- Extend hd_parts with engine, specs, and subcategory columns
-- Required for the expanded parts seed (Session 2 catalog)

alter table public.hd_parts
  add column if not exists engine      text,
  add column if not exists specs       jsonb,
  add column if not exists subcategory text;

-- Make unit_models nullable so parts without a specific model list can be inserted cleanly
alter table public.hd_parts
  alter column unit_models set default '{}';
