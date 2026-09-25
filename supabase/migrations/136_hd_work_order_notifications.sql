-- HD customer notifications on work order status changes.
--
-- HD had no send path at all: PATCH /api/hd/work-orders/[id]/status wrote the
-- status and returned. This adds the three columns that path needs to notify a
-- customer safely — consent, and one stamp per transition.

-- ── Consent ──────────────────────────────────────────────────────────────────
-- DEFAULT TRUE, unlike jobs.sms_consent (021) which defaults false. The two are
-- not the same situation: an LD job can arrive from the public booking form,
-- where consent is a checkbox the customer either ticked or did not. An HD work
-- order is always written up by the tech, who got the number from the customer
-- for this job. Defaulting false would mean every HD work order silently declines
-- to notify, which is the bug this migration exists to end.
--
-- NOT NULL so the gate can never read as "unknown", and a per-record false is
-- still honoured — the tech can switch it off for a customer who asks.
ALTER TABLE public.hd_work_orders
  ADD COLUMN IF NOT EXISTS sms_consent BOOLEAN NOT NULL DEFAULT true;

-- ── Notification stamps ──────────────────────────────────────────────────────
-- Deliberately separate from on_the_way_at / completed_at, which record when the
-- STATUS changed. These record when the CUSTOMER WAS TOLD, and they are what makes
-- a status dragged back and forth text only once: a tech correcting a misclick,
-- or a job that goes on_the_way -> open -> on_the_way, must not send twice.
--
-- Nullable with no default: null means "not yet told", which is the correct
-- reading for every work order that existed before this migration.
ALTER TABLE public.hd_work_orders
  ADD COLUMN IF NOT EXISTS on_my_way_sent_at     TIMESTAMP WITH TIME ZONE;

ALTER TABLE public.hd_work_orders
  ADD COLUMN IF NOT EXISTS completed_notified_at TIMESTAMP WITH TIME ZONE;

-- Partial index: the status route asks "has this one been notified yet", and the
-- rows it cares about are the ones where the answer is no.
CREATE INDEX IF NOT EXISTS idx_hd_work_orders_unnotified
  ON public.hd_work_orders (user_id, status)
  WHERE on_my_way_sent_at IS NULL OR completed_notified_at IS NULL;
