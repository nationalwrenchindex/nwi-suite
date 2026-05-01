-- Phase 4: Profitability & Time Tools
-- Adds actual timing columns to jobs for estimate-vs-actual variance tracking.

ALTER TABLE jobs
  ADD COLUMN IF NOT EXISTS actual_start_at timestamptz,
  ADD COLUMN IF NOT EXISTS actual_end_at   timestamptz,
  ADD COLUMN IF NOT EXISTS completed_at    timestamptz;
