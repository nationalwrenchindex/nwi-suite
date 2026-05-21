-- Migration 044: Drive time tracking and lunch break support on jobs
ALTER TABLE public.jobs
  ADD COLUMN IF NOT EXISTS drive_started_at       TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS drive_ended_at         TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS drive_minutes          INTEGER,
  ADD COLUMN IF NOT EXISTS lunch_break_started_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS lunch_break_minutes    INTEGER;
