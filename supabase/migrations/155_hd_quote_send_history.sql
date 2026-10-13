-- 155_hd_quote_send_history.sql
--
-- Delivery history for HD quotes.
--
-- WHY THIS EXISTS
--
-- Migration 153 gave hd_quotes a public_token and an approval page, but nothing in
-- the product could put that link in front of a customer: the HD quote screen has
-- Convert to Invoice and Delete, and no Send. So the approval page was reachable only
-- by someone who already knew the token, which is nobody.
--
-- Sending needs somewhere to record what happened. hd_quotes has no sent_at,
-- sent_count or last_sent_at - hd_invoices has all three (migration 057) and the HD
-- invoice send route already uses them. These columns are the same three plus the two
-- destinations, so HD quotes and HD invoices record a send the same way.
--
-- THE THREE TIMESTAMPS ARE NOT THE SAME THING, and this is the distinction the
-- invoice route already holds:
--
--   sent_at      FIRST delivery only, never overwritten. "How long has this quote
--                been sitting with the customer" counts from here, so a courtesy
--                re-send must not restart that clock.
--   last_sent_at EVERY delivery. What the tech reads to tell "texted an hour ago"
--                from "texted in July".
--   sent_count   How many times. Only ever bumped by a send that actually delivered.
--
-- SAFE TO RUN TWICE. Every statement is IF NOT EXISTS.
--
-- ADDITIVE ONLY. No column is dropped, no type changed, no data rewritten. Existing
-- quotes get NULL for the three timestamps and 0 for the count, which is exactly
-- true: nothing in this codebase has ever sent an HD quote.
--
-- ASCII ONLY. No smart quotes, no em dashes, no degree signs. Windows clip.exe reads
-- stdin in the console code page rather than UTF-8 and has silently corrupted
-- technician-facing text in a migration once already.

ALTER TABLE public.hd_quotes ADD COLUMN IF NOT EXISTS sent_at       TIMESTAMPTZ;
ALTER TABLE public.hd_quotes ADD COLUMN IF NOT EXISTS last_sent_at  TIMESTAMPTZ;
ALTER TABLE public.hd_quotes ADD COLUMN IF NOT EXISTS sent_count    INTEGER NOT NULL DEFAULT 0;
ALTER TABLE public.hd_quotes ADD COLUMN IF NOT EXISTS sent_to_phone TEXT;
ALTER TABLE public.hd_quotes ADD COLUMN IF NOT EXISTS sent_to_email TEXT;

COMMENT ON COLUMN public.hd_quotes.sent_at IS
  'First delivery to the customer. Never overwritten on a re-send.';
COMMENT ON COLUMN public.hd_quotes.last_sent_at IS
  'Most recent delivery. Updated on every successful send.';
COMMENT ON COLUMN public.hd_quotes.sent_count IS
  'Successful deliveries only. A failed send does not bump this.';
COMMENT ON COLUMN public.hd_quotes.sent_to_phone IS
  'Last phone number a send was DELIVERED to. Not written for a send that failed.';
COMMENT ON COLUMN public.hd_quotes.sent_to_email IS
  'Last email address a send was DELIVERED to. Not written for a send that failed.';

-- Quotes waiting on a customer, oldest first. This is the one question the HD quote
-- list will want to ask of these columns ("what have I sent that nobody answered"),
-- and the partial index keeps it off the quotes that have never been sent.
CREATE INDEX IF NOT EXISTS hd_quotes_awaiting_response_idx
  ON public.hd_quotes (user_id, last_sent_at DESC)
  WHERE sent_at IS NOT NULL AND approved_at IS NULL AND declined_at IS NULL;

-- Verification. Expect five rows, then one row for the index.
--
--   SELECT column_name, data_type, column_default
--     FROM information_schema.columns
--    WHERE table_schema = 'public'
--      AND table_name   = 'hd_quotes'
--      AND column_name IN ('sent_at','last_sent_at','sent_count','sent_to_phone','sent_to_email')
--    ORDER BY column_name;
--
--   SELECT indexname FROM pg_indexes
--    WHERE schemaname = 'public' AND indexname = 'hd_quotes_awaiting_response_idx';
