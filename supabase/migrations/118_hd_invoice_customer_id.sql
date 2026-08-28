-- Migration 118: link hd_invoices to a customers row.
--
-- hd_invoices has stored customer_name / customer_phone / customer_email as
-- denormalized TEXT since 057, with no reference to the customers table. That was
-- workable until contact suppression (117) arrived: no_sms / no_email live on a
-- customers row, so a sender holding only a phone string has nothing to look the
-- flags up by. The HD invoice SMS and the late-fee cron were therefore ungated —
-- a customer who asked not to be texted would still be texted by both.
--
-- ON DELETE SET NULL, never CASCADE: deleting a contact record must not take the
-- invoice with it. The invoice is a financial document with its own retention life;
-- the customer row is a convenience.

ALTER TABLE public.hd_invoices
  ADD COLUMN IF NOT EXISTS customer_id UUID REFERENCES public.customers(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_hd_invoices_customer
  ON public.hd_invoices (customer_id)
  WHERE customer_id IS NOT NULL;


-- ── Backfill ─────────────────────────────────────────────────────────────────
-- Reconciles against customers the same way src/lib/hd/customer-logging.ts does:
-- scoped to the same owner, matched on normalized email first, then on the last ten
-- digits of the phone. Matching on trailing digits so "(863) 555-0100" reconciles
-- with "+18635550100".
--
-- Only unambiguous matches are written. Where two customer rows for the same owner
-- share a phone or an email, the invoice is left NULL rather than bound to whichever
-- row sorted first — a wrong link here would silently apply one person's do-not-
-- contact flag to another's invoice, or fail to apply it where it was set.

-- Pass 1: email, case-insensitive, exactly one match.
UPDATE public.hd_invoices i
SET    customer_id = c.id
FROM   public.customers c
WHERE  i.customer_id IS NULL
  AND  i.customer_email IS NOT NULL
  AND  btrim(i.customer_email) <> ''
  AND  c.user_id = i.user_id
  AND  lower(btrim(c.email)) = lower(btrim(i.customer_email))
  AND  (
         SELECT count(*) FROM public.customers c2
         WHERE  c2.user_id = i.user_id
           AND  c2.email IS NOT NULL
           AND  lower(btrim(c2.email)) = lower(btrim(i.customer_email))
       ) = 1;

-- Pass 2: phone, last ten digits, exactly one match.
UPDATE public.hd_invoices i
SET    customer_id = c.id
FROM   public.customers c
WHERE  i.customer_id IS NULL
  AND  i.customer_phone IS NOT NULL
  AND  length(regexp_replace(i.customer_phone, '[^0-9]', '', 'g')) >= 10
  AND  c.user_id = i.user_id
  AND  right(regexp_replace(c.phone, '[^0-9]', '', 'g'), 10)
     = right(regexp_replace(i.customer_phone, '[^0-9]', '', 'g'), 10)
  AND  (
         SELECT count(*) FROM public.customers c2
         WHERE  c2.user_id = i.user_id
           AND  c2.phone IS NOT NULL
           AND  right(regexp_replace(c2.phone, '[^0-9]', '', 'g'), 10)
              = right(regexp_replace(i.customer_phone, '[^0-9]', '', 'g'), 10)
       ) = 1;
