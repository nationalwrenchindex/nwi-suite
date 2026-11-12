-- duplicate-document-numbers-readonly.sql
--
-- READ ONLY. One SELECT, no writes. Lists every document number that is held by
-- more than one LIVE row in the same account, across HD and LD invoices, quotes and
-- work orders, with the account it belongs to and whether that account pays.
--
-- Numbering is per account (user_id), so a number repeated in two DIFFERENT
-- accounts is normal and is not listed. Rows with a NULL or blank number are
-- skipped.
--
-- paying_subscriber is true when the account has a subscription with status
-- 'active' or 'trialing' that is not comped. Read the email column before
-- deciding: the founder's own accounts are listed too.

WITH docs AS (
  SELECT 'hd_invoices'::text AS doc_table, user_id, invoice_number AS doc_number, id, created_at FROM public.hd_invoices
  UNION ALL
  SELECT 'hd_quotes',      user_id, quote_number,      id, created_at FROM public.hd_quotes
  UNION ALL
  SELECT 'hd_work_orders', user_id, work_order_number, id, created_at FROM public.hd_work_orders
  UNION ALL
  SELECT 'invoices',       user_id, invoice_number,    id, created_at FROM public.invoices
  UNION ALL
  SELECT 'quotes',         user_id, quote_number,      id, created_at FROM public.quotes
  UNION ALL
  SELECT 'work_orders',    user_id, work_order_number, id, created_at FROM public.work_orders
),
dups AS (
  SELECT doc_table, user_id, doc_number,
         count(*)                                   AS copies,
         array_agg(id ORDER BY created_at)          AS row_ids,
         array_agg(created_at ORDER BY created_at)  AS created
  FROM docs
  WHERE doc_number IS NOT NULL AND btrim(doc_number) <> ''
  GROUP BY doc_table, user_id, doc_number
  HAVING count(*) > 1
)
SELECT d.doc_table,
       d.doc_number,
       d.copies,
       d.user_id,
       p.email,
       p.business_name,
       EXISTS (
         SELECT 1 FROM public.subscriptions s
         WHERE s.user_id = d.user_id
           AND s.status IN ('active', 'trialing')
           AND COALESCE(s.is_comped, false) = false
       ) AS paying_subscriber,
       d.created,
       d.row_ids
FROM dups d
LEFT JOIN public.profiles p ON p.id = d.user_id
ORDER BY paying_subscriber DESC, d.doc_table, p.email, d.doc_number;
