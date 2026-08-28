-- Migration 120: line items + a structured service address on HD work orders.
--
-- Until now a work order's only billable record was labor_hours × labor_rate, so a
-- job with parts on it could not be priced until it reached the invoice form. The
-- tech was retyping every part number twice. These rows let the parts land on the
-- job where they were installed.
--
-- The address columns replace nothing: hd_work_orders has a single free-text
-- `location`, which cannot be prefilled into the invoice form's line1/city/state/zip
-- fields. `location` is left alone — it holds gate codes and yard directions that do
-- not belong in a mailing address.

CREATE TABLE IF NOT EXISTS public.hd_work_order_line_items (
  id              UUID          DEFAULT gen_random_uuid() PRIMARY KEY,
  -- ON DELETE CASCADE, unlike the ON DELETE SET NULL used for inspections and PM
  -- checklists on this same parent. That difference is deliberate: an inspection is
  -- a compliance document that outlives the job it was performed on and must survive
  -- the work order being deleted. A line item is not a document — it is one row of
  -- the job's pricing and means nothing without the job, so it goes with it rather
  -- than being orphaned into a set of unattributable dollar figures.
  work_order_id   UUID          NOT NULL REFERENCES public.hd_work_orders(id) ON DELETE CASCADE,
  type            TEXT          NOT NULL CHECK (type IN ('labor', 'part')),
  description     TEXT,
  part_number     TEXT,
  quantity        NUMERIC(10,2) NOT NULL DEFAULT 1,
  -- unit_cost is what the TECH paid; unit_price is what the CUSTOMER is charged.
  -- Both are stored because the markup is a percentage: keeping only the sell price
  -- makes the job's margin unrecoverable, and keeping only the cost re-derives the
  -- sell price on every read and lets a later markup change silently re-bill an old
  -- job. Nullable cost means "not known", which is not the same as a cost of zero.
  unit_cost       NUMERIC(10,2),
  unit_price      NUMERIC(10,2),
  markup_percent  NUMERIC(5,2),
  total           NUMERIC(10,2),
  sort_order      INTEGER       NOT NULL DEFAULT 0,
  created_at      TIMESTAMPTZ   DEFAULT NOW(),
  updated_at      TIMESTAMPTZ   DEFAULT NOW()
);

-- Every read is "all lines for one work order, in display order", so the index
-- carries the sort key too and the ordering comes off the index instead of a sort.
CREATE INDEX IF NOT EXISTS idx_hd_wo_line_items_wo
  ON public.hd_work_order_line_items (work_order_id, sort_order);

ALTER TABLE public.hd_work_order_line_items ENABLE ROW LEVEL SECURITY;

-- Ownership lives on the parent, so the policy reaches through rather than
-- duplicating user_id onto the child, where it could drift out of step with the
-- work order it belongs to.
--
-- Note this is owner-only and does NOT use the fleet_pro helper functions that guard
-- the units and service-history tables. Fleet Pro exists to show a fleet customer
-- their own equipment's record; a work order is the mechanic's internal job sheet and
-- its cost column is the tech's buy price, which is exactly what a customer must not
-- see. The customer-facing numbers reach them through the invoice instead.
DROP POLICY IF EXISTS "own hd work order line items" ON public.hd_work_order_line_items;
CREATE POLICY "own hd work order line items" ON public.hd_work_order_line_items
  FOR ALL TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.hd_work_orders wo
      WHERE wo.id = hd_work_order_line_items.work_order_id
        AND wo.user_id = auth.uid()
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.hd_work_orders wo
      WHERE wo.id = hd_work_order_line_items.work_order_id
        AND wo.user_id = auth.uid()
    )
  );

-- Structured service address. Split into fields rather than added to the free-text
-- `location` so the "Create Invoice" handoff can prefill the invoice form's address
-- inputs directly, instead of dumping one string into Address Line 1.
ALTER TABLE public.hd_work_orders
  ADD COLUMN IF NOT EXISTS address_line1 TEXT,
  ADD COLUMN IF NOT EXISTS address_line2 TEXT,
  ADD COLUMN IF NOT EXISTS city          TEXT,
  ADD COLUMN IF NOT EXISTS state         TEXT,
  ADD COLUMN IF NOT EXISTS zip           TEXT;
