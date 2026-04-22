-- Phase 5: Mark as Paid — payment reference, notes, and paid index

ALTER TABLE public.invoices ADD COLUMN IF NOT EXISTS payment_reference TEXT;
ALTER TABLE public.invoices ADD COLUMN IF NOT EXISTS payment_notes      TEXT;

-- Extend the payment_method enum with Cash App
ALTER TYPE public.payment_method ADD VALUE IF NOT EXISTS 'cashapp';

-- Fast lookup for paid-invoice reporting
CREATE INDEX IF NOT EXISTS idx_invoices_paid
  ON public.invoices(user_id, paid_at)
  WHERE paid_at IS NOT NULL;
