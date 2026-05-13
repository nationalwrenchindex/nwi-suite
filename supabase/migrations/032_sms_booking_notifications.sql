-- Adds sms_booking_notifications_enabled to profiles.
-- Default TRUE so all existing subscribers get the value without any action needed.

ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS sms_booking_notifications_enabled boolean DEFAULT true;
