-- Migration 129: sent_count / last_sent_at on hd_invoices.
--
-- hd_invoices already carries `sent_at`, but it cannot answer the question the
-- invoice detail page actually asks. The send route at
-- src/app/api/hd/invoices/[id]/send/route.ts writes it as
-- `invoice.sent_at ?? now()` — deliberately preserving the FIRST send, because
-- sent_at is what the aging and late-fee logic counts days from, and letting a
-- courtesy re-text reset it would silently restart the clock on a bill that is
-- already 45 days old. That is the right behaviour for sent_at and it is not
-- being changed here.
--
-- The consequence is that nothing on the row records the LAST send. A tech
-- looking at an invoice cannot tell whether the customer was texted once in
-- July or chased four times last week, so they either re-send a bill that went
-- out an hour ago or leave one alone that was never chased. These two columns
-- carry that second fact, alongside sent_at rather than instead of it:
--
--   sent_at      — the first time this invoice reached the customer. Never
--                  overwritten. Drives aging.
--   last_sent_at — the most recent time it reached them. Overwritten on every
--                  send. Drives what the UI shows the tech.
--   sent_count   — how many times in total, so "Sent 3 times" can be shown
--                  rather than implying a single send.

ALTER TABLE public.hd_invoices
  ADD COLUMN IF NOT EXISTS sent_count   INTEGER     NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS last_sent_at TIMESTAMPTZ;

COMMENT ON COLUMN public.hd_invoices.sent_count IS
  'Number of times this invoice has been delivered to the customer. Incremented by the send route on a successful delivery only.';

COMMENT ON COLUMN public.hd_invoices.last_sent_at IS
  'Most recent successful delivery. Unlike sent_at (first send, never overwritten, drives aging) this is rewritten on every send and is what the UI reports to the tech.';

-- ── BACKFILL ─────────────────────────────────────────────────────────────────
-- A non-null sent_at is proof the invoice reached the customer at least once —
-- the send route only writes it after a successful delivery. Leaving those rows
-- at sent_count = 0 would make the detail page label an already-sent invoice
-- "Send Invoice / never sent", which is precisely the confusion these columns
-- exist to remove, and would invite a tech to re-chase a customer who was
-- already chased. 1 is the floor, not the truth: sends made before this
-- migration were never counted, so a row that actually went out three times
-- reads as 1. That is accepted — understating a known send is safe, claiming a
-- send never happened is not.
--
-- last_sent_at takes sent_at rather than NOW() so the stamp reflects when the
-- invoice was actually delivered, not when this migration happened to run.
UPDATE public.hd_invoices
SET    sent_count   = 1,
       last_sent_at = sent_at
WHERE  sent_at IS NOT NULL
  AND  sent_count = 0
  AND  last_sent_at IS NULL;

-- Verification:
--   SELECT count(*) FILTER (WHERE sent_at IS NOT NULL AND sent_count = 0) AS unlabelled,
--          count(*) FILTER (WHERE sent_at IS NOT NULL) AS ever_sent,
--          count(*) AS total
--   FROM public.hd_invoices;
-- Expect unlabelled = 0.
