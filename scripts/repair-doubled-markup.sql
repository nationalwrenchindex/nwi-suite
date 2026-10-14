-- repair-doubled-markup.sql
--
-- Put the COST back in the cost column on work order part lines the converter filled
-- with the SELL price.
--
-- WHAT WENT WRONG. hd_quotes line_items keeps the sell price in unit_cost and the
-- shop's cost in unit_cost_base; hd_work_order_line_items is the other way round
-- (unit_cost is the cost, unit_price is the sell). The quote-to-work-order converter
-- read unit_cost as a cost, so a part quoted at cost 3.00 + 30% = 3.90 landed as
-- cost 3.90 / markup 30, and the screen computed 3.90 x 1.30 = 5.07.
--
-- NOTHING HAS BEEN OVER-BILLED. The stored total is still the figure the customer
-- approved - only the cost and sell columns are wrong. The danger is latent: the
-- line-items save route recomputes the total from cost + markup, so editing and
-- saving one of these lines would turn the 5.07 into the real stored total.
--
-- Audited live with scripts/audit-doubled-markup.ts on 2026-10-14:
--
--   work order     part        qty   cost   markup   stored   screen shows
--   WO-2026-1559   test 04       1   3.90      30%     3.90          5.07
--
-- ONE row. If that work order is a test you no longer need, deleting it and
-- re-converting the quote on the fixed code is just as correct and needs no SQL.
--
-- HOW THE COST IS RECOVERED. Inverted from the figures that ARE right: the stored
-- total is what the customer approved and the markup is what the quote recorded, so
--
--     cost = total / quantity / (1 + markup/100)
--
-- For this row that is 3.90 / 1 / 1.30 = 3.00 exactly. A row whose quoted sell was
-- not a clean multiple could land a cent from the original cost; the SELL price and
-- the total - the two figures that touch the customer - are exact either way.
--
-- ASCII only. Ends in ROLLBACK. Read step 1, run it all, check step 3, and only then
-- change the last line to COMMIT if the numbers are what you expect.

BEGIN;

-- -----------------------------------------------------------------------------
-- STEP 1. What is affected, and what this will change it to.
-- -----------------------------------------------------------------------------
SELECT w.work_order_number,
       li.id                                           AS line_id,
       COALESCE(li.part_number, li.description)         AS part,
       li.quantity,
       li.unit_cost                                     AS cost_now,
       li.markup_percent,
       li.unit_price                                    AS sell_now,
       li.total                                         AS approved_total,
       ROUND((li.unit_cost * (1 + li.markup_percent / 100.0)) * li.quantity, 2)
                                                        AS what_the_screen_shows,
       ROUND(li.total / NULLIF(li.quantity, 0) / (1 + li.markup_percent / 100.0), 2)
                                                        AS cost_after,
       ROUND(li.total / NULLIF(li.quantity, 0), 2)       AS sell_after
FROM   public.hd_work_order_line_items li
JOIN   public.hd_work_orders w ON w.id = li.work_order_id
WHERE  li.type = 'part'
  AND  w.quote_id IS NOT NULL
  AND  li.unit_cost IS NOT NULL
  AND  li.markup_percent IS NOT NULL
  AND  li.quantity > 0
  AND  ABS(ROUND((li.unit_cost * (1 + li.markup_percent / 100.0)) * li.quantity, 2) - li.total) >= 0.005
ORDER  BY w.work_order_number;

-- -----------------------------------------------------------------------------
-- STEP 2. The repair
-- -----------------------------------------------------------------------------
-- The WHERE clause is the same predicate as step 1, so this cannot touch a line
-- whose columns already agree with its total - including a part a tech priced by
-- hand, which has no markup recorded and is excluded by markup_percent IS NOT NULL.
--
-- The TOTAL IS NOT TOUCHED. It is the figure the customer approved and it is already
-- correct; rewriting it from the repaired columns would be re-deriving a price that
-- was agreed, which is the rule this whole fix exists to protect.
UPDATE public.hd_work_order_line_items li
SET    unit_cost  = ROUND(li.total / NULLIF(li.quantity, 0) / (1 + li.markup_percent / 100.0), 2),
       unit_price = ROUND(li.total / NULLIF(li.quantity, 0), 2)
FROM   public.hd_work_orders w
WHERE  w.id = li.work_order_id
  AND  li.type = 'part'
  AND  w.quote_id IS NOT NULL
  AND  li.unit_cost IS NOT NULL
  AND  li.markup_percent IS NOT NULL
  AND  li.quantity > 0
  AND  ABS(ROUND((li.unit_cost * (1 + li.markup_percent / 100.0)) * li.quantity, 2) - li.total) >= 0.005;

-- -----------------------------------------------------------------------------
-- STEP 3. Check it
-- -----------------------------------------------------------------------------
-- Expect ZERO rows: every part line's columns now agree with its stored total.
SELECT w.work_order_number,
       li.id AS line_id,
       li.unit_cost,
       li.markup_percent,
       li.total,
       ROUND((li.unit_cost * (1 + li.markup_percent / 100.0)) * li.quantity, 2) AS computed
FROM   public.hd_work_order_line_items li
JOIN   public.hd_work_orders w ON w.id = li.work_order_id
WHERE  li.type = 'part'
  AND  w.quote_id IS NOT NULL
  AND  li.unit_cost IS NOT NULL
  AND  li.markup_percent IS NOT NULL
  AND  li.quantity > 0
  AND  ABS(ROUND((li.unit_cost * (1 + li.markup_percent / 100.0)) * li.quantity, 2) - li.total) >= 0.005;

-- And the repaired rows, to read before you commit. Expect cost 3.00, sell 3.90,
-- total 3.90 for WO-2026-1559.
SELECT w.work_order_number,
       COALESCE(li.part_number, li.description) AS part,
       li.quantity, li.unit_cost, li.markup_percent, li.unit_price, li.total
FROM   public.hd_work_order_line_items li
JOIN   public.hd_work_orders w ON w.id = li.work_order_id
WHERE  li.type = 'part'
  AND  w.quote_id IS NOT NULL
ORDER  BY w.work_order_number;

ROLLBACK;
