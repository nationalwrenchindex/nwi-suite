-- Odometer reading at the time of service, captured on the invoice.
--
-- The Garage sync needs this and had no reliable source: it was falling back to
-- vehicles.mileage, which is whatever was recorded when the vehicle was first
-- added and drifts further from reality with every visit. Worse,
-- garage_service_history.mileage_at_service is NOT NULL, so an invoice with no
-- odometer anywhere could not be posted to the customer's garage at all.
--
-- It also feeds the customer's service reminders, which are driven off
-- garage_service_reminders.due_mileage — a stale reading there means reminders
-- fire at the wrong time.

ALTER TABLE public.invoices
  ADD COLUMN IF NOT EXISTS mileage_at_service INTEGER;

COMMENT ON COLUMN public.invoices.mileage_at_service IS
  'Odometer reading when the work was performed. Entered by the mechanic; preferred over vehicles.mileage for the NWI Garage service record.';
