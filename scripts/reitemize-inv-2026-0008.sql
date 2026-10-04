-- +===========================================================================+
-- | OPTIONAL - re-itemize INV-2026-0008 from the segments that still hold the  |
-- | truth, so the part number and the line type appear on it                   |
-- +===========================================================================+
--
-- NOT RUN BY ME. This UPDATES a stored invoice's line_items.
--
-- -- WHY THIS NEEDS SQL AT ALL ------------------------------------------------
--
-- The converter now carries part_number, type and the segment onto every invoice
-- line, so any work order converted from here on is itemized correctly.
--
-- INV-2026-0008 was converted BEFORE that, and what it stored is:
--
--   {"total":52,"quantity":1,"unit_price":52,"description":"Segment 1 - test part"}
--   {"total":95,"quantity":1,"unit_price":95,"description":"Segment 2 - testing"}
--
-- The document now parses that "Segment 1 - " prefix, so the invoice already
-- GROUPS correctly without touching the data. But the part number 123456 is not in
-- there to be parsed - it was dropped at conversion, and presentation cannot invent
-- it. Only a write puts it back, and billed history only gets rewritten knowingly.
--
-- -- WHY IT IS SCOPED BY NAME AND NOT A BACKFILL ------------------------------
--
-- invoices has NO source_work_order_id. It records source = 'work_order' and
-- nothing else, so there is no key joining an invoice back to the work order it
-- came from. Matching on customer and totals would be guessing, and guessing
-- another job's parts onto this invoice is worse than a missing part number.
--
-- So this names both documents as literals. If there are others to fix, copy the
-- block and change the two names. Do not try to make it general.
--
-- -- THE GUARD ----------------------------------------------------------------
--
-- The UPDATE only fires when the rebuilt lines sum to the subtotal ALREADY stored
-- on the invoice. That money was verified by hand: 52 parts, 95 labor, subtotal
-- 147.00. If the rebuilt lines do not come to exactly that, this is not the job
-- the invoice bills and nothing is written.

BEGIN;

-- -----------------------------------------------------------------------------
-- STEP 1 - what is stored now. Keep this output.
-- -----------------------------------------------------------------------------
SELECT invoice_number,
       subtotal,
       tax_amount,
       total,
       jsonb_pretty(line_items) AS line_items_now
FROM   public.invoices
WHERE  invoice_number = 'INV-2026-0008';

-- -----------------------------------------------------------------------------
-- STEP 2 - what the segments say it should be, and whether the money agrees
-- -----------------------------------------------------------------------------
WITH wo AS (
  SELECT id
  FROM   public.work_orders
  WHERE  work_order_number = 'WO-2026-0008'
),
seg AS (
  SELECT s.sequence AS seq, s.complaint, s.line_items
  FROM   public.work_order_segments s
  JOIN   wo ON wo.id = s.ld_work_order_id
  -- Only what the customer agreed to pay for. A declined segment is not billed.
  WHERE  s.status IN ('authorized', 'complete')
),
lines AS (
  SELECT seg.seq, seg.complaint, e.elem, e.ord
  FROM   seg,
         LATERAL jsonb_array_elements(COALESCE(seg.line_items, '[]'::jsonb))
                 WITH ORDINALITY AS e(elem, ord)
),
built AS (
  SELECT jsonb_agg(
           jsonb_build_object(
             'description',   COALESCE(NULLIF(trim(elem->>'description'), ''), 'Service'),
             'quantity',      COALESCE((elem->>'quantity')::numeric,   0),
             'unit_price',    COALESCE((elem->>'unit_price')::numeric, 0),
             'total',         COALESCE((elem->>'total')::numeric,      0),
             -- 'part' singular is the segment vocabulary; invoice lines use 'parts'.
             'type',          CASE WHEN elem->>'type' = 'labor' THEN 'labor' ELSE 'parts' END,
             -- Only a part has one, and an empty string is not a part number.
             'part_number',   CASE WHEN elem->>'type' = 'labor'
                                   THEN NULL
                                   ELSE NULLIF(trim(elem->>'part_number'), '') END,
             'segment',       seq,
             'segment_label', NULLIF(trim(complaint), '')
           )
           -- The order the shop billed them in, not re-sorted.
           ORDER BY seq, COALESCE((elem->>'sort_order')::int, ord::int)
         )                                                  AS items,
         SUM(COALESCE((elem->>'total')::numeric, 0))        AS lines_total,
         count(*)                                           AS line_count
  FROM   lines
)
SELECT b.line_count,
       b.lines_total,
       i.subtotal                   AS invoice_subtotal,
       (b.lines_total = i.subtotal) AS money_agrees,
       jsonb_pretty(b.items)        AS line_items_rebuilt
