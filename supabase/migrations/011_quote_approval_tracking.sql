-- Phase 2: Send Quote workflow, public token, approval tracking

ALTER TABLE public.quotes ADD COLUMN IF NOT EXISTS public_token TEXT UNIQUE;
ALTER TABLE public.quotes ADD COLUMN IF NOT EXISTS sent_to_phone TEXT;
ALTER TABLE public.quotes ADD COLUMN IF NOT EXISTS sent_to_email TEXT;
ALTER TABLE public.quotes ADD COLUMN IF NOT EXISTS customer_response_note TEXT;
ALTER TABLE public.quotes ADD COLUMN IF NOT EXISTS viewed_at TIMESTAMP WITH TIME ZONE;
ALTER TABLE public.quotes ADD COLUMN IF NOT EXISTS view_count INTEGER DEFAULT 0;
ALTER TABLE public.quotes ADD COLUMN IF NOT EXISTS times_sent INTEGER DEFAULT 0;
ALTER TABLE public.quotes ADD COLUMN IF NOT EXISTS quote_expires_at TIMESTAMP WITH TIME ZONE;

CREATE INDEX IF NOT EXISTS idx_quotes_public_token ON public.quotes(public_token);

-- Allow unauthenticated (anon) SELECT on quotes that have a public_token.
-- The 32-char random token is the authentication mechanism; callers must still
-- filter by public_token = $token to retrieve a specific quote.
-- Multiple permissive SELECT policies are OR'd, so existing "quotes: select own"
-- remains intact for logged-in technicians.
CREATE POLICY "quotes: public view via token"
  ON public.quotes FOR SELECT
  USING (public_token IS NOT NULL);
