-- Migration 074: ensure quotes link to a customer (Intel Hub contact).

ALTER TABLE public.quotes
  ADD COLUMN IF NOT EXISTS customer_id UUID REFERENCES public.customers(id);
