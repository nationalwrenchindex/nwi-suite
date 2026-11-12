-- 186_hd_document_counters.sql
--
-- WHAT IS WRONG. HD invoice and HD quote numbers were "how many rows this account
-- has, plus one". A deleted row lowers the count, so the next save reuses a number
-- that is already printed on another document: INV-2026-0029 exists twice on the
-- founder account (Nov 6 and Nov 9). Two saves at the same moment read the same
-- count and take the same number. Nothing in the database stopped either.
--
-- Six places use that pattern, but they number only TWO sequences:
--   INV-YYYY-NNNN  /api/hd/invoices and the equipment, DOT, aerial and PM checklist
--                  inspection routes (each inspection bills an hd_invoices row)
--   Q-YYYY-NNNN    /api/hd/quotes
--
-- WHAT THIS DOES.
--   1. public.hd_document_counters: one row per account and document type, holding
--      the last number issued. It is only ever increased. Deleting a document does
--      not touch it, so a number is never issued twice.
--   2. A BEFORE INSERT trigger on hd_invoices and hd_quotes takes the next number
--      from the counter in the same database step as the insert. The counter row is
--      locked while it is taken, so two saves at the same moment get two numbers.
--      The trigger replaces any number in the app's own auto form (INV-YYYY-NNNN /
--      Q-YYYY-NNNN) or a NULL; the year the app sent is kept. Any other number (for
--      example the smoke suite's SMOKE-... rows) is left exactly as written.
--      Because the trigger does the numbering, the fix takes effect the moment this
--      is applied - the current code needs no deploy. Every route reads the number
--      back from the saved row, never from its own count.
--   3. Unique keys on hd_invoices (user_id, invoice_number) and hd_quotes (user_id,
--      quote_number), so a duplicate can never be saved again by any path.
--
-- SEEDING. Each account's counter starts at the highest number it already holds
-- (the NNNN part of INV-YYYY-NNNN, across all years), so the next number is above
-- every existing one and cannot collide with any of them. An account with no
-- counter row yet (a new signup) is seeded the same way on its first save.
--
-- The sequence runs across years, exactly as it does today: after INV-2026-0041
-- the first 2027 invoice is INV-2027-0042. It does not restart at 0001.
--
-- BEFORE RUNNING: clear the duplicates. The unique keys cannot be created while two
-- rows in one account share a number. scripts/sql/duplicate-document-numbers-
-- readonly.sql lists them. This migration checks first and stops with a count if
-- any are left - it does not renumber or delete anything.
--
-- Not covered here: hd_work_orders (max+1 with retry in code; its unique key is
-- migration 176) and the LD invoices/quotes paths.
--
-- Applied by hand in the Supabase SQL editor with COMMIT on Nov 12, 2026, after a
-- clean ROLLBACK dry run; confirmed by query. Ends in COMMIT as run.

BEGIN;

-- 0. Stop before anything is changed if duplicates remain.
DO $$
DECLARE
  inv_dups integer;
  q_dups   integer;
BEGIN
  SELECT count(*) INTO inv_dups FROM (
    SELECT user_id, invoice_number FROM public.hd_invoices
    GROUP BY user_id, invoice_number HAVING count(*) > 1) d;
  SELECT count(*) INTO q_dups FROM (
    SELECT user_id, quote_number FROM public.hd_quotes
    GROUP BY user_id, quote_number HAVING count(*) > 1) d;
  IF inv_dups > 0 OR q_dups > 0 THEN
    RAISE EXCEPTION '186: % duplicated HD invoice number(s) and % duplicated HD quote number(s) remain. Clear them first (scripts/sql/duplicate-document-numbers-readonly.sql). Nothing was changed.', inv_dups, q_dups;
  END IF;
END $$;

-- 1. The counter table. No one reads or writes it directly: only the trigger
--    function below (SECURITY DEFINER) touches it.
CREATE TABLE IF NOT EXISTS public.hd_document_counters (
  user_id     uuid        NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  doc_type    text        NOT NULL CHECK (doc_type IN ('hd_invoice', 'hd_quote')),
  last_number bigint      NOT NULL CHECK (last_number >= 0),
  updated_at  timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, doc_type)
);

ALTER TABLE public.hd_document_counters ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.hd_document_counters FROM anon, authenticated, PUBLIC;
GRANT ALL ON public.hd_document_counters TO service_role;

