-- Foreman Session 2: vapi webhook, phone provisioning, booking integration

-- foreman_calls: add missing columns needed by the webhook handler
ALTER TABLE public.foreman_calls
  ADD COLUMN IF NOT EXISTS error_message TEXT,
  ADD COLUMN IF NOT EXISTS outcome       TEXT, -- 'booked' | 'no_booking' | 'urgent' | 'error'
  ADD COLUMN IF NOT EXISTS service_type  TEXT;

-- foreman_settings: track Vapi's phone number ID so we can look up the subscriber on inbound calls
ALTER TABLE public.foreman_settings
  ADD COLUMN IF NOT EXISTS vapi_phone_number_id TEXT;

-- Unique index on vapi_call_id so upsert works during assistant-request retries
CREATE UNIQUE INDEX IF NOT EXISTS foreman_calls_vapi_call_id_idx
  ON public.foreman_calls(vapi_call_id)
  WHERE vapi_call_id IS NOT NULL;
