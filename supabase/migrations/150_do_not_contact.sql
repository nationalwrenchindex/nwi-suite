-- =============================================================================
-- 150  do_not_contact - the block that lives in the database
-- =============================================================================
--
-- ADDITIVE ONLY. One new table, one function, no existing row touched, nothing
-- dropped. Safe to run twice.
--
-- -- WHY THIS EXISTS -------------------------------------------------------
--
-- 32 numbers opted out of the directory outreach programme between 2026-06-30 and
-- 2026-10-04. One received 36 messages before replying STOP. One received 8 and then
-- had FOUR MORE SENDS ATTEMPTED AFTER its STOP; Twilio refused them with error 21610.
--
-- The opt-out WAS recorded - in directory_optouts and hd_directory_optouts - and the
-- send path never read either table. The check existed only on the inbound reply
-- handler, so an opt-out stopped nothing on the way out.
--
-- At the moment of the shutdown, +16154963900 had been texted 16 times, had already
-- produced a 21610, and was STILL sitting at status='pending' - selected for the next
-- daily batch.
--
-- -- WHAT MAKES THIS DIFFERENT FROM THE TABLES WE ALREADY HAD ---------------
--
-- Nothing about the table. Everything about who reads it. The application's send
-- wrapper now consults this table BEFORE every outbound message and refuses, and it
-- FAILS CLOSED: if this table cannot be read, no message is sent. A guard that lets
-- messages through when the database is unreachable is not a guard.
--
-- One table for every product, every campaign and every message type, so a number
-- blocked once is blocked everywhere. The two old tables stay exactly as they are -
-- they are evidence, and this seeds itself from them.

BEGIN;

