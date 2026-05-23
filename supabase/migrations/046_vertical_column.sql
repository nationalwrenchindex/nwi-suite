-- Migration 046: Add vertical column to subscriptions
-- HD Suite subscribers get vertical = 'heavy_duty'
-- Existing subscribers default to 'light_duty'

ALTER TABLE public.subscriptions
  ADD COLUMN IF NOT EXISTS vertical TEXT NOT NULL DEFAULT 'light_duty';

COMMENT ON COLUMN public.subscriptions.vertical IS
  'Vertical product the subscription belongs to: light_duty or heavy_duty';

CREATE INDEX IF NOT EXISTS idx_subscriptions_vertical
  ON public.subscriptions (vertical);
