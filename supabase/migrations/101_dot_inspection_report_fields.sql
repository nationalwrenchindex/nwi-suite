-- Migration 101: DOT annual inspection report identification fields.
--
-- 49 CFR 396.21(a) requires the annual inspection report to identify the motor
-- carrier operating the vehicle and the vehicle inspected. The form already
-- captured carrier/customer name, unit number, VIN/serial, odometer and date;
-- these two columns add the remaining report fields.

ALTER TABLE public.hd_dot_inspections
  ADD COLUMN IF NOT EXISTS carrier_address TEXT,
  ADD COLUMN IF NOT EXISTS license_plate   TEXT;