-- Seed every existing account from the highest number it already holds.
INSERT INTO public.hd_document_counters (user_id, doc_type, last_number)
SELECT user_id, 'hd_invoice',
       COALESCE(max(substring(invoice_number FROM '^INV-[0-9]{4}-([0-9]+)$')::bigint), 0)
FROM public.hd_invoices
WHERE user_id IS NOT NULL
GROUP BY user_id
ON CONFLICT (user_id, doc_type) DO UPDATE
  SET last_number = GREATEST(public.hd_document_counters.last_number, EXCLUDED.last_number);

INSERT INTO public.hd_document_counters (user_id, doc_type, last_number)
SELECT user_id, 'hd_quote',
       COALESCE(max(substring(quote_number FROM '^Q-[0-9]{4}-([0-9]+)$')::bigint), 0)
FROM public.hd_quotes
WHERE user_id IS NOT NULL
GROUP BY user_id
ON CONFLICT (user_id, doc_type) DO UPDATE
  SET last_number = GREATEST(public.hd_document_counters.last_number, EXCLUDED.last_number);

-- 2a. Take the next number for one account. Seeds a missing counter from the rows
--     the account already holds, then increments under a row lock.
CREATE OR REPLACE FUNCTION public.hd_take_document_number(p_user uuid, p_doc text)
RETURNS bigint
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  seed bigint;
  n    bigint;
BEGIN
  IF p_doc = 'hd_invoice' THEN
    SELECT COALESCE(max(substring(invoice_number FROM '^INV-[0-9]{4}-([0-9]+)$')::bigint), 0)
      INTO seed FROM public.hd_invoices WHERE user_id = p_user;
  ELSIF p_doc = 'hd_quote' THEN
    SELECT COALESCE(max(substring(quote_number FROM '^Q-[0-9]{4}-([0-9]+)$')::bigint), 0)
      INTO seed FROM public.hd_quotes WHERE user_id = p_user;
  ELSE
    RAISE EXCEPTION 'hd_take_document_number: unknown document type %', p_doc;
  END IF;

  INSERT INTO public.hd_document_counters (user_id, doc_type, last_number)
  VALUES (p_user, p_doc, seed)
  ON CONFLICT (user_id, doc_type) DO NOTHING;

  UPDATE public.hd_document_counters
     SET last_number = last_number + 1, updated_at = now()
   WHERE user_id = p_user AND doc_type = p_doc
  RETURNING last_number INTO n;

  RETURN n;
END $$;

REVOKE ALL ON FUNCTION public.hd_take_document_number(uuid, text) FROM PUBLIC, anon, authenticated;

-- 2b. The triggers.
CREATE OR REPLACE FUNCTION public.hd_invoices_assign_number()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  yr text;
BEGIN
  IF NEW.user_id IS NULL THEN
    RETURN NEW;
  END IF;
  IF NEW.invoice_number IS NULL OR NEW.invoice_number ~ '^INV-[0-9]{4}-[0-9]+$' THEN
    yr := COALESCE(substring(NEW.invoice_number FROM '^INV-([0-9]{4})-'), to_char(now(), 'YYYY'));
    NEW.invoice_number := 'INV-' || yr || '-' ||
      lpad(public.hd_take_document_number(NEW.user_id, 'hd_invoice')::text, 4, '0');
  END IF;
  RETURN NEW;
END $$;

CREATE OR REPLACE FUNCTION public.hd_quotes_assign_number()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  yr text;
BEGIN
  IF NEW.user_id IS NULL THEN
    RETURN NEW;
  END IF;
  IF NEW.quote_number IS NULL OR NEW.quote_number ~ '^Q-[0-9]{4}-[0-9]+$' THEN
    yr := COALESCE(substring(NEW.quote_number FROM '^Q-([0-9]{4})-'), to_char(now(), 'YYYY'));
    NEW.quote_number := 'Q-' || yr || '-' ||
      lpad(public.hd_take_document_number(NEW.user_id, 'hd_quote')::text, 4, '0');
  END IF;
  RETURN NEW;
END $$;

REVOKE ALL ON FUNCTION public.hd_invoices_assign_number() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.hd_quotes_assign_number()   FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS hd_invoices_assign_number ON public.hd_invoices;
CREATE TRIGGER hd_invoices_assign_number
  BEFORE INSERT ON public.hd_invoices
  FOR EACH ROW EXECUTE FUNCTION public.hd_invoices_assign_number();

