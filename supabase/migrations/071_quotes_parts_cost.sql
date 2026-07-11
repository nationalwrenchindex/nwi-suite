-- Migration 071: track parts COGS on QuickWrench quotes for job costing.

ALTER TABLE public.quotes
  ADD COLUMN IF NOT EXISTS parts_cost_total DECIMAL(10,2) DEFAULT 0;
