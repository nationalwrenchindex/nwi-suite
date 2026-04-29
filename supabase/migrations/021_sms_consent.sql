-- Add SMS opt-in consent tracking to bookings.
-- Carriers require explicit, affirmative opt-in at the point of phone number collection.
-- When sms_consent = false, the notification service skips SMS for that booking.
ALTER TABLE public.jobs
  ADD COLUMN IF NOT EXISTS sms_consent BOOLEAN NOT NULL DEFAULT false;
