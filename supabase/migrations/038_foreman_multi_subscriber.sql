-- Foreman waitlist: captures emails when the 50-slot soft-launch cap is hit.

CREATE TABLE IF NOT EXISTS public.foreman_waitlist (
  id            UUID        DEFAULT gen_random_uuid() PRIMARY KEY,
  email         TEXT        NOT NULL,
  mechanic_name TEXT,
  business_name TEXT,
  phone         TEXT,
  notes         TEXT,
  notified      BOOLEAN     DEFAULT false,
  created_at    TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX foreman_waitlist_email   ON public.foreman_waitlist(email);
CREATE INDEX foreman_waitlist_created ON public.foreman_waitlist(created_at);

ALTER TABLE public.foreman_waitlist ENABLE ROW LEVEL SECURITY;

-- Founder admin only
CREATE POLICY "foreman_waitlist admin only" ON public.foreman_waitlist
  FOR ALL USING (auth.uid() = '4a8c046f-7db3-42bb-8422-fd47efb7678c'::uuid);
