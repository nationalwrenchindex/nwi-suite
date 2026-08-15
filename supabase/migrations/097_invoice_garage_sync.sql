-- Idempotency guard for posting a sent invoice into the customer's NWI Garage.
--
-- The natural place for this would be an invoice reference on
-- garage_service_history, but that table belongs to the Garage product and this
-- app should not reshape it. Tracking the link on our own invoice row keeps the
-- write one-directional: NWI Suite inserts into Garage and records that it did.
--
-- Without this, re-sending an invoice (invoices.times_sent increments freely)
-- would post the same service record again, and the customer's garage would
-- accumulate duplicates of one repair.

ALTER TABLE public.invoices
  ADD COLUMN IF NOT EXISTS garage_posted_at         TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS garage_service_record_id UUID;

COMMENT ON COLUMN public.invoices.garage_posted_at IS
  'Set when this invoice was posted to the customer''s NWI Garage. Non-null means do not post again.';
COMMENT ON COLUMN public.invoices.garage_service_record_id IS
  'The garage_service_history.id created for this invoice.';
