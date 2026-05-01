-- Phase 4.6 Sub-2: In-app notification inbox + approval_method on quotes

-- ── 1. approval_method on quotes ─────────────────────────────────────────────
ALTER TABLE public.quotes
  ADD COLUMN IF NOT EXISTS approval_method TEXT;
-- values: 'verbal' | 'customer_link'

-- ── 2. In-app notifications inbox ────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.notifications (
  id         UUID                     PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id    UUID                     NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  type       TEXT                     NOT NULL,   -- e.g. 'quote_approved', 'quote_declined'
  title      TEXT                     NOT NULL,
  body       TEXT                     NOT NULL DEFAULT '',
  link       TEXT,                               -- in-app URL, e.g. /financials?tab=quotes&quote=...
  read_at    TIMESTAMP WITH TIME ZONE,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

ALTER TABLE public.notifications ENABLE ROW LEVEL SECURITY;

CREATE INDEX IF NOT EXISTS idx_notifications_user_id
  ON public.notifications(user_id, created_at DESC);

CREATE POLICY "notifications: select own"
  ON public.notifications FOR SELECT
  USING (auth.uid() = user_id);

CREATE POLICY "notifications: update own"
  ON public.notifications FOR UPDATE
  USING (auth.uid() = user_id);

-- Service role inserts (used by public respond endpoint via service client)
CREATE POLICY "notifications: service insert"
  ON public.notifications FOR INSERT
  WITH CHECK (true);
