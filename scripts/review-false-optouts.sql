-- =============================================================================
-- Six opt-outs the app recorded from a false keyword match
-- =============================================================================
--
-- FOR EDWARD TO READ AND DECIDE, NUMBER BY NUMBER. I am not running it, and I am not
-- recommending you run all of it.
--
-- -- WHY THESE EXIST ---------------------------------------------------------
--
-- src/lib/directory-agent/reply.ts decides an opt-out like this:
--
--     keywords.some(k => new RegExp(`\b${k}\b`).test(text))
--     OPT_OUT_KEYWORDS = ['stop', 'no', 'unsubscribe', 'cancel', 'end', 'quit']
--
-- The keyword counts wherever it appears - including inside the opt-out instruction
-- that the SENDER'S OWN auto-responder appended to their reply. Replaying all 148
-- inbound replies through that rule and through one that strips the quoted instruction
-- first:
--
--     the app's rule says opt out ....... 37 replies
--     the corrected rule says opt out ... 27 replies
--     false positives ................... 10
--     MISSED opt-outs ................... 0
--
-- Zero missed is the important half: nobody who asked to be left alone is still being
-- texted. The error is all in the safe direction - people suppressed who did not ask
-- to be. Six of them are already written into the opt-out tables, out of 29 rows total.
--
-- -- CLEARING AN OPT-OUT MEANS TEXTING A REAL PERSON AGAIN -------------------
--
-- So each one is listed with what they actually said and my recommendation. Two of the
-- six I think you should LEAVE ALONE even though the match was technically wrong,
-- because the intent was not.
--
-- ENDS IN ROLLBACK, and STEP 2 is commented out line by line. Uncomment only the
-- numbers you decide on.

-- -----------------------------------------------------------------------------
-- STEP 1. The six, and what each one actually said.
-- -----------------------------------------------------------------------------
--
--   +14235928088  "yes Reply STOP to opt out."
--        THEY SAID YES. The footer their system appended is what matched. This is a
--        prospect who agreed to be listed and has been suppressed since 2026-09-01.
--        RECOMMEND CLEARING.
--
--   +17047363746  "Thanks for reaching out! One of our agents will get back with you
--                  soon. Reply "STOP" to opt-out."
--   +19198582318  the same auto-reply, same wording
--        A machine answered. No human expressed any intention either way, and the
--        business never saw our message. RECOMMEND CLEARING, then expect to reach a
--        human on the next attempt.
--
--   +18447570083  "Hi, this is John Romney Vice President with Franchise Creator, I
--                  would like to speak to the owner..."
--        INBOUND SALES SPAM at us, which happened to contain the word "unsubscribe".
--        Not a customer and not an opt-out. Clearing it is harmless; so is leaving it.
--        NO RECOMMENDATION - it does not matter.
--
--   +16789057925  "We don't work on the large reefer on tractor trailers. Ours are
--                  small units. Thanks for the offer"
--        A polite decline, not a revocation - BUT this number then sent a bare "Stop"
--        on 2026-08-22, and Twilio has since refused sends to it with 21610. They are
--        legitimately opted out on their own merit. LEAVE IT.
--
--   +19432267057  "No soliciting"
--        Caught only by the 'no' keyword, so technically a false match - but "no
--        soliciting" is a plain request not to be solicited. The app got this right by
--        accident. LEAVE IT. (My export now matches this phrase on its own merit, so
--        it stays on do-not-contact.csv either way.)
--
-- Read the rows as they stand:
SELECT 'directory_optouts' AS source, phone, opted_out_at
FROM   public.directory_optouts
WHERE  phone IN ('+14235928088', '+17047363746', '+19198582318', '+18447570083',
                 '+16789057925', '+19432267057')
UNION ALL
SELECT 'hd_directory_optouts', phone, opted_out_at
FROM   public.hd_directory_optouts
WHERE  phone IN ('+14235928088', '+17047363746', '+19198582318', '+18447570083',
                 '+16789057925', '+19432267057')
ORDER  BY phone, source;

-- And their prospect rows, so you can see what status they are sitting in.
SELECT 'directory_prospects' AS source, phone, business_name, status, contacted_at, responded_at
FROM   public.directory_prospects
WHERE  phone IN ('+14235928088', '+17047363746', '+19198582318', '+18447570083',
                 '+16789057925', '+19432267057')
UNION ALL
SELECT 'hd_directory_prospects', phone, business_name, status, contacted_at, responded_at
FROM   public.hd_directory_prospects
WHERE  phone IN ('+14235928088', '+17047363746', '+19198582318', '+18447570083',
                 '+16789057925', '+19432267057')
ORDER  BY phone, source;

BEGIN;

-- -----------------------------------------------------------------------------
-- STEP 2. Uncomment ONLY the numbers you have decided to clear.
-- -----------------------------------------------------------------------------
-- Every line is commented. Nothing below runs until you uncomment it.

-- The prospect who said YES:
-- DELETE FROM public.directory_optouts    WHERE phone = '+14235928088';
-- DELETE FROM public.hd_directory_optouts WHERE phone = '+14235928088';
-- UPDATE public.directory_prospects    SET status = 'yes' WHERE phone = '+14235928088' AND status = 'optout';
-- UPDATE public.hd_directory_prospects SET status = 'yes' WHERE phone = '+14235928088' AND status = 'optout';

-- The two auto-replies, back to 'contacted' so the follow-up can reach a human:
-- DELETE FROM public.directory_optouts    WHERE phone IN ('+17047363746', '+19198582318');
-- DELETE FROM public.hd_directory_optouts WHERE phone IN ('+17047363746', '+19198582318');
-- UPDATE public.directory_prospects    SET status = 'contacted' WHERE phone IN ('+17047363746', '+19198582318') AND status = 'optout';
-- UPDATE public.hd_directory_prospects SET status = 'contacted' WHERE phone IN ('+17047363746', '+19198582318') AND status = 'optout';

-- The inbound spam, if you want it out of the way:
-- DELETE FROM public.directory_optouts    WHERE phone = '+18447570083';
-- DELETE FROM public.hd_directory_optouts WHERE phone = '+18447570083';

-- +16789057925 and +19432267057 are deliberately absent from this step. They asked,
-- in their own words, not to be contacted. Do not clear them.

-- -----------------------------------------------------------------------------
-- STEP 3. Check what changed.
-- -----------------------------------------------------------------------------
-- Expect the two numbers you were told to leave alone to STILL be present.
SELECT 'directory_optouts' AS source, phone FROM public.directory_optouts
WHERE  phone IN ('+16789057925', '+19432267057')
UNION ALL
SELECT 'hd_directory_optouts', phone FROM public.hd_directory_optouts
WHERE  phone IN ('+16789057925', '+19432267057')
ORDER  BY phone;

-- Expect 29 before any deletion, and 29 minus whatever you uncommented after.
SELECT (SELECT count(*) FROM public.directory_optouts)    AS ld_optouts,
       (SELECT count(*) FROM public.hd_directory_optouts) AS hd_optouts;

-- -----------------------------------------------------------------------------
-- Read STEP 1, uncomment what you decide on, then change this to COMMIT.
-- -----------------------------------------------------------------------------
ROLLBACK;
