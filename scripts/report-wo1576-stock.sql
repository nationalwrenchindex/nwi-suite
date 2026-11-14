-- report-wo1576-stock.sql
--
-- READ-ONLY. One SELECT, writes nothing. Run it in the Supabase SQL editor.
--
-- Every part on WO-2026-1576: what the work order bills, whether the part is in the
-- catalog (only catalog parts move stock), on hand now, how many the LIVE invoice
-- (INV-2026-0057) took, how many the two DELETED invoices (INV-2026-0055 and 0056)
-- took, and what on hand would be had the job been billed once.
--
-- Deleting an invoice puts nothing back: the ledger outlives the document, so 0055's
-- and 0056's movements are still here, and on hand still counts them.
--
-- Part numbers are matched the way the app matches them: upper case, everything but
-- letters and digits removed (for every number on this work order that is exactly
-- what normalizePartNumber gives).
--
-- To correct a count by hand, use the Inventory screen's count (a physical count
-- writes the DIFFERENCE as an 'adjusted' movement, so the ledger keeps the record).
-- Do not UPDATE inventory.on_hand: the migration 151 trigger refuses it.

WITH wo AS (
  SELECT id, user_id
  FROM public.hd_work_orders
  WHERE work_order_number = 'WO-2026-1576'
    AND user_id = '4a8c046f-7db3-42bb-8422-fd47efb7678c'
),
lines AS (
  SELECT li.part_number, sum(li.quantity) AS billed_qty
  FROM public.hd_work_order_line_items li
  JOIN wo ON li.work_order_id = wo.id
  WHERE lower(li.type) = 'part' AND coalesce(li.part_number, '') <> ''
  GROUP BY li.part_number
),
matched AS (
  SELECT l.part_number, l.billed_qty, p.id AS part_id
  FROM lines l
  LEFT JOIN public.parts p
    ON p.part_number_normalized = upper(regexp_replace(l.part_number, '[^A-Za-z0-9]', '', 'g'))
),
live AS (
  SELECT i.id FROM public.hd_invoices i JOIN wo ON i.work_order_id = wo.id
),
mv AS (
  SELECT m.part_id,
         sum(-m.delta) FILTER (WHERE m.source_id IN (SELECT id FROM live))      AS taken_by_live_invoice,
         sum(-m.delta) FILTER (WHERE m.source_id NOT IN (SELECT id FROM live))  AS taken_by_deleted_invoices,
         string_agg(DISTINCT m.source_ref, ', ')                                 AS invoices
  FROM public.stock_movement m
  JOIN wo ON m.user_id = wo.user_id
  WHERE m.source_type = 'hd_invoice'
    AND (m.source_id IN (SELECT id FROM live)
         OR m.source_ref IN ('INV-2026-0055', 'INV-2026-0056'))
  GROUP BY m.part_id
),
oh AS (
  SELECT inv.part_id, sum(inv.on_hand) AS on_hand
  FROM public.inventory inv
  JOIN wo ON inv.user_id = wo.user_id
  GROUP BY inv.part_id
)
SELECT
  m.part_number,
  m.billed_qty,
  CASE WHEN m.part_id IS NULL THEN 'NOT IN CATALOG - stock never moved' ELSE 'in catalog' END AS catalog,
  oh.on_hand                                                   AS on_hand_now,
  coalesce(mv.taken_by_live_invoice, 0)                        AS taken_by_live_invoice,
  coalesce(mv.taken_by_deleted_invoices, 0)                    AS taken_by_deleted_invoices,
  CASE WHEN m.part_id IS NULL THEN NULL
       ELSE coalesce(oh.on_hand, 0) + coalesce(mv.taken_by_deleted_invoices, 0) END AS on_hand_if_billed_once,
  mv.invoices
FROM matched m
LEFT JOIN mv ON mv.part_id = m.part_id
LEFT JOIN oh ON oh.part_id = m.part_id
ORDER BY (m.part_id IS NULL), m.part_number;
