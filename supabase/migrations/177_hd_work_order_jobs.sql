-- 177: jobs on HD work orders - one work order, several separate repairs.
--
-- WHAT THIS IS FOR. A large job is one work order with several repairs on it, each with
-- its own labor and parts, and the invoice itemizes by job so the customer sees what
-- each repair cost. Until now every line hung straight off the work order.
--
-- WHAT A JOB IS. A GROUPING of lines, nothing more. It carries no money of its own: a
-- job's subtotal is the sum of its lines' stored totals, and tax, markup, shop supplies,
-- travel, mileage, the fees and the discount stay on the WORK ORDER exactly as today.
-- work_order_segments (137) was not used: a segment prices and taxes itself, which would
-- change how a work order's tax is figured. No HD row has ever used it.
--
-- Room left, wired to nothing: status, approved_at, approved_by. Per-job authorization
-- is not built.
--
-- WHAT THIS DOES
--   1. Creates hd_work_order_jobs, unique (work_order_id, job_number), RLS TO
--      authenticated: the owner of the work order only.
--   2. Adds hd_work_order_line_items.job_id.
--   3. Gives EVERY existing work order a job 1 (3,316 on Nov 2, 2026) - complete when
--      the work order is completed or invoiced, open otherwise - and moves its lines
--      (53 on Nov 2) onto that job. No amount, quantity, price, cost or total is written.
--
-- THE SELF-CHECKS, every one inside this transaction; any failure raises and rolls the
-- whole migration back:
--   * every work order has exactly one job, numbered 1; every line has a job, and that
--     job is on the line's own work order
--   * every work order's stored total_amount, tax_amount and discount, and every line's
--     quantity / unit_cost / unit_price / markup_percent / total, match a snapshot taken
--     before the change - per row, not in aggregate
--   * every invoice's total, subtotals and line_items match the snapshot (this migration
--     does not touch hd_invoices; the check proves it)
--   * as anon: zero jobs visible, and an insert is refused
--   * as the owner of a work order (authenticated): sees exactly that account's jobs and
--     none of anyone else's
--
-- Preview and production share one database. Applying this applies it to both.
-- Plain ASCII. Ends in COMMIT; a failed check means nothing was applied.

BEGIN;

-- -- Snapshots, before anything changes -----------------------------------------------
CREATE TEMP TABLE _wo_before ON COMMIT DROP AS
  SELECT id, user_id, total_amount, tax_amount, discount::text AS discount
    FROM public.hd_work_orders;
CREATE TEMP TABLE _li_before ON COMMIT DROP AS
  SELECT id, work_order_id, quantity, unit_cost, unit_price, markup_percent, total, sort_order
    FROM public.hd_work_order_line_items;
CREATE TEMP TABLE _inv_before ON COMMIT DROP AS
  SELECT id, total, subtotal_labor, subtotal_parts, tax_amount, line_items::text AS line_items
    FROM public.hd_invoices;

-- -- 1. The table ---------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.hd_work_order_jobs (
  id             UUID        DEFAULT gen_random_uuid() PRIMARY KEY,
  work_order_id  UUID        NOT NULL REFERENCES public.hd_work_orders(id) ON DELETE CASCADE,
  user_id        UUID        NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  job_number     INTEGER     NOT NULL CHECK (job_number > 0),
  description    TEXT,
  status         TEXT        NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'complete')),
  -- Space for per-job authorization later. Nothing reads or writes these yet.
  approved_at    TIMESTAMPTZ,
  approved_by    TEXT,
  created_at     TIMESTAMPTZ DEFAULT NOW(),
  updated_at     TIMESTAMPTZ DEFAULT NOW(),
  CONSTRAINT hd_work_order_jobs_number_key UNIQUE (work_order_id, job_number)
);

CREATE INDEX IF NOT EXISTS idx_hd_wo_jobs_user ON public.hd_work_order_jobs (user_id);

ALTER TABLE public.hd_work_order_jobs ENABLE ROW LEVEL SECURITY;

-- The owner of the work order, and only them. user_id is on the row so the policy does
-- not have to reach through for a read, and the EXISTS keeps it in step with the parent.
DROP POLICY IF EXISTS "own hd work order jobs" ON public.hd_work_order_jobs;
CREATE POLICY "own hd work order jobs" ON public.hd_work_order_jobs
  FOR ALL TO authenticated
  USING (
    user_id = auth.uid()
    AND EXISTS (SELECT 1 FROM public.hd_work_orders wo
                 WHERE wo.id = hd_work_order_jobs.work_order_id AND wo.user_id = auth.uid())
  )
  WITH CHECK (
    user_id = auth.uid()
    AND EXISTS (SELECT 1 FROM public.hd_work_orders wo
                 WHERE wo.id = hd_work_order_jobs.work_order_id AND wo.user_id = auth.uid())
  );

