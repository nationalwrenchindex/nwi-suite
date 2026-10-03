-- ╔═══════════════════════════════════════════════════════════════════════════╗
-- ║ OPTIONAL — link the 5 existing hd_quotes back to their customers           ║
-- ╚═══════════════════════════════════════════════════════════════════════════╝
--
-- BIG RUN THREE item 7c. NOT RUN BY ME. This is an UPDATE to existing rows.
--
-- REQUIRES MIGRATION 142 FIRST (it adds hd_quotes.customer_id).
--
-- WHAT THE AUDIT FOUND, against production:
--
--   Q-2026-0001  "McGee Way Transport"  336-817-1410   -> matched by EMAIL
--   Q-2026-0004  "Trailer Source"       336-661-7858   -> matched by EMAIL
--   Q-2026-0005  "Brock Fleeman"        7432167142     -> matched by PHONE
--   Q-2026-0002  "Darryl Lawson"        3368171410     -> NO MATCH
--   Q-2026-0003  "test"                 3363363366     -> NO MATCH
--
-- 3 of 5 linkable. The two that are not have no customers row with a matching
-- phone, email or name, and are left NULL — guessing a customer onto a quote is
-- how a quote ends up attached to the wrong person's history.
--
-- Note Q-2026-0002 "Darryl Lawson" carries the SAME phone digits as Q-2026-0001
-- "McGee Way Transport" (3368171410). That is a person at a company, and which
-- customer row it should point at is a judgement call, not a match. Left alone.
--
-- MATCHING ORDER IS PHONE, THEN EMAIL, THEN EXACT NAME, and it never falls
-- through to a fuzzy name. Each statement is scoped to one user_id so a match can
-- never cross between subscribers.

BEGIN;

-- ── 1. By phone (last 10 digits) ────────────────────────────────────────────
UPDATE public.hd_quotes q
SET    customer_id = c.id
FROM   public.customers c
WHERE  q.customer_id IS NULL
  AND  c.user_id = q.user_id
  AND  length(regexp_replace(COALESCE(q.customer_phone, ''), '\D', '', 'g')) >= 10
  AND  right(regexp_replace(COALESCE(q.customer_phone, ''), '\D', '', 'g'), 10)
     = right(regexp_replace(COALESCE(c.phone,            ''), '\D', '', 'g'), 10);

-- ── 2. By email, for whatever is still unlinked ──────────────────────────────
UPDATE public.hd_quotes q
SET    customer_id = c.id
FROM   public.customers c
WHERE  q.customer_id IS NULL
  AND  c.user_id = q.user_id
  AND  COALESCE(NULLIF(trim(q.customer_email), ''), '~none~') = lower(trim(c.email));

-- ── 3. By EXACT name, first/last or company. No fuzzy matching. ──────────────
UPDATE public.hd_quotes q
SET    customer_id = c.id
FROM   public.customers c
WHERE  q.customer_id IS NULL
  AND  c.user_id = q.user_id
  AND  lower(trim(q.customer_name)) IN (
         lower(trim(COALESCE(c.first_name, '') || ' ' || COALESCE(c.last_name, ''))),
         lower(trim(COALESCE(c.company_name, '')))
       )
  AND  length(trim(q.customer_name)) > 2;   -- "test" is not a name

-- ── Check it before committing ───────────────────────────────────────────────
-- Expect: 3 linked, 2 still NULL (Q-2026-0002 and Q-2026-0003).
SELECT quote_number,
       customer_name,
       customer_id,
       CASE WHEN customer_id IS NULL THEN 'still unlinked' ELSE 'linked' END AS result
FROM   public.hd_quotes
ORDER  BY quote_number;

-- If that reads as expected:
--   COMMIT;
-- If it does not:
--   ROLLBACK;
ROLLBACK;  -- <= change to COMMIT when the SELECT above looks right
