-- ============================================================
-- Migration: 075_landscaping_tiers.sql
-- Adds the landscaping vertical tiers (lawn_starter / lawn_pro /
-- lawn_elite) to the subscriptions.tier check constraint.
--
-- Also repairs constraint drift: 018 was the last migration to set
-- subscriptions_tier_check and it only allowed
--   starter, pro, full_suite, quickwrench, elite
-- while the app has since written full_suite_plus (see
-- api/admin/comp-account TIER_CONFIG) and the hd_* tiers
-- (see lib/hd-access.ts) with no migration ever widening the check.
-- This migration re-states the constraint with every tier the code
-- actually uses, so landscaping does not hit the same wall.
-- ============================================================

ALTER TABLE public.subscriptions
  DROP CONSTRAINT IF EXISTS subscriptions_tier_check;

ALTER TABLE public.subscriptions
  ADD CONSTRAINT subscriptions_tier_check
  CHECK (tier IN (
    -- Light duty (original suite)
    'starter', 'pro', 'full_suite', 'full_suite_plus', 'quickwrench', 'elite',
    -- Heavy duty (HD Suite)
    'hd_reefer', 'hd_starter', 'hd_pro', 'hd_elite',
    -- Landscaping
    'lawn_starter', 'lawn_pro', 'lawn_elite'
  ));

-- vertical is TEXT with no check constraint (see 046); 'landscaping'
-- joins 'light_duty' and 'heavy_duty' as a recognized value.
COMMENT ON COLUMN public.subscriptions.vertical IS
  'Product vertical for this subscription: light_duty | heavy_duty | landscaping';

-- ============================================================
-- END OF MIGRATION
-- ============================================================