DROP TRIGGER IF EXISTS hd_quotes_assign_number ON public.hd_quotes;
CREATE TRIGGER hd_quotes_assign_number
  BEFORE INSERT ON public.hd_quotes
  FOR EACH ROW EXECUTE FUNCTION public.hd_quotes_assign_number();

-- 3. The unique keys.
CREATE UNIQUE INDEX IF NOT EXISTS hd_invoices_user_invoice_number_key
  ON public.hd_invoices (user_id, invoice_number);
CREATE UNIQUE INDEX IF NOT EXISTS hd_quotes_user_quote_number_key
  ON public.hd_quotes (user_id, quote_number);

-- Self-check.
DO $$
DECLARE
  behind   integer;
  acct     uuid;
  before_n bigint;
  a        bigint;
  b        bigint;
BEGIN
  -- Both triggers and both keys exist.
  IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'hd_invoices_assign_number' AND NOT tgisinternal) THEN
    RAISE EXCEPTION '186: trigger hd_invoices_assign_number missing';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'hd_quotes_assign_number' AND NOT tgisinternal) THEN
    RAISE EXCEPTION '186: trigger hd_quotes_assign_number missing';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_indexes WHERE schemaname = 'public' AND indexname = 'hd_invoices_user_invoice_number_key') THEN
    RAISE EXCEPTION '186: unique key on hd_invoices missing';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_indexes WHERE schemaname = 'public' AND indexname = 'hd_quotes_user_quote_number_key') THEN
    RAISE EXCEPTION '186: unique key on hd_quotes missing';
  END IF;

  -- The counter table is closed to the browser keys.
  IF has_table_privilege('anon', 'public.hd_document_counters', 'SELECT')
     OR has_table_privilege('authenticated', 'public.hd_document_counters', 'SELECT') THEN
    RAISE EXCEPTION '186: hd_document_counters is readable by anon or authenticated';
  END IF;

  -- No account's counter is below a number it already holds.
  SELECT count(*) INTO behind FROM (
    SELECT i.user_id FROM public.hd_invoices i
    JOIN public.hd_document_counters c ON c.user_id = i.user_id AND c.doc_type = 'hd_invoice'
    GROUP BY i.user_id, c.last_number
    HAVING c.last_number < COALESCE(max(substring(i.invoice_number FROM '^INV-[0-9]{4}-([0-9]+)$')::bigint), 0)
    UNION ALL
    SELECT q.user_id FROM public.hd_quotes q
    JOIN public.hd_document_counters c ON c.user_id = q.user_id AND c.doc_type = 'hd_quote'
    GROUP BY q.user_id, c.last_number
    HAVING c.last_number < COALESCE(max(substring(q.quote_number FROM '^Q-[0-9]{4}-([0-9]+)$')::bigint), 0)
  ) x;
  IF behind > 0 THEN
    RAISE EXCEPTION '186: % counter(s) are below an existing number', behind;
  END IF;

  -- Taking a number twice gives two consecutive numbers above the seed. Run inside
  -- an inner block that is rolled back, so the test spends no real numbers even
  -- when this migration is armed with COMMIT.
  SELECT user_id INTO acct FROM public.hd_document_counters WHERE doc_type = 'hd_invoice' LIMIT 1;
  IF acct IS NOT NULL THEN
    SELECT last_number INTO before_n FROM public.hd_document_counters WHERE user_id = acct AND doc_type = 'hd_invoice';
    BEGIN
      a := public.hd_take_document_number(acct, 'hd_invoice');
      b := public.hd_take_document_number(acct, 'hd_invoice');
      IF a <> before_n + 1 OR b <> before_n + 2 THEN
        RAISE EXCEPTION '186: counter gave % then % after %', a, b, before_n;
      END IF;
      RAISE EXCEPTION USING ERRCODE = 'P0186', MESSAGE = 'self-test rollback';
    EXCEPTION WHEN SQLSTATE 'P0186' THEN
      NULL;
    END;
    IF (SELECT last_number FROM public.hd_document_counters WHERE user_id = acct AND doc_type = 'hd_invoice') <> before_n THEN
      RAISE EXCEPTION '186: the self-test spent a real number';
    END IF;
  END IF;

  RAISE NOTICE '186 ok: counters seeded for % account(s), triggers and unique keys in place, counter test passed',
    (SELECT count(DISTINCT user_id) FROM public.hd_document_counters);
END $$;

COMMIT;
