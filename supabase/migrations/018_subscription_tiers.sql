-- ============================================================
-- Migration: 018_subscription_tiers.sql
-- Expands the subscriptions.tier check constraint to include
-- the two new tiers: quickwrench and elite.
-- ============================================================

-- Drop the old constraint (which only allowed starter/pro/full_suite)
ALTER TABLE public.subscriptions
  DROP CONSTRAINT IF EXISTS subscriptions_tier_check;

-- Add the expanded constraint with all five tiers
ALTER TABLE public.subscriptions
  ADD CONSTRAINT subscriptions_tier_check
  CHECK (tier IN ('starter', 'pro', 'full_suite', 'quickwrench', 'elite'));

-- ============================================================
-- END OF MIGRATION
-- ============================================================
