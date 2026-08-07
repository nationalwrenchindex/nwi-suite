-- Migration 084: PM checklist signature + tech name columns.
-- The code writes signature_base64 and tech_name, which the live hd_pm_checklists
-- table did not have. Also ensures tech_initials exists (the real column the code now
-- writes) as a safety net for any DB that was created with the older 'safety_initials'.

ALTER TABLE public.hd_pm_checklists
  ADD COLUMN IF NOT EXISTS signature_base64 TEXT,
  ADD COLUMN IF NOT EXISTS tech_name        TEXT,
  ADD COLUMN IF NOT EXISTS tech_initials    TEXT;