REVOKE ALL ON public.hd_work_order_jobs FROM anon;

-- -- 2. Lines belong to a job ---------------------------------------------------------
-- NO ACTION, not CASCADE: deleting a job must never take billable lines with it. A work
-- order delete still cascades to both, checked at the end of that one statement.
ALTER TABLE public.hd_work_order_line_items
  ADD COLUMN IF NOT EXISTS job_id UUID REFERENCES public.hd_work_order_jobs(id);
CREATE INDEX IF NOT EXISTS idx_hd_wo_line_items_job ON public.hd_work_order_line_items (job_id);

-- -- 3. Every existing work order becomes a single-job work order ----------------------
INSERT INTO public.hd_work_order_jobs (work_order_id, user_id, job_number, status)
SELECT wo.id, wo.user_id, 1,
       CASE WHEN wo.status IN ('completed', 'invoiced') THEN 'complete' ELSE 'open' END
  FROM public.hd_work_orders wo
 WHERE NOT EXISTS (SELECT 1 FROM public.hd_work_order_jobs j WHERE j.work_order_id = wo.id);

UPDATE public.hd_work_order_line_items li
   SET job_id = j.id
  FROM public.hd_work_order_jobs j
 WHERE j.work_order_id = li.work_order_id
   AND j.job_number = 1
   AND li.job_id IS NULL;

-- -- Self-checks ------------------------------------------------------------------------
DO $$
DECLARE
  n_wo int; n_jobs int; n bigint; owner uuid; owner_jobs int; seen int;