CREATE TABLE IF NOT EXISTS public.do_not_contact (
  id            UUID        PRIMARY KEY DEFAULT gen_random_uuid(),

  -- E.164. UNIQUE, so a second opt-out from the same number cannot create a row that
  -- some query then misses.
  phone         TEXT        NOT NULL UNIQUE,

  -- When they asked. Kept from the original evidence rather than defaulted to now(),
  -- because if a complaint ever arrives the date they asked is the whole argument.
  opted_out_at  TIMESTAMPTZ NOT NULL DEFAULT now(),

  -- How we know. 'twilio_21610_unsubscribed', 'replied_stop_bare_keyword',
  -- 'app_database_optout', 'migrated_from_directory_optouts', and so on.
  reason        TEXT        NOT NULL,

  -- The quoted message or the refusal that proves it. This is the defence.
  evidence      TEXT,

  -- A number may be blocked by a person rather than by a reply.
  blocked_by    TEXT,

  created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

COMMENT ON TABLE public.do_not_contact IS
  'Numbers that must never receive an outbound message, for any product or message type. Read by the application send wrapper before every send, which fails closed if this table is unreadable. Never delete a row to resume contact without reading the evidence column first.';

COMMENT ON COLUMN public.do_not_contact.opted_out_at IS
  'When the person asked, not when the row was written. Seeded from the original Twilio and application timestamps.';

COMMENT ON COLUMN public.do_not_contact.evidence IS
  'The quoted reply or the Twilio refusal behind this row. Kept verbatim because it is what we would show a regulator.';

CREATE INDEX IF NOT EXISTS do_not_contact_phone_idx ON public.do_not_contact (phone);

-- -----------------------------------------------------------------------------
-- The seed. 32 numbers.
-- -----------------------------------------------------------------------------
-- ON CONFLICT DO NOTHING so re-running keeps the EARLIEST recorded opt-out rather
-- than overwriting it with a later import.
INSERT INTO public.do_not_contact (phone, opted_out_at, reason, evidence) VALUES
  ('+12524745201', '2026-10-04T13:01:36.675Z', 'app_database_optout replied_stop_bare_keyword twilio_21610_unsubscribed', '2026-10-04T13:01:38.000Z send refused: 21610 | 2026-10-04T13:01:37.000Z replied "STOP" (matched "stop") | recorded in the app at 2026-10-04T13:01:36.675Z'),
  ('+12526757855', '2026-10-04T15:54:48.977Z', 'app_database_optout replied_stop_bare_keyword twilio_21610_unsubscribed', '2026-10-04T15:54:50.000Z send refused: 21610 | 2026-10-04T15:54:49.000Z replied "STOP" (matched "stop") | recorded in the app at 2026-10-04T15:54:48.977Z'),
  ('+13362804602', '2026-09-05T14:08:04.848Z', 'app_database_optout replied_stop_bare_keyword twilio_21610_unsubscribed', '2026-09-05T14:08:06.000Z send refused: 21610 | 2026-09-05T14:08:05.000Z replied "Stop" (matched "stop") | recorded in the app at 2026-09-05T14:08:04.848Z'),
  ('+13364081406', '2026-08-11T17:43:22.000Z', 'app_database_optout replied_stop_bare_keyword twilio_21610_unsubscribed', '2026-08-11T17:43:24.000Z send refused: 21610 | 2026-08-11T17:43:22.000Z replied "STOP" (matched "stop") | recorded in the app at 2026-08-11T17:43:22.641Z'),
  ('+13366002484', '2026-08-20T14:01:47.000Z', 'app_database_optout replied_stop_bare_keyword twilio_21610_unsubscribed', '2026-08-20T14:01:48.000Z send refused: 21610 | 2026-08-20T14:01:47.000Z replied "Stop" (matched "stop") | recorded in the app at 2026-08-20T14:01:47.070Z'),
  ('+13366958892', '2026-09-24T14:04:06.000Z', 'replied_stop_bare_keyword twilio_21610_unsubscribed', '2026-09-24T15:49:02.000Z send refused: 21610 | 2026-09-24T15:49:01.000Z send refused: 21610 | 2026-09-24T14:26:04.000Z send refused: 21610 | 2026-09-24T14:25:57.000Z send refused: 21610 | 2026-09-24T14:04:06.000Z replied "STOP" (matched "stop")'),
  ('+13369650004', '2026-08-14T16:04:02.823Z', 'app_database_optout replied_stop_bare_keyword twilio_21610_unsubscribed', '2026-08-14T16:04:03.000Z send refused: 21610 | 2026-08-14T16:04:03.000Z replied "Stop" (matched "stop") | recorded in the app at 2026-08-14T16:04:02.823Z'),
  ('+13863376193', '2026-07-31T22:30:52.000Z', 'replied_keyword_in_sentence_READ_THIS', '2026-07-31T22:30:52.000Z replied "Cancel appointment " (matched "cancel")'),
  ('+14044792318', '2026-08-22T21:54:52.000Z', 'app_database_optout replied_stop_bare_keyword twilio_21610_unsubscribed', '2026-08-22T21:54:53.000Z send refused: 21610 | 2026-08-22T21:54:52.000Z replied "STOP" (matched "stop") | recorded in the app at 2026-08-22T21:54:52.010Z'),
  ('+14235928088', '2026-09-01T17:49:34.912Z', 'app_database_optout', 'recorded in the app at 2026-09-01T17:49:34.912Z'),
  ('+14346324788', '2026-09-02T14:20:35.000Z', 'app_database_optout replied_stop_bare_keyword twilio_21610_unsubscribed', '2026-09-02T14:20:36.000Z send refused: 21610 | 2026-09-02T14:20:35.000Z replied "Stop" (matched "stop") | recorded in the app at 2026-09-02T14:20:35.460Z'),
  ('+16105954152', '2026-08-25T00:05:40.909Z', 'app_database_optout replied_stop_bare_keyword twilio_21610_unsubscribed', '2026-08-25T00:05:43.000Z send refused: 21610 | 2026-08-25T00:05:41.000Z replied "Stop" (matched "stop") | recorded in the app at 2026-08-25T00:05:40.909Z'),
  ('+16154963900', '2026-08-21T13:04:08.712Z', 'app_database_optout replied_stop_bare_keyword twilio_21610_unsubscribed', '2026-08-21T13:04:18.000Z send refused: 21610 | 2026-08-21T13:04:10.000Z send refused: 21610 | 2026-08-21T13:04:09.000Z replied "Stop" (matched "stop") | recorded in the app at 2026-08-21T13:04:08.712Z'),
  ('+16159654011', '2026-08-24T14:01:22.280Z', 'app_database_optout replied_stop_bare_keyword twilio_21610_unsubscribed', '2026-08-24T14:01:25.000Z send refused: 21610 | 2026-08-24T14:01:23.000Z replied "stop" (matched "stop") | recorded in the app at 2026-08-24T14:01:22.280Z'),
  ('+16789057925', '2026-08-22T14:03:21.468Z', 'app_database_optout replied_stop_bare_keyword twilio_21610_unsubscribed', '2026-08-22T14:11:31.000Z send refused: 21610 | 2026-08-22T14:11:30.000Z replied "Stop" (matched "stop") | recorded in the app at 2026-08-22T14:03:21.468Z'),
  ('+17042538647', '2026-08-14T14:18:10.000Z', 'app_database_optout replied_stop_bare_keyword twilio_21610_unsubscribed', '2026-08-14T14:18:11.000Z send refused: 21610 | 2026-08-14T14:18:10.000Z replied "stop" (matched "stop") | recorded in the app at 2026-08-14T14:18:10.531Z'),
  ('+17047363746', '2026-09-21T13:00:43.562Z', 'app_database_optout', 'recorded in the app at 2026-09-21T13:00:43.562Z'),
  ('+18037103976', '2026-09-17T14:01:18.548Z', 'app_database_optout replied_stop_bare_keyword', '2026-09-17T14:01:19.000Z replied "STOP Reply STOP to unsubscribe." (matched "stop") | recorded in the app at 2026-09-17T14:01:18.548Z'),
  ('+18042067000', '2026-08-21T14:04:21.000Z', 'app_database_optout replied_stop_bare_keyword', '2026-08-21T14:04:21.000Z replied "STOP Reply STOP to unsubscribe" (matched "stop") | recorded in the app at 2026-08-21T14:04:21.454Z'),
  ('+18042396790', '2026-09-23T21:26:02.000Z', 'app_database_optout replied_stop_bare_keyword twilio_21610_unsubscribed', '2026-09-23T21:26:04.000Z send refused: 21610 | 2026-09-23T21:26:02.000Z replied "Stop" (matched "stop") | recorded in the app at 2026-09-23T21:26:02.441Z'),
  ('+18044414309', '2026-08-25T16:09:12.000Z', 'app_database_optout replied_stop_bare_keyword twilio_21610_unsubscribed', '2026-08-25T16:09:14.000Z send refused: 21610 | 2026-08-25T16:09:12.000Z replied "STOP " (matched "stop") | recorded in the app at 2026-08-25T16:09:12.633Z'),
  ('+18049011936', '2026-09-02T17:22:00.000Z', 'app_database_optout replied_stop_bare_keyword twilio_21610_unsubscribed', '2026-09-02T17:22:01.000Z send refused: 21610 | 2026-09-02T17:22:00.000Z replied "STOP" (matched "stop") | recorded in the app at 2026-09-02T17:22:00.316Z'),
  ('+18142186140', '2026-06-30T11:41:32.000Z', 'replied_stop_bare_keyword', '2026-06-30T11:41:32.000Z replied "Cancel" (matched "cancel")'),
  ('+18282646660', '2026-08-11T19:06:44.000Z', 'app_database_optout replied_stop_bare_keyword', '2026-08-11T19:06:44.000Z replied "stop Reply STOP to unsubscribe" (matched "stop") | recorded in the app at 2026-08-11T19:06:44.180Z'),
  ('+18437695355', '2026-09-08T20:51:41.000Z', 'app_database_optout replied_stop_bare_keyword twilio_21610_unsubscribed', '2026-09-08T20:51:43.000Z send refused: 21610 | 2026-09-08T20:51:41.000Z replied "STOP" (matched "stop") | recorded in the app at 2026-09-08T20:51:41.027Z'),
  ('+18447570083', '2026-09-01T16:41:38.187Z', 'app_database_optout', 'recorded in the app at 2026-09-01T16:41:38.187Z'),
  ('+19047177127', '2026-08-29T14:22:42.000Z', 'app_database_optout replied_stop_bare_keyword twilio_21610_unsubscribed', '2026-08-29T14:22:44.000Z send refused: 21610 | 2026-08-29T14:22:42.000Z replied "Stop" (matched "stop") | recorded in the app at 2026-08-29T14:22:42.113Z'),
  ('+19198582318', '2026-08-31T13:00:53.572Z', 'app_database_optout', 'recorded in the app at 2026-08-31T13:00:53.572Z'),
  ('+19432267057', '2026-08-21T13:02:15.000Z', 'app_database_optout replied_stop_bare_keyword', '2026-08-21T13:02:15.000Z replied "No soliciting" (matched "no soliciting") | recorded in the app at 2026-08-21T13:02:15.072Z'),
  ('+19803516626', '2026-08-20T17:15:37.998Z', 'app_database_optout replied_stop_bare_keyword twilio_21610_unsubscribed', '2026-08-20T17:15:54.000Z send refused: 21610 | 2026-08-20T17:15:40.000Z send refused: 21610 | 2026-08-20T17:15:38.000Z replied "STOP" (matched "stop") | recorded in the app at 2026-08-20T17:15:37.998Z'),
  ('+19805808045', '2026-08-14T14:11:12.000Z', 'app_database_optout replied_stop_bare_keyword twilio_21610_unsubscribed', '2026-08-14T14:11:14.000Z send refused: 21610 | 2026-08-14T14:11:12.000Z replied "STOP" (matched "stop") | recorded in the app at 2026-08-14T14:11:12.280Z'),
  ('+19808334665', '2026-08-17T16:32:24.903Z', 'app_database_optout replied_stop_bare_keyword twilio_21610_unsubscribed', '2026-08-17T16:32:26.000Z send refused: 21610 | 2026-08-17T16:32:25.000Z replied "Stop" (matched "stop") | recorded in the app at 2026-08-17T16:32:24.903Z')
ON CONFLICT (phone) DO NOTHING;

-- -----------------------------------------------------------------------------
-- sms_send_log - what the frequency cap counts
-- -----------------------------------------------------------------------------
--
-- The 36-message number was reached one text at a time, by a daily job, with nothing
-- anywhere counting how many had already gone. A cap needs a count, and a count needs
-- a row per send.
--
-- This is NOT a replacement for Twilio's own history, which stays the authoritative
-- record. It exists so the guard can answer "how many has this number had this week"
-- without an API call on the send path.
CREATE TABLE IF NOT EXISTS public.sms_send_log (
  id         UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  phone      TEXT        NOT NULL,
  -- What kind of message: 'booking_confirmation', 'appointment_reminder',
  -- 'invoice_sent', and so on. Makes it possible to see at a glance whether a spike is
  -- transactional or something that should not be running at all.
  kind       TEXT        NOT NULL,
  twilio_sid TEXT,
  sent_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS sms_send_log_phone_time_idx
  ON public.sms_send_log (phone, sent_at DESC);

COMMENT ON TABLE public.sms_send_log IS
  'One row per outbound SMS, written by the send guard so a per-number frequency cap can be enforced. Append only. Do not delete rows: with Twilio history this is the evidence of what was sent to whom and when.';

-- -----------------------------------------------------------------------------
-- Row level security
-- -----------------------------------------------------------------------------
ALTER TABLE public.do_not_contact ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.sms_send_log   ENABLE ROW LEVEL SECURITY;

-- No policy at all on sms_send_log: service role only. It is an audit trail, and no
-- subscriber has a reason to read or alter other people's message history.

-- Readable by any signed-in user so the application can check it. Deliberately NO
-- insert, update or delete policy: writes go through the service role. A subscriber
-- must not be able to delete someone else's opt-out.
DROP POLICY IF EXISTS "Authenticated read do_not_contact" ON public.do_not_contact;
CREATE POLICY "Authenticated read do_not_contact"
  ON public.do_not_contact FOR SELECT TO authenticated USING (true);

-- -----------------------------------------------------------------------------
-- Check it
-- -----------------------------------------------------------------------------
-- Expect 32, and 0.
SELECT (SELECT count(*) FROM public.do_not_contact) AS do_not_contact_rows,
       (SELECT count(*) FROM public.sms_send_log)   AS sms_send_log_rows;

-- Expect zero rows: every phone must be E.164.
SELECT phone FROM public.do_not_contact WHERE phone !~ '^\+[1-9][0-9]{9,14}$';

-- Expect zero rows: nothing in the old opt-out tables should be missing from here.
SELECT o.phone, 'directory_optouts' AS missing_from_dnc
FROM   public.directory_optouts o
WHERE  NOT EXISTS (SELECT 1 FROM public.do_not_contact d WHERE d.phone = o.phone)
UNION ALL
SELECT o.phone, 'hd_directory_optouts'
FROM   public.hd_directory_optouts o
WHERE  NOT EXISTS (SELECT 1 FROM public.do_not_contact d WHERE d.phone = o.phone);

-- Expect two rows: do_not_contact and sms_send_log.
SELECT table_name FROM information_schema.tables
WHERE table_schema = 'public' AND table_name IN ('do_not_contact', 'sms_send_log')
ORDER BY table_name;

-- How each row got here.
SELECT reason, count(*) AS rows
FROM   public.do_not_contact
GROUP  BY reason
ORDER  BY rows DESC;

-- The oldest and newest opt-out, so the span is on the record.
SELECT min(opted_out_at) AS earliest, max(opted_out_at) AS latest
FROM   public.do_not_contact;

COMMIT;
