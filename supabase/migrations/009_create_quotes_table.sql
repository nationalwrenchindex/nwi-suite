-- Phase 1: Quotes as a separate entity, lifecycle-managed before conversion to invoices

CREATE TABLE IF NOT EXISTS public.quotes (
  id                   UUID          PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id              UUID          NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  quote_number         TEXT          NOT NULL,
  status               TEXT          NOT NULL DEFAULT 'draft',
  -- Status values: 'draft' | 'sent' | 'approved' | 'declined' | 'converted' | 'expired'
  customer_id          UUID          REFERENCES public.customers(id) ON DELETE SET NULL,
  vehicle_id           UUID          REFERENCES public.vehicles(id) ON DELETE SET NULL,
  job_category         TEXT,
  job_subtype          TEXT,
  line_items           JSONB         DEFAULT '[]'::jsonb,
  labor_hours          NUMERIC,
  labor_rate           NUMERIC,
  parts_subtotal       NUMERIC,
  parts_markup_percent NUMERIC,
  labor_subtotal       NUMERIC,
  tax_percent          NUMERIC,
  tax_amount           NUMERIC,
  grand_total          NUMERIC,
  notes                TEXT,
  source               TEXT          DEFAULT 'quickwrench',
  converted_invoice_id UUID          REFERENCES public.invoices(id),
  sent_at              TIMESTAMP WITH TIME ZONE,
  approved_at          TIMESTAMP WITH TIME ZONE,
  declined_at          TIMESTAMP WITH TIME ZONE,
  converted_at         TIMESTAMP WITH TIME ZONE,
  created_at           TIMESTAMP WITH TIME ZONE DEFAULT now(),
  updated_at           TIMESTAMP WITH TIME ZONE DEFAULT now(),
  UNIQUE (user_id, quote_number)
);

ALTER TABLE public.quotes ENABLE ROW LEVEL SECURITY;

CREATE INDEX IF NOT EXISTS idx_quotes_user_id     ON public.quotes(user_id);
CREATE INDEX IF NOT EXISTS idx_quotes_status      ON public.quotes(user_id, status);
CREATE INDEX IF NOT EXISTS idx_quotes_customer_id ON public.quotes(customer_id);

-- Auto-update updated_at using the existing trigger function from 001_initial_schema.sql
CREATE TRIGGER set_quotes_updated_at
  BEFORE UPDATE ON public.quotes
  FOR EACH ROW EXECUTE PROCEDURE public.set_updated_at();

-- RLS: each technician sees and manages only their own quotes
CREATE POLICY "quotes: select own"
  ON public.quotes FOR SELECT
  USING (auth.uid() = user_id);

CREATE POLICY "quotes: insert own"
  ON public.quotes FOR INSERT
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "quotes: update own"
  ON public.quotes FOR UPDATE
  USING (auth.uid() = user_id);

CREATE POLICY "quotes: delete own"
  ON public.quotes FOR DELETE
  USING (auth.uid() = user_id);
