-- Migration 086: carry the selected customer name onto the PM checklist record.
ALTER TABLE public.hd_pm_checklists
  ADD COLUMN IF NOT EXISTS customer_name TEXT;
