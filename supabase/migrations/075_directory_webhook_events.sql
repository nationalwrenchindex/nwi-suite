-- Brilliant Directories webhook events
-- Logs every inbound webhook from nationalwrenchindex.com (the directory) and
-- tracks whether the NWI Suite invitation email was sent, or why it was skipped.

CREATE TABLE IF NOT EXISTS public.directory_webhook_events (
  id             UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  event_type     TEXT NOT NULL,
  member_email   TEXT,
  member_name    TEXT,
  member_company TEXT,
  member_city    TEXT,
  member_state   TEXT,
  raw_payload    JSONB,
  email_sent     BOOLEAN DEFAULT false,
  email_sent_at  TIMESTAMPTZ,
  skip_reason    TEXT,
  created_at     TIMESTAMPTZ DEFAULT NOW()
);

-- Duplicate-prevention lookups hit member_email on every webhook.
CREATE INDEX IF NOT EXISTS directory_webhook_events_member_email_idx
  ON public.directory_webhook_events (LOWER(member_email));

CREATE INDEX IF NOT EXISTS directory_webhook_events_created_at_idx
  ON public.directory_webhook_events (created_at DESC);

ALTER TABLE public.directory_webhook_events ENABLE ROW LEVEL SECURITY;

-- Admin (Brock) only. The service-role key used by the webhook route bypasses
-- RLS entirely, so this policy governs dashboard/client reads only.
DROP POLICY IF EXISTS "Admin only" ON public.directory_webhook_events;
CREATE POLICY "Admin only"
  ON public.directory_webhook_events
  FOR ALL TO authenticated
  USING (auth.uid() = '4a8c046f-7db3-42bb-8422-fd47efb7678c');