BEGIN
  SELECT count(*) INTO n_wo FROM public.hd_work_orders;
  SELECT count(*) INTO n_jobs FROM public.hd_work_order_jobs;
  IF n_jobs <> n_wo THEN
    RAISE EXCEPTION '177: % jobs for % work orders - expected one each - nothing applied', n_jobs, n_wo;
  END IF;
  SELECT count(*) INTO n FROM public.hd_work_orders wo
   WHERE (SELECT count(*) FROM public.hd_work_order_jobs j WHERE j.work_order_id = wo.id AND j.job_number = 1) <> 1;
  IF n > 0 THEN RAISE EXCEPTION '177: % work order(s) without exactly one job 1 - nothing applied', n; END IF;
  SELECT count(*) INTO n FROM public.hd_work_order_jobs j JOIN public.hd_work_orders wo ON wo.id = j.work_order_id
   WHERE j.user_id <> wo.user_id;
  IF n > 0 THEN RAISE EXCEPTION '177: % job(s) owned by someone other than the work order owner - nothing applied', n; END IF;

  SELECT count(*) INTO n FROM public.hd_work_order_line_items WHERE job_id IS NULL;
  IF n > 0 THEN RAISE EXCEPTION '177: % line(s) left without a job - nothing applied', n; END IF;
  SELECT count(*) INTO n FROM public.hd_work_order_line_items li JOIN public.hd_work_order_jobs j ON j.id = li.job_id
   WHERE j.work_order_id <> li.work_order_id;
  IF n > 0 THEN RAISE EXCEPTION '177: % line(s) on a job from another work order - nothing applied', n; END IF;

  -- Money, per row. IS DISTINCT FROM so a NULL that became 0 (or the reverse) fails.
  SELECT count(*) INTO n FROM _wo_before b LEFT JOIN public.hd_work_orders wo ON wo.id = b.id
   WHERE wo.id IS NULL OR wo.total_amount IS DISTINCT FROM b.total_amount
      OR wo.tax_amount IS DISTINCT FROM b.tax_amount OR wo.discount::text IS DISTINCT FROM b.discount;
  IF n > 0 THEN RAISE EXCEPTION '177: % work order total(s) changed - nothing applied', n; END IF;
  SELECT count(*) INTO n FROM public.hd_work_orders;
  IF n <> (SELECT count(*) FROM _wo_before) THEN RAISE EXCEPTION '177: work order count changed - nothing applied'; END IF;

  SELECT count(*) INTO n FROM _li_before b LEFT JOIN public.hd_work_order_line_items li ON li.id = b.id
   WHERE li.id IS NULL OR li.work_order_id IS DISTINCT FROM b.work_order_id
      OR li.quantity IS DISTINCT FROM b.quantity OR li.unit_cost IS DISTINCT FROM b.unit_cost
      OR li.unit_price IS DISTINCT FROM b.unit_price OR li.markup_percent IS DISTINCT FROM b.markup_percent
      OR li.total IS DISTINCT FROM b.total OR li.sort_order IS DISTINCT FROM b.sort_order;
  IF n > 0 THEN RAISE EXCEPTION '177: % line item amount(s) changed - nothing applied', n; END IF;
  SELECT count(*) INTO n FROM public.hd_work_order_line_items;
  IF n <> (SELECT count(*) FROM _li_before) THEN RAISE EXCEPTION '177: line item count changed - nothing applied'; END IF;

  SELECT count(*) INTO n FROM _inv_before b LEFT JOIN public.hd_invoices i ON i.id = b.id
   WHERE i.id IS NULL OR i.total IS DISTINCT FROM b.total OR i.subtotal_labor IS DISTINCT FROM b.subtotal_labor
      OR i.subtotal_parts IS DISTINCT FROM b.subtotal_parts OR i.tax_amount IS DISTINCT FROM b.tax_amount
      OR i.line_items::text IS DISTINCT FROM b.line_items;
  IF n > 0 THEN RAISE EXCEPTION '177: % invoice(s) changed - nothing applied', n; END IF;

  -- As anon: nothing visible, nothing writable.
  SET LOCAL ROLE anon;
  BEGIN
    SELECT count(*) INTO seen FROM public.hd_work_order_jobs;
    RAISE EXCEPTION '177: anon could read hd_work_order_jobs (% rows) - nothing applied', seen;
  EXCEPTION WHEN insufficient_privilege THEN NULL;
  END;
  BEGIN
    INSERT INTO public.hd_work_order_jobs (work_order_id, user_id, job_number)
      SELECT id, user_id, 99 FROM public.hd_work_orders LIMIT 1;
    RAISE EXCEPTION '177: anon could insert into hd_work_order_jobs - nothing applied';
  EXCEPTION WHEN insufficient_privilege THEN NULL;
  END;
  RESET ROLE;

  -- As a signed-in owner: their own jobs, exactly, and nobody else's.
  SELECT user_id INTO owner FROM public.hd_work_orders GROUP BY user_id ORDER BY count(*) DESC LIMIT 1;
  SELECT count(*) INTO owner_jobs FROM public.hd_work_order_jobs WHERE user_id = owner;
  PERFORM set_config('request.jwt.claims', json_build_object('sub', owner, 'role', 'authenticated')::text, true);
  PERFORM set_config('request.jwt.claim.sub', owner::text, true);
  SET LOCAL ROLE authenticated;
  SELECT count(*) INTO seen FROM public.hd_work_order_jobs;
  IF seen <> owner_jobs THEN
    RESET ROLE;
    RAISE EXCEPTION '177: the owner sees % jobs, expected their own % - nothing applied', seen, owner_jobs;
  END IF;
  SELECT count(*) INTO seen FROM public.hd_work_order_jobs WHERE user_id <> owner;
  IF seen <> 0 THEN
    RESET ROLE;
    RAISE EXCEPTION '177: the owner can see % job(s) on another account - nothing applied', seen;
  END IF;
  RESET ROLE;
  PERFORM set_config('request.jwt.claims', '', true);
  PERFORM set_config('request.jwt.claim.sub', '', true);
END $$;

-- What the editor shows last. Expect: work_orders = jobs, lines = lines_on_a_job,
-- and changed_* all 0.
SELECT (SELECT count(*) FROM public.hd_work_orders)                                AS work_orders,
       (SELECT count(*) FROM public.hd_work_order_jobs)                            AS jobs,
       (SELECT count(*) FROM public.hd_work_order_line_items)                      AS lines,
       (SELECT count(*) FROM public.hd_work_order_line_items WHERE job_id IS NOT NULL) AS lines_on_a_job,
       (SELECT count(*) FROM _li_before b JOIN public.hd_work_order_line_items li ON li.id = b.id
         WHERE li.total IS DISTINCT FROM b.total)                                  AS changed_line_totals,
       (SELECT count(*) FROM _wo_before b JOIN public.hd_work_orders wo ON wo.id = b.id
         WHERE wo.total_amount IS DISTINCT FROM b.total_amount)                    AS changed_work_order_totals,
       (SELECT count(*) FROM _inv_before b JOIN public.hd_invoices i ON i.id = b.id
         WHERE i.total IS DISTINCT FROM b.total)                                   AS changed_invoice_totals;

COMMIT;
