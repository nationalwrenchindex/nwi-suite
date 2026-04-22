-- ============================================================
-- Migration: 015_financial_breakdown.sql
-- Phase 6: Auto-Financial Breakdown
-- When an invoice is marked paid, COGS and P&L are auto-posted.
-- ============================================================

-- ── Expand expense category CHECK constraint ────────────────────────────────
-- Add 'parts_cogs' (Cost of Goods Sold — Parts) and 'shop_supplies'
ALTER TABLE public.expenses DROP CONSTRAINT IF EXISTS expenses_category_check;
ALTER TABLE public.expenses ADD CONSTRAINT expenses_category_check
  CHECK (category IN (
    'parts', 'tools', 'fuel', 'insurance', 'licensing',
    'marketing', 'software', 'training', 'vehicle_maintenance',
    'office_supplies', 'subcontractor', 'other',
    'parts_cogs', 'shop_supplies'
  ));

-- ── Add auto-posting tracking to expenses ──────────────────────────────────
ALTER TABLE public.expenses
  ADD COLUMN IF NOT EXISTS linked_invoice_id UUID
    REFERENCES public.invoices(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS transaction_type TEXT DEFAULT 'manual';
  -- 'manual'       = tech entered manually
  -- 'auto_invoice' = auto-generated when invoice marked paid (Phase 6)
  -- 'auto_fuel'    = auto-generated from fuel/mileage (Phase 7)

CREATE INDEX IF NOT EXISTS idx_expenses_invoice
  ON public.expenses(linked_invoice_id);

CREATE INDEX IF NOT EXISTS idx_expenses_txn_type
  ON public.expenses(user_id, transaction_type);

-- ── Add per-invoice P&L caching columns ────────────────────────────────────
ALTER TABLE public.invoices
  ADD COLUMN IF NOT EXISTS cogs_total           NUMERIC(10,2) DEFAULT 0,
  ADD COLUMN IF NOT EXISTS labor_income         NUMERIC(10,2) DEFAULT 0,
  ADD COLUMN IF NOT EXISTS shop_supplies_total  NUMERIC(10,2) DEFAULT 0,
  ADD COLUMN IF NOT EXISTS parts_gross_profit   NUMERIC(10,2) DEFAULT 0,
  ADD COLUMN IF NOT EXISTS net_profit           NUMERIC(10,2) DEFAULT 0,
  ADD COLUMN IF NOT EXISTS financials_posted    BOOLEAN DEFAULT false,
  ADD COLUMN IF NOT EXISTS financials_posted_at TIMESTAMPTZ;

CREATE INDEX IF NOT EXISTS idx_invoices_financials_posted
  ON public.invoices(user_id, financials_posted);
