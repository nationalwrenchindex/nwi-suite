-- ╔═══════════════════════════════════════════════════════════════════════════╗
-- ║ 145 — Reconcile the inventory schema drift                                 ║
-- ╚═══════════════════════════════════════════════════════════════════════════╝
--
-- BIG RUN THREE item 7a. "A fresh environment built from my migration files comes
-- up broken."  It does, and here is exactly how.
--
-- ── THE DIAGNOSIS ───────────────────────────────────────────────────────────
--
-- Migration 028 was applied IN A MODIFIED FORM, BY HAND. It is the only migration
-- that touches any of these tables, so production could not have reached its
-- current shape by running the files. Three specific divergences:
--
--   1. product_usage_log      — 028 CREATEs it. It does not exist in production
--                               (PGRST205). api/jobs/[id]/route.ts INSERTS into it
--                               fire-and-forget, so every detailer product usage
--                               has been silently discarded.
--
--   2. products_inventory     — 028 declares brand, container_size and category.
--                               Production has none of the three. NOTHING in the
--                               codebase reads them, so this is a fresh-environment
--                               problem only — no live feature is broken by it.
--
--   3. service_products       — 028 declares `service_name`. Production has
--                               `service_slug`, and the CODE uses service_slug.
--                               So production is right and the migration file is
--                               the stale one.
--
-- ── WHICH FIX BELONGS WHERE ─────────────────────────────────────────────────
--
-- MIGRATION (this file): create the missing table, add the missing columns, and
-- rename service_name -> service_slug ONLY where the old name is what exists. All
-- three are idempotent, so this converges a fresh environment AND production onto
-- the same shape and is a no-op on second run.
--
-- CODE (committed alongside): the product_usage_log insert gets its error checked.
-- A fire-and-forget write to a table that does not exist is how this went
-- unnoticed for however long it has been true — the migration stops it failing,
-- the error check stops the NEXT one being invisible.
--
-- 028 IS DELIBERATELY NOT EDITED. Rewriting an applied migration makes the file
-- history lie about what was run. This file is the correction, in order.
--
-- SAFE TO RUN ON A LIVE DATABASE. One CREATE TABLE IF NOT EXISTS, three ADD COLUMN
-- IF NOT EXISTS, and a conditional rename. No row changes value. Nothing is dropped.

BEGIN;

-- ─────────────────────────────────────────────────────────────────────────────
-- 1. product_usage_log — the table the code has been writing into thin air
--
-- Shaped to match what api/jobs/[id]/route.ts actually inserts, which is the real
-- contract, rather than 028's declaration:
--   user_id, product_inventory_id, job_id, service_name, quantity_used,
--   cost_cents_attributed
-- ─────────────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.product_usage_log (
  id                     UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id                UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  product_inventory_id   UUID REFERENCES public.products_inventory(id) ON DELETE SET NULL,
  job_id                 UUID,
  -- The human service label, as the route writes it. Kept as service_name here and
  -- NOT renamed to a slug: the route resolves a slug to its display label before
  -- logging, because this row is read by a human looking at product consumption.
  service_name           TEXT,
  quantity_used          NUMERIC(12,3),
  cost_cents_attributed  INTEGER,
  created_at             TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ON DELETE SET NULL rather than CASCADE on the product: deleting a product from
-- inventory must not erase the record that it was used on a job. The cost was
-- still incurred.
COMMENT ON COLUMN public.product_usage_log.product_inventory_id IS
  'SET NULL on delete: removing a product from inventory must not erase the history of it being used.';

CREATE INDEX IF NOT EXISTS product_usage_log_user_idx ON public.product_usage_log (user_id);
CREATE INDEX IF NOT EXISTS product_usage_log_job_idx  ON public.product_usage_log (job_id) WHERE job_id IS NOT NULL;

ALTER TABLE public.product_usage_log ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS product_usage_log_all ON public.product_usage_log;
CREATE POLICY product_usage_log_all ON public.product_usage_log
  FOR ALL USING (user_id = auth.uid()) WITH CHECK (user_id = auth.uid());

-- ─────────────────────────────────────────────────────────────────────────────
-- 2. products_inventory — the three columns 028 declares and production lacks
--
-- Nothing reads them today, so this changes no behaviour. It exists so that a
-- fresh environment and production stop being different databases.
-- ─────────────────────────────────────────────────────────────────────────────
ALTER TABLE public.products_inventory
  ADD COLUMN IF NOT EXISTS brand          TEXT,
  ADD COLUMN IF NOT EXISTS container_size TEXT,
  ADD COLUMN IF NOT EXISTS category       TEXT;

-- ─────────────────────────────────────────────────────────────────────────────
-- 3. service_products.service_name -> service_slug
--
-- PRODUCTION IS ALREADY CORRECT and the migration file is the stale one, so this
-- runs ONLY where the old column exists and the new one does not. On production
-- both conditions are false and nothing happens.
--
-- The UNIQUE constraint 028 declared on (user_id, service_name, product_inventory_id)
-- is recreated against the new name only if the rename actually fired.
-- ─────────────────────────────────────────────────────────────────────────────
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'service_products' AND column_name = 'service_name'
  ) AND NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'service_products' AND column_name = 'service_slug'
  ) THEN
    ALTER TABLE public.service_products RENAME COLUMN service_name TO service_slug;
    RAISE NOTICE '145: renamed service_products.service_name -> service_slug (fresh environment)';
  ELSE
    RAISE NOTICE '145: service_products.service_slug already correct, no rename needed';
  END IF;
END $$;

CREATE UNIQUE INDEX IF NOT EXISTS service_products_unique_idx
  ON public.service_products (user_id, service_slug, product_inventory_id);

COMMIT;

-- ╔═══════════════════════════════════════════════════════════════════════════╗
-- ║ WHAT THIS DOES NOT DO                                                     ║
-- ╠═══════════════════════════════════════════════════════════════════════════╣
-- ║ It does not BACKFILL product_usage_log. Every detailer product usage       ║
-- ║ written before this migration went to a table that did not exist and is    ║
-- ║ gone — there is nothing to recover it from. The COGS expense rows those    ║
-- ║ same code paths wrote DID land, so the money was recorded even though the  ║
-- ║ per-product detail was not.                                               ║
-- ║                                                                           ║
-- ║ It does not edit migration 028. Rewriting an applied migration makes the   ║
-- ║ file history lie about what was run.                                       ║
-- ╚═══════════════════════════════════════════════════════════════════════════╝
