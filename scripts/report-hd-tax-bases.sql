-- READ-ONLY. Selects only; writes nothing. Paste into the Supabase SQL editor.
--
-- Every HD invoice and quote, across ALL accounts, with the tax it RECORDED and the tax
-- the settled rule gives:
--   parts bucket = parts lines (all jobs) + shop supplies
--   labor bucket = labor lines (all jobs) + drive time + diagnostic + road call
--                  + service call (unless service_call_tax = 'none')
--   mileage is in neither.
-- Each bucket taxed once at the rate the document's own tax_breakdown recorded, rounded
-- to the cent. A document with no stored split uses its single tax_rate for both
-- buckets, which is only an estimate (rule_basis says so).
--
-- Listed: every document with 2+ jobs, plus every document whose recorded tax differs
-- from the rule (the Nov 13 bug was lines added after the tax was carried, which can hit
-- a one-job document too). SMOKE rows are excluded. Discounted documents are flagged:
-- the rule figure here is before the discount, so compare those by hand.
--
-- Nothing is changed. A sent document stands.

WITH docs AS (
  SELECT 'invoice'::text AS kind, i.user_id, i.invoice_number AS doc_number, i.status,
         i.customer_name, i.line_items, i.tax_amount, i.tax_breakdown, i.tax_rate,
         i.subtotal_parts, i.subtotal_labor, i.shop_supplies_fee, i.travel_amount,
         i.diagnostic_fee, i.road_call_fee, i.service_call_fee, i.service_call_tax,
         i.discount, i.total,
         (i.sent_at IS NOT NULL OR COALESCE(i.sent_count, 0) > 0 OR i.status IN ('sent', 'overdue', 'paid')) AS was_sent,
         (i.paid_at IS NOT NULL OR i.status = 'paid') AS was_paid
    FROM public.hd_invoices i
  UNION ALL
  SELECT 'quote', q.user_id, q.quote_number, q.status,
         q.customer_name, q.line_items, q.tax_amount, q.tax_breakdown, q.tax_rate,
         q.subtotal_parts, q.subtotal_labor, q.shop_supplies_fee, q.travel_amount,
         q.diagnostic_fee, q.road_call_fee, q.service_call_fee, q.service_call_tax,
         q.discount, q.total,
         (q.sent_at IS NOT NULL OR COALESCE(q.sent_count, 0) > 0 OR q.status IN ('sent', 'approved', 'declined')) AS was_sent,
         false
    FROM public.hd_quotes q
),
based AS (
  SELECT d.*,
    (SELECT count(DISTINCT e->>'job')
       FROM jsonb_array_elements(CASE WHEN jsonb_typeof(d.line_items) = 'array' THEN d.line_items ELSE '[]'::jsonb END) e
      WHERE e ? 'job') AS job_count,
    round((COALESCE(d.subtotal_parts, 0) + COALESCE(d.shop_supplies_fee, 0))::numeric, 2) AS parts_base,
    round((COALESCE(d.subtotal_labor, 0) + COALESCE(d.travel_amount, 0)
         + COALESCE(d.diagnostic_fee, 0) + COALESCE(d.road_call_fee, 0)
         + CASE WHEN COALESCE(d.service_call_tax, '') = 'none' THEN 0 ELSE COALESCE(d.service_call_fee, 0) END)::numeric, 2) AS labor_base,
    COALESCE((d.tax_breakdown->'parts'->>'rate')::numeric, d.tax_rate::numeric, 0) AS parts_rate,
    COALESCE((d.tax_breakdown->'labor'->>'rate')::numeric, d.tax_rate::numeric, 0) AS labor_rate,
    COALESCE((d.tax_breakdown->'parts'->>'taxed')::boolean, true) AS parts_taxed,
    COALESCE((d.tax_breakdown->'labor'->>'taxed')::boolean, true) AS labor_taxed
  FROM docs d
  WHERE d.tax_amount IS NOT NULL
    AND COALESCE(d.customer_name, '') NOT ILIKE '%SMOKE%'
),
ruled AS (
  SELECT b.*,
    CASE WHEN b.parts_taxed THEN round(b.parts_base * b.parts_rate / 100, 2) ELSE 0 END AS parts_tax_rule,
    CASE WHEN b.labor_taxed THEN round(b.labor_base * b.labor_rate / 100, 2) ELSE 0 END AS labor_tax_rule
  FROM based b
)
SELECT
  u.email                                              AS account_email,
  r.kind,
  r.doc_number,
  r.status,
  r.customer_name,
  GREATEST(r.job_count, 1)                             AS jobs,
  r.tax_amount                                         AS tax_recorded,
  (r.parts_tax_rule + r.labor_tax_rule)                AS tax_rule,
  round((r.parts_tax_rule + r.labor_tax_rule) - r.tax_amount::numeric, 2) AS difference,
  (r.tax_breakdown->'parts'->>'base')                  AS parts_base_recorded,
  r.parts_base                                         AS parts_base_rule,
  (r.tax_breakdown->'labor'->>'base')                  AS labor_base_recorded,
  r.labor_base                                         AS labor_base_rule,
  CASE WHEN r.tax_breakdown IS NULL THEN 'ESTIMATE - no split recorded' ELSE 'recorded split' END AS rule_basis,
  (r.discount IS NOT NULL AND COALESCE((r.discount->>'amount')::numeric, 0) > 0) AS discounted,
  r.was_sent                                           AS sent,
  r.was_paid                                           AS paid,
  r.total
FROM ruled r
LEFT JOIN auth.users u ON u.id = r.user_id
WHERE GREATEST(r.job_count, 1) >= 2
   OR round((r.parts_tax_rule + r.labor_tax_rule) - r.tax_amount::numeric, 2) <> 0
ORDER BY (r.was_sent OR r.was_paid) DESC, abs(round((r.parts_tax_rule + r.labor_tax_rule) - r.tax_amount::numeric, 2)) DESC, r.doc_number;