FROM   built b
CROSS  JOIN public.invoices i
WHERE  i.invoice_number = 'INV-2026-0008';

-- -----------------------------------------------------------------------------
-- STEP 3 - the write. Fires only if money_agrees was true above.
-- -----------------------------------------------------------------------------
WITH wo AS (
  SELECT id
  FROM   public.work_orders
  WHERE  work_order_number = 'WO-2026-0008'
),
seg AS (
  SELECT s.sequence AS seq, s.complaint, s.line_items
  FROM   public.work_order_segments s
  JOIN   wo ON wo.id = s.ld_work_order_id
  WHERE  s.status IN ('authorized', 'complete')
),
lines AS (
  SELECT seg.seq, seg.complaint, e.elem, e.ord
  FROM   seg,
         LATERAL jsonb_array_elements(COALESCE(seg.line_items, '[]'::jsonb))
                 WITH ORDINALITY AS e(elem, ord)
),
built AS (
  SELECT jsonb_agg(
           jsonb_build_object(
             'description',   COALESCE(NULLIF(trim(elem->>'description'), ''), 'Service'),
             'quantity',      COALESCE((elem->>'quantity')::numeric,   0),
             'unit_price',    COALESCE((elem->>'unit_price')::numeric, 0),
             'total',         COALESCE((elem->>'total')::numeric,      0),
             'type',          CASE WHEN elem->>'type' = 'labor' THEN 'labor' ELSE 'parts' END,
             'part_number',   CASE WHEN elem->>'type' = 'labor'
                                   THEN NULL
                                   ELSE NULLIF(trim(elem->>'part_number'), '') END,
             'segment',       seq,
             'segment_label', NULLIF(trim(complaint), '')
           )
           ORDER BY seq, COALESCE((elem->>'sort_order')::int, ord::int)
         )                                            AS items,
         SUM(COALESCE((elem->>'total')::numeric, 0))  AS lines_total
  FROM   lines
)
UPDATE public.invoices i
SET    line_items = b.items,
       updated_at = now()
FROM   built b
WHERE  i.invoice_number = 'INV-2026-0008'
  AND  b.items IS NOT NULL
  -- The money must not move. This is the whole safety of the script.
  AND  b.lines_total = i.subtotal;

-- -----------------------------------------------------------------------------
-- STEP 4 - confirm. The money must be identical to STEP 1, and every parts line
-- must now carry a part number.
-- -----------------------------------------------------------------------------
SELECT invoice_number,
       subtotal,
       tax_amount,
       total,
       jsonb_array_length(line_items) AS lines,
       (SELECT count(*) FROM jsonb_array_elements(line_items) l
         WHERE l->>'type' = 'parts'
           AND COALESCE(l->>'part_number', '') <> '')   AS parts_with_number,
       (SELECT count(*) FROM jsonb_array_elements(line_items) l
         WHERE COALESCE(l->>'segment', '') <> '')       AS lines_with_segment,
       jsonb_pretty(line_items)                         AS line_items_after
FROM   public.invoices
WHERE  invoice_number = 'INV-2026-0008';

-- Expect: subtotal 147.00, tax 11.39, total 158.39 - UNCHANGED from step 1.
--         lines 2, parts_with_number 1, lines_with_segment 2.
--
-- If that reads right:
--   COMMIT;
-- Otherwise:
--   ROLLBACK;
ROLLBACK;  -- <= change to COMMIT when the checks above look right
