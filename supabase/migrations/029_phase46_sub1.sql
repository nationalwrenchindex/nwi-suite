-- Phase 4.6 Sub-Prompt 1: Calendar conflict, on_site status, Generate Quote

-- ── 1. Add on_site value to the job_status enum ───────────────────────────────
ALTER TYPE public.job_status ADD VALUE IF NOT EXISTS 'on_site';

-- ── 2. New timestamp columns on jobs ─────────────────────────────────────────
ALTER TABLE public.jobs
  ADD COLUMN IF NOT EXISTS on_my_way_sent_at timestamptz,
  ADD COLUMN IF NOT EXISTS on_site_at         timestamptz;

-- ── 3. job_id FK on quotes ────────────────────────────────────────────────────
ALTER TABLE public.quotes
  ADD COLUMN IF NOT EXISTS job_id uuid REFERENCES public.jobs(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_quotes_job_id ON public.quotes(job_id);
