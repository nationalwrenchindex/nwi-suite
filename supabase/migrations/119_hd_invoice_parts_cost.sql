-- Migration 119: cost of goods and margin tracking on HD invoices.
--
-- hd_invoices has carried subtotal_parts since 057, but that number is parts
-- REVENUE — what the customer was billed — not what the tech paid. There was no
-- column anywhere holding the tech's cost, so the HD suite could report what came
-- in and never what it cost to earn it. Gross margin was simply not computable.
--
-- The cost data itself already exists, but only inside the line_items JSONB. The
-- HD invoice and quote forms write two additive keys on every parts row:
--   unit_cost       the SELL price per unit (what the customer is charged)
--   unit_cost_base  the tech's COST per unit (what they paid)
--   markup_percent  the rate applied to get from one to the other
-- Reading margin out of JSONB on every dashboard load is both slow and fragile,
-- so the two dollar figures are lifted onto real columns and written at invoice
-- save time by src/lib/hd/invoice-costing.ts.
--
-- ── WHY NULLABLE WITH NO DEFAULT ─────────────────────────────────────────────
-- These columns are deliberately NULL-able and deliberately NOT `DEFAULT 0`, and
-- that distinction is the entire point of this migration.
--
--   NULL = "we do not know what these parts cost."
--   0    = "these parts were free."
--
-- Every invoice written before markup tracking existed is the first case. If the
-- columns defaulted to 0, each of those historical invoices would report its full
-- parts revenue as pure profit, and the suite would show a gross margin near 100%
-- on the oldest data a subscriber has. A subscriber prices their work off this
-- number. Reporting "unknown" is honest; reporting 100% is a lie that costs them
-- money. Every consumer of these columns must carry the NULL through as unknown
-- rather than coalescing it to zero.

ALTER TABLE public.hd_invoices
  ADD COLUMN IF NOT EXISTS parts_cost NUMERIC(10,2),
  ADD COLUMN IF NOT EXISTS parts_sell NUMERIC(10,2);

COMMENT ON COLUMN public.hd_invoices.parts_cost IS
  'Total tech cost of parts on this invoice (sum of quantity * unit_cost_base). NULL means the cost is unknown for at least one parts line — never coalesce to 0, that would report the parts as free and inflate gross margin.';

COMMENT ON COLUMN public.hd_invoices.parts_sell IS
  'Total parts revenue on this invoice (sum of quantity * unit_cost, the sell price). Mirrors subtotal_parts; kept separately so cost and sell always come from the same computation.';

-- The financials summary scans one owner's invoices over a created_at window.
-- idx_hd_invoices_user (057) covers only user_id, which leaves the date bound as a
-- filter over every invoice the subscriber has ever written.
CREATE INDEX IF NOT EXISTS idx_hd_invoices_user_created
  ON public.hd_invoices (user_id, created_at DESC);


-- ── Backfill ─────────────────────────────────────────────────────────────────
-- Recovers cost from line_items for the invoices where it is fully recorded.
--
-- THE ALL-OR-NOTHING RULE: an invoice gets a parts_cost only when EVERY parts row
-- on it carries a usable unit_cost_base. If even one row is missing it, the whole
-- invoice stays NULL. Summing just the rows we happen to know would produce a cost
-- that is too low, and therefore a gross margin that is too high, presented with no
-- indication that anything was missing. A partial sum is worse than an admitted gap:
-- the gap is visible and the bad number is not.
--
-- Values are pulled through a numeric regex guard rather than cast blindly. A single
-- malformed JSON value (an empty string, a stray unit) would otherwise abort the
-- entire migration; here it simply reads as unknown and the invoice stays NULL.

