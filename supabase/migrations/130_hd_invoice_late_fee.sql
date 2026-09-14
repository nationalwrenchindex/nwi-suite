-- Migration 130: record the late-fee RATE on the invoice, and backfill the
-- missing due dates that currently make a late fee impossible.
--
-- Two separate problems, both belonging to the late-fee engine introduced in
-- migration 078, which is why they land in one migration.
--
-- ── PROBLEM 1: THE RATE IS NOT RECORDED ──────────────────────────────────────
-- 078 gave hd_invoices late_fee_applied / late_fee_amount / late_fee_applied_at.
-- Those record THAT a fee was charged and HOW MUCH, but not HOW the amount was
-- arrived at. The rate lives in late_fee_settings, which is mutable, single-row
-- per tech, and carries no history — a tech who moves their monthly rate from
-- 1.5% to 3% silently rewrites the explanation of every fee ever charged.
--
-- That matters the moment a customer disputes a fee. "$47.25 was added to a
-- $3,150 invoice" is only defensible if the invoice itself can say "because the
-- rate in force that day was 1.5% per month". Copying the rate onto the row at
-- the moment of application makes the fee self-explanatory months later,
-- independent of what settings say by then. This is the same reason the invoice
-- denormalizes labor_rate and work_order_number rather than joining for them.
--
-- NULLABLE, and no backfill. NULL means "charged before this column existed, or
-- charged as a flat fee" — and those two cases are distinguishable already,
-- because a flat fee is what late_fee_settings.fee_type = 'flat' produces and it
-- has no percentage to record. Inventing 1.5 for historical rows would assert a
-- rate nobody can verify, which is the exact failure this column exists to fix.
--
-- NUMERIC(5,2) matches late_fee_settings.percentage_rate (078) exactly, so the
-- value copied across never loses precision or overflows on the way.

ALTER TABLE public.hd_invoices
  ADD COLUMN IF NOT EXISTS late_fee_percentage NUMERIC(5,2);

COMMENT ON COLUMN public.hd_invoices.late_fee_percentage IS
  'The monthly percentage rate actually used to compute late_fee_amount on this invoice, copied from late_fee_settings.percentage_rate at the moment the fee was applied. NULL means no fee, a flat-amount fee (fee_type = ''flat'', which has no rate), or a fee applied before migration 130. Recorded because late_fee_settings is mutable and unversioned — without this the invoice cannot explain its own fee once the tech changes their rate.';

-- ── PROBLEM 2: THREE OF FIVE LIVE INVOICES HAVE NO DUE DATE ──────────────────
-- This is a live bug, not tidying. due_date is written in exactly one place —
-- src/app/api/hd/invoices/[id]/route.ts, when the status moves to 'sent', as
-- computeDueDate(sent_at, payment_terms). Any invoice that reached its customer
-- by another path, or predates that writer, has due_date NULL.
--
-- The late-fee cron (src/app/api/cron/late-fees/route.ts) filters candidates
-- with `.not('due_date','is',null)`, and it is right to: with no due date there
-- is no "past due" to measure from. The consequence is that an invoice with a
-- NULL due_date can NEVER receive a late fee by any path — not the cron, and not
-- the manual resend flow added alongside this migration, which uses the same
-- calculator. Two of the affected rows are on net30 terms, so the tech agreed a
-- due date with the customer, the invoice simply never stored it. They read as
-- "not overdue" forever.
--
-- ── HOW THE DATE IS DERIVED ──────────────────────────────────────────────────
-- Base date: COALESCE(sent_at, created_at). sent_at first, because that is the
-- argument the live writer passes to computeDueDate — a backfilled row and a
-- natively-written row then mean the same thing rather than being off by the gap
-- between drafting and sending. created_at is the fallback for rows that never
-- recorded a send; the terms had to start running from somewhere, and the day
-- the invoice was written is the only other date on the row.
--
-- Term days: mirrors termDays() in src/lib/hd/payment-terms.ts — net15/30/45.
--
-- 'Due on receipt' (the column's original DEFAULT, still on legacy rows) is
-- backfilled to the base date itself, i.e. zero days. Note this DIVERGES from
-- termDays(), which returns 30 for anything unrecognised. That 30 is a forward
-- safety default — it stops a freshly sent invoice being born already overdue.
-- A backfill is not forward-looking: these invoices are months old and their
-- stated terms say the money was due on receipt, so granting them 30 days of
-- credit the tech never offered would be inventing terms. Anything else
-- unrecognised gets the same treatment for the same reason.
--
-- BE AWARE this makes any old, unpaid 'Due on receipt' invoice immediately
-- past due — which is the truth, and is the point. Nothing charges a fee off the
-- back of it on its own: the cron only touches techs with an ACTIVE
-- late_fee_settings row (there are none today), and the manual flow only charges
-- when a tech chooses "Resend with Late Fee". The grace_period_days setting is
-- the lever for a tech who wants a cushion.
--
-- Every status is backfilled, including paid and void. due_date is a fact about
-- the agreement, not about collection: the QuickBooks export
-- (src/lib/hd/quickbooks-export.ts) and the aging views read it too, and a paid
-- invoice with no due date exports wrong regardless of the late-fee engine.
-- Fee eligibility is decided by status elsewhere, never by the presence of a date.
--
-- Idempotent: WHERE due_date IS NULL. Re-running touches nothing, and it never
-- overwrites a date already agreed.

UPDATE public.hd_invoices
SET    due_date = (COALESCE(sent_at, created_at) AT TIME ZONE 'UTC')::date
         + CASE lower(COALESCE(payment_terms, ''))
             WHEN 'net15' THEN 15
             WHEN 'net30' THEN 30
             WHEN 'net45' THEN 45
             ELSE 0          -- 'Due on receipt' and any other free text
           END
WHERE  due_date IS NULL
  AND  COALESCE(sent_at, created_at) IS NOT NULL;

-- Verification:
--   SELECT count(*) FILTER (WHERE due_date IS NULL)                       AS still_null,
--          count(*) FILTER (WHERE due_date IS NOT NULL)                   AS dated,
--          count(*) FILTER (WHERE lower(COALESCE(payment_terms,'')) LIKE 'net%'
--                             AND due_date IS NULL)                       AS net_terms_unusable,
--          count(*)                                                       AS total
--   FROM public.hd_invoices;
-- Expect still_null = 0 and net_terms_unusable = 0.
--
--   SELECT invoice_number, payment_terms, created_at::date, sent_at::date, due_date, status
--   FROM public.hd_invoices ORDER BY created_at DESC;
-- Eyeball that each due_date is base + the days its terms imply.
