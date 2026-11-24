-- 193_hd_work_order_number_floor.sql
--
-- WHAT THIS IS FOR. Settings > Document numbers lets a shop set the NEXT number for
-- its HD invoices, quotes and work orders (a new shop should not have to start its
-- customers at 0001). Invoices and quotes already number from
-- public.hd_document_counters (migration 186), so the setting only raises their
-- counter row and needs nothing from this file.
--
-- HD work orders do not use that counter: the app numbers them as the highest
-- WO-YYYY-NNNN the account holds plus one (src/lib/work-order-number.ts). To honour a
-- starting number, the app also reads a FLOOR for the account from
-- hd_document_counters, doc_type 'hd_work_order', and numbers above whichever is
-- higher. The table's CHECK allows only 'hd_invoice' and 'hd_quote', so a work order
-- floor cannot be saved until this widens it.
--
-- WHAT THIS DOES. Replaces the doc_type CHECK on hd_document_counters with one that
-- also allows 'hd_work_order'. Nothing else: no row is written, no number changes,
-- no policy or grant changes. hd_take_document_number (the invoice and quote
-- trigger function) is not touched and still refuses any other type.
--
-- Before this is applied, saving the work order field in Settings answers with
-- "needs migration 193" and saves nothing; the invoice and quote fields work.
--
-- Preview and production share one database. Applying this applies it to both.
-- Plain ASCII. Armed with COMMIT.

BEGIN;

DO $$
DECLARE
  c record;
BEGIN
  FOR c IN
    SELECT conname
      FROM pg_constraint
     WHERE conrelid = 'public.hd_document_counters'::regclass
       AND contype = 'c'
       AND pg_get_constraintdef(oid) ILIKE '%doc_type%'
  LOOP
    EXECUTE format('ALTER TABLE public.hd_document_counters DROP CONSTRAINT %I', c.conname);
  END LOOP;
END $$;

ALTER TABLE public.hd_document_counters
  ADD CONSTRAINT hd_document_counters_doc_type_check
  CHECK (doc_type IN ('hd_invoice', 'hd_quote', 'hd_work_order'));

-- Self-check.
DO $$
DECLARE
  defs text;
  n    integer;
BEGIN
  SELECT count(*), string_agg(pg_get_constraintdef(oid), ' | ')
    INTO n, defs
    FROM pg_constraint
   WHERE conrelid = 'public.hd_document_counters'::regclass
     AND contype = 'c'
     AND pg_get_constraintdef(oid) ILIKE '%doc_type%';
  IF n <> 1 THEN
    RAISE EXCEPTION '193: expected exactly one doc_type check, found % (%)', n, defs;
  END IF;
  IF defs NOT ILIKE '%hd_work_order%' OR defs NOT ILIKE '%hd_invoice%' OR defs NOT ILIKE '%hd_quote%' THEN
    RAISE EXCEPTION '193: the doc_type check does not allow all three types: %', defs;
  END IF;

  -- The counter table is still closed to the browser keys.
  IF has_table_privilege('anon', 'public.hd_document_counters', 'SELECT')
     OR has_table_privilege('authenticated', 'public.hd_document_counters', 'SELECT')
     OR has_table_privilege('anon', 'public.hd_document_counters', 'INSERT')
     OR has_table_privilege('authenticated', 'public.hd_document_counters', 'INSERT') THEN
    RAISE EXCEPTION '193: hd_document_counters is readable or writable by anon or authenticated';
  END IF;

  -- No row was added or changed by this migration.
  IF EXISTS (SELECT 1 FROM public.hd_document_counters WHERE doc_type = 'hd_work_order') THEN
    RAISE EXCEPTION '193: an hd_work_order row exists already - this migration writes none';
  END IF;

  RAISE NOTICE '193 ok: hd_document_counters accepts hd_work_order; % counter row(s) untouched',
    (SELECT count(*) FROM public.hd_document_counters);
END $$;

COMMIT;
