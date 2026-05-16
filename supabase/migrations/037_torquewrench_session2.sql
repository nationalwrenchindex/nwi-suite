-- TorqueWrench session 2: retry tracking + fallback SMS gate

ALTER TABLE public.torquewrench_reviews
  ADD COLUMN IF NOT EXISTS send_attempts    INTEGER     DEFAULT 0,
  ADD COLUMN IF NOT EXISTS fallback_sent_at TIMESTAMPTZ;
