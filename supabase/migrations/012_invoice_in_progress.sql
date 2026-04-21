-- Phase 3: Invoice in Progress lifecycle — extends invoices table for quote-to-invoice conversion

ALTER TABLE public.invoices ADD COLUMN IF NOT EXISTS invoice_status  TEXT DEFAULT 'in_progress';
-- invoice_status values: 'in_progress' | 'finalized' | 'awaiting_payment' | 'paid' | 'void'

ALTER TABLE public.invoices ADD COLUMN IF NOT EXISTS source_quote_id UUID REFERENCES public.quotes(id) ON DELETE SET NULL;
ALTER TABLE public.invoices ADD COLUMN IF NOT EXISTS job_notes        TEXT;
ALTER TABLE public.invoices ADD COLUMN IF NOT EXISTS shop_supplies    JSONB DEFAULT '[]'::jsonb;
ALTER TABLE public.invoices ADD COLUMN IF NOT EXISTS additional_parts JSONB DEFAULT '[]'::jsonb;
ALTER TABLE public.invoices ADD COLUMN IF NOT EXISTS additional_labor JSONB DEFAULT '[]'::jsonb;
ALTER TABLE public.invoices ADD COLUMN IF NOT EXISTS started_at       TIMESTAMP WITH TIME ZONE;
-- updated_at and its trigger already exist from 001_initial_schema.sql

CREATE INDEX IF NOT EXISTS idx_invoices_invoice_status ON public.invoices(user_id, invoice_status);
CREATE INDEX IF NOT EXISTS idx_invoices_source_quote   ON public.invoices(source_quote_id);