WITH parts_rows AS (
  SELECT
    inv.id AS invoice_id,
    CASE WHEN li->>'quantity'       ~ '^-?[0-9]+(\.[0-9]+)?$' THEN (li->>'quantity')::numeric       END AS qty,
    CASE WHEN li->>'unit_cost_base' ~ '^-?[0-9]+(\.[0-9]+)?$' THEN (li->>'unit_cost_base')::numeric END AS unit_cost_base,
    CASE WHEN li->>'unit_cost'      ~ '^-?[0-9]+(\.[0-9]+)?$' THEN (li->>'unit_cost')::numeric      END AS unit_cost,
    CASE WHEN li->>'amount'         ~ '^-?[0-9]+(\.[0-9]+)?$' THEN (li->>'amount')::numeric         END AS amount
  FROM public.hd_invoices inv
  -- The array guard lives INSIDE the lateral, not in the WHERE: the set-returning
  -- function is evaluated before the WHERE filters anything, so a row whose
  -- line_items is a scalar or an object would abort the whole migration.
  CROSS JOIN LATERAL jsonb_array_elements(
    CASE WHEN jsonb_typeof(inv.line_items) = 'array' THEN inv.line_items ELSE '[]'::jsonb END
  ) li
  WHERE li->>'type' = 'parts'
),
agg AS (
  SELECT
    invoice_id,
    bool_and(qty IS NOT NULL AND unit_cost_base IS NOT NULL) AS all_costs_known,
    SUM(COALESCE(qty * unit_cost_base, 0))                   AS parts_cost,
    -- Sell falls back to the stored line `amount` when unit_cost is unusable —
    -- amount is what the customer was actually billed, so it is the better source.
    SUM(COALESCE(qty * unit_cost, amount, 0))                AS parts_sell
  FROM parts_rows
  GROUP BY invoice_id
)
UPDATE public.hd_invoices i
SET    parts_cost = round(agg.parts_cost, 2),
       parts_sell = round(agg.parts_sell, 2)
FROM   agg
WHERE  i.id = agg.invoice_id
  AND  i.parts_cost IS NULL
  AND  agg.all_costs_known;


-- Labor-only invoices are a KNOWN zero, not an unknown. An invoice that itemized no
-- parts at all genuinely cost nothing in parts, and its margin is real. Leaving these
-- NULL would drop the suite's highest-margin work out of every margin calculation
-- and make coverage look far worse than it is.
--
-- Guarded on subtotal_parts = 0: if parts revenue was billed without any parts line
-- item to explain it, the parts were real and their cost is genuinely unknown.
UPDATE public.hd_invoices i
SET    parts_cost = 0,
       parts_sell = 0
WHERE  i.parts_cost IS NULL
  AND  jsonb_typeof(i.line_items) = 'array'
  AND  COALESCE(i.subtotal_parts, 0) = 0
  AND  NOT EXISTS (
         SELECT 1
         FROM   jsonb_array_elements(
                  CASE WHEN jsonb_typeof(i.line_items) = 'array' THEN i.line_items ELSE '[]'::jsonb END
                ) li
         WHERE  li->>'type' = 'parts'
       );


-- parts_sell is filled even where cost stayed unknown. The sell price is on every
-- parts row ever written, so there is no gap to admit here — and having revenue
-- present on an invoice whose cost is NULL is exactly what lets the summary report
-- "revenue X, cost unknown" instead of dropping the invoice from both sides.
WITH parts_rows AS (
  SELECT
    inv.id AS invoice_id,
    CASE WHEN li->>'quantity'  ~ '^-?[0-9]+(\.[0-9]+)?$' THEN (li->>'quantity')::numeric  END AS qty,
    CASE WHEN li->>'unit_cost' ~ '^-?[0-9]+(\.[0-9]+)?$' THEN (li->>'unit_cost')::numeric END AS unit_cost,
    CASE WHEN li->>'amount'    ~ '^-?[0-9]+(\.[0-9]+)?$' THEN (li->>'amount')::numeric    END AS amount
  FROM public.hd_invoices inv
  -- Array guard inside the lateral, same reason as the first pass above.
  CROSS JOIN LATERAL jsonb_array_elements(
    CASE WHEN jsonb_typeof(inv.line_items) = 'array' THEN inv.line_items ELSE '[]'::jsonb END
  ) li
  WHERE li->>'type' = 'parts'
),
agg AS (
  SELECT invoice_id, SUM(COALESCE(qty * unit_cost, amount, 0)) AS parts_sell
  FROM   parts_rows
  GROUP  BY invoice_id
)
UPDATE public.hd_invoices i
SET    parts_sell = round(agg.parts_sell, 2)
FROM   agg
WHERE  i.id = agg.invoice_id
  AND  i.parts_sell IS NULL;
