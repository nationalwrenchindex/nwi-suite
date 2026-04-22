-- Phase 4: Invoice finalization — public token, send tracking, payment instructions

ALTER TABLE public.invoices ADD COLUMN IF NOT EXISTS public_token           TEXT UNIQUE;
ALTER TABLE public.invoices ADD COLUMN IF NOT EXISTS finalized_at            TIMESTAMP WITH TIME ZONE;
ALTER TABLE public.invoices ADD COLUMN IF NOT EXISTS sent_to_customer_at     TIMESTAMP WITH TIME ZONE;
ALTER TABLE public.invoices ADD COLUMN IF NOT EXISTS customer_viewed_at      TIMESTAMP WITH TIME ZONE;
ALTER TABLE public.invoices ADD COLUMN IF NOT EXISTS customer_view_count     INTEGER DEFAULT 0;
ALTER TABLE public.invoices ADD COLUMN IF NOT EXISTS payment_instructions    TEXT;
ALTER TABLE public.invoices ADD COLUMN IF NOT EXISTS sent_to_phone           TEXT;
ALTER TABLE public.invoices ADD COLUMN IF NOT EXISTS sent_to_email           TEXT;
ALTER TABLE public.invoices ADD COLUMN IF NOT EXISTS times_sent              INTEGER DEFAULT 0;

-- Default payment instructions on the tech's profile
ALTER TABLE public.profiles ADD COLUMN IF NOT EXISTS default_payment_instructions TEXT;

CREATE INDEX IF NOT EXISTS idx_invoices_public_token ON public.invoices(public_token);

-- Allow public SELECT on invoices accessed via public_token (service client bypasses RLS, but this is a safety net)
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public'
      AND tablename  = 'invoices'
      AND policyname = 'invoices: public view via token'
  ) THEN
    CREATE POLICY "invoices: public view via token"
      ON public.invoices FOR SELECT
      USING (public_token IS NOT NULL);
  END IF;
END $$;
