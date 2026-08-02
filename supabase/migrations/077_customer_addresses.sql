-- Migration 077: customer addresses, per-customer payment terms, invoice due dates.
-- (076 was already taken by directory_listings; this is the customer-addresses migration.)

-- Feature 1: primary billing + optional corporate/service address on the customer record.
-- Feature 2: default payment terms per customer.
ALTER TABLE public.customers
  ADD COLUMN IF NOT EXISTS address_line1 TEXT,
  ADD COLUMN IF NOT EXISTS address_line2 TEXT,
  ADD COLUMN IF NOT EXISTS city TEXT,
  ADD COLUMN IF NOT EXISTS state TEXT,
  ADD COLUMN IF NOT EXISTS zip TEXT,
  ADD COLUMN IF NOT EXISTS corp_address_line1 TEXT,
  ADD COLUMN IF NOT EXISTS corp_address_line2 TEXT,
  ADD COLUMN IF NOT EXISTS corp_city TEXT,
  ADD COLUMN IF NOT EXISTS corp_state TEXT,
  ADD COLUMN IF NOT EXISTS corp_zip TEXT,
  ADD COLUMN IF NOT EXISTS has_corp_address BOOLEAN DEFAULT false,
  ADD COLUMN IF NOT EXISTS payment_terms TEXT
    CHECK (payment_terms IN ('net15','net30','net45'))
    DEFAULT 'net30';

-- Feature 1/2: denormalize the selected customer's addresses + terms onto HD quotes so the
-- quote/invoice can render them standalone (mirrors how customer_name/phone are already stored).
ALTER TABLE public.hd_quotes
  ADD COLUMN IF NOT EXISTS address_line1 TEXT,
  ADD COLUMN IF NOT EXISTS address_line2 TEXT,
  ADD COLUMN IF NOT EXISTS city TEXT,
  ADD COLUMN IF NOT EXISTS state TEXT,
  ADD COLUMN IF NOT EXISTS zip TEXT,
  ADD COLUMN IF NOT EXISTS corp_address_line1 TEXT,
  ADD COLUMN IF NOT EXISTS corp_address_line2 TEXT,
  ADD COLUMN IF NOT EXISTS corp_city TEXT,
  ADD COLUMN IF NOT EXISTS corp_state TEXT,
  ADD COLUMN IF NOT EXISTS corp_zip TEXT,
  ADD COLUMN IF NOT EXISTS has_corp_address BOOLEAN DEFAULT false,
  ADD COLUMN IF NOT EXISTS payment_terms TEXT DEFAULT 'net30';

-- Feature 2: invoice sent timestamp + computed due date, plus the same denormalized addresses.
-- payment_terms already exists on hd_invoices (default 'Due on receipt'); left untouched here.
ALTER TABLE public.hd_invoices
  ADD COLUMN IF NOT EXISTS sent_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS due_date DATE,
  ADD COLUMN IF NOT EXISTS address_line1 TEXT,
  ADD COLUMN IF NOT EXISTS address_line2 TEXT,
  ADD COLUMN IF NOT EXISTS city TEXT,
  ADD COLUMN IF NOT EXISTS state TEXT,
  ADD COLUMN IF NOT EXISTS zip TEXT,
  ADD COLUMN IF NOT EXISTS corp_address_line1 TEXT,
  ADD COLUMN IF NOT EXISTS corp_address_line2 TEXT,
  ADD COLUMN IF NOT EXISTS corp_city TEXT,
  ADD COLUMN IF NOT EXISTS corp_state TEXT,
  ADD COLUMN IF NOT EXISTS corp_zip TEXT,
  ADD COLUMN IF NOT EXISTS has_corp_address BOOLEAN DEFAULT false;

-- Feature 2/3: allow the 'sent' and 'overdue' statuses the payment-terms + late-fee flow needs.
ALTER TABLE public.hd_invoices DROP CONSTRAINT IF EXISTS hd_invoices_status_check;
ALTER TABLE public.hd_invoices ADD CONSTRAINT hd_invoices_status_check
  CHECK (status IN ('unpaid','sent','paid','partial','void','overdue'));
