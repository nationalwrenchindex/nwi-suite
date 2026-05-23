-- Migration: 045_comped_accounts.sql
-- Adds is_comped flag to subscriptions table.
-- Comped accounts are granted free Elite access by the founder.
-- Webhook logic must check this flag and skip any status/tier mutations
-- for comped accounts so they are never accidentally cancelled or charged.

ALTER TABLE public.subscriptions
  ADD COLUMN IF NOT EXISTS is_comped BOOLEAN NOT NULL DEFAULT false;

COMMENT ON COLUMN public.subscriptions.is_comped IS
  'True for founder-granted comp accounts. Webhook logic must skip these users.';

CREATE INDEX IF NOT EXISTS idx_subscriptions_is_comped
  ON public.subscriptions (is_comped)
  WHERE is_comped = true;
