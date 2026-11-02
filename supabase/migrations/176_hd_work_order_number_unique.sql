-- 176: one HD work order per number, per shop.
--
-- WHAT IS WRONG. work_orders (LD) has had UNIQUE (user_id, work_order_number) since
-- migration 135. hd_work_orders never got it. The app now numbers a new work order as
-- the highest existing number plus one, and when two saves read the same highest number
-- at once, the unique key is what refuses the second so the app can take the next number
-- instead (src/lib/work-order-number.ts). Without the key on hd_work_orders, two HD
-- saves at the same instant would both keep the same number, silently.
--
-- WHAT THIS DOES. Adds a unique index on hd_work_orders (user_id, work_order_number).
-- NULL numbers are allowed and never clash with each other (Postgres treats NULLs as
-- distinct), so the 1,740 imported work orders with no number on one account are
-- untouched. Checked Nov 2, 2026: no shop holds the same non-null number twice.
--
-- INDEX ONLY. No column, policy or row is changed.
-- Preview and production share one database. Applying this applies it to both.
--
-- The DO block refuses to build the index - rolling the whole transaction back - if
-- any shop already holds a number twice, and names the first few. It then checks the
-- index exists and is unique.

BEGIN;

DO $$
DECLARE
  dup_count int;
  dup_list  text;
BEGIN
  SELECT count(*), string_agg(user_id::text || ' ' || work_order_number, '; ')
    INTO dup_count, dup_list
    FROM (SELECT user_id, work_order_number
            FROM public.hd_work_orders
           WHERE work_order_number IS NOT NULL
           GROUP BY user_id, work_order_number
          HAVING count(*) > 1
           LIMIT 10) d;
  IF dup_count > 0 THEN
    RAISE EXCEPTION '176: % shop/number pair(s) already used twice (first: %) - nothing applied', dup_count, dup_list;
  END IF;
END $$;

CREATE UNIQUE INDEX IF NOT EXISTS hd_work_orders_user_id_work_order_number_key
  ON public.hd_work_orders (user_id, work_order_number);

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_indexes
     WHERE schemaname = 'public' AND tablename = 'hd_work_orders'
       AND indexname = 'hd_work_orders_user_id_work_order_number_key'
       AND indexdef ILIKE 'CREATE UNIQUE INDEX%(user_id, work_order_number)%'
  ) THEN
    RAISE EXCEPTION '176: the unique index is missing after CREATE - nothing applied';
  END IF;
END $$;

-- Check (last, so it is the result the editor shows). Expect exactly 1 row.
SELECT indexname, indexdef
  FROM pg_indexes
 WHERE schemaname = 'public' AND tablename = 'hd_work_orders'
   AND indexname = 'hd_work_orders_user_id_work_order_number_key';

COMMIT;
