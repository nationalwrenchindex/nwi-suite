-- ─── 139. Recover the addresses that were typed but never kept ────────────────
--
-- WHY THIS EXISTS
-- The HD quote and invoice forms have always collected a full service address, and
-- the customer pickers on those forms have always tried to prefill one. What was
-- missing in between is that nothing ever wrote an address ONTO a customer:
-- logHDCustomer() saved name, phone, email and company and silently dropped the five
-- address columns. So the prefill read empty columns and the tech retyped an address
-- the shop already had. The "type the whole address" paste box made that survivable,
-- which is why it went unnoticed for months.
--
-- The code fix stops the loss going forward. This migration recovers what was already
-- lost: at the time of writing, 10 of 12 hd_invoices carry an address while only 12 of
-- 48 customers do, and 5 customers can be given an address they had already provided.
--
-- SAFETY
--   * Only fills customers whose address_line1 IS NULL. An address already on a
--     customer is never overwritten -- that record is the more trustworthy one,
--     because someone maintained it deliberately.
--   * Only reads invoices that actually carry an address_line1.
--   * Takes the MOST RECENT such invoice per customer, so a customer who moved gets
--     the address they most recently gave.
--   * Copies verbatim. Some of these were pasted whole into line 1 with the city
--     repeated; that is what the tech typed, and silently re-parsing it here would
--     change a record nobody asked us to change. It is editable in the UI.
--
-- hd_quotes is deliberately NOT a source: that table has no customer_id column, so
-- there is no reliable link from a quote back to the customers row.

WITH latest AS (
  SELECT DISTINCT ON (i.customer_id)
         i.customer_id,
         i.address_line1,
         i.address_line2,
         i.city,
         i.state,
         i.zip
    FROM public.hd_invoices i
   WHERE i.customer_id   IS NOT NULL
     AND i.address_line1 IS NOT NULL
     AND btrim(i.address_line1) <> ''
   ORDER BY i.customer_id, i.created_at DESC
)
UPDATE public.customers c
   SET address_line1 = latest.address_line1,
       address_line2 = COALESCE(latest.address_line2, c.address_line2),
       city          = COALESCE(latest.city,          c.city),
       state         = COALESCE(latest.state,         c.state),
       zip           = COALESCE(latest.zip,           c.zip),
       updated_at    = now()
  FROM latest
 WHERE c.id = latest.customer_id
   AND (c.address_line1 IS NULL OR btrim(c.address_line1) = '');
