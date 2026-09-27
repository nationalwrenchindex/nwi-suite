-- Segments on work orders.
--
-- The job this exists for, in a customer's words: "Truck here, I have a crank no
-- start, I troubleshot and found the PCM is bad. Segment 2 — customer states truck
-- needs new clutch." The PCM gets billed. The clutch gets declined. Neither one
-- contaminates the other's total, and the declined clutch becomes follow-up work
-- rather than a deleted row.
--
-- ONE TABLE, TWO PARENTS. LD work_orders and HD hd_work_orders are separate tables
-- with genuinely different line-item models, but a segment's money columns, status
-- machine and approval trail are identical for both. Two segment tables would mean
-- two CHECK constraints and two sets of indexes to keep in step, and that divergence
-- shows up as a money bug. So: two nullable FKs and a CHECK that exactly one is set,
-- NOT a parent_type/parent_id pair — a text discriminator cannot be enforced by the
-- database, and this table holds money.
--
-- HD's column is created here, unused, so the HD phase adds no migration of substance.

-- ── Segments ─────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.work_order_segments (
  id                   UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id              UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,

  ld_work_order_id     UUID REFERENCES public.work_orders(id)    ON DELETE CASCADE,
  hd_work_order_id     UUID REFERENCES public.hd_work_orders(id) ON DELETE CASCADE,
  CONSTRAINT work_order_segments_one_parent CHECK (
    (ld_work_order_id IS NOT NULL) <> (hd_work_order_id IS NOT NULL)
  ),

  sequence             INTEGER NOT NULL,

  -- The three C's, per segment. `complaint` is the customer's words, `cause` what
  -- the tech found, `correction` what was done.
  --
  -- LD is adding cause/correction to work_orders itself in a separate change. Those
  -- are NOT redundant with these: the parent's describe a legacy parent-priced job,
  -- these describe one segment. A work order is parent-priced OR segment-priced and
  -- never both (see the guard note at the bottom), so only one set is ever in play
  -- for a given record and there is nothing to keep in sync.
  complaint            TEXT,
  cause                TEXT,
  correction           TEXT,

  status               TEXT NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending', 'authorized', 'declined', 'complete')),

  -- Mirrors the parent's money columns so a segment prices on its own.
  --
  -- line_items here uses the CANONICAL per-line shape — type, part_number, quantity,
  -- unit_cost, unit_price, markup_percent, total — the same shape as
  -- hd_work_order_line_items, priced by src/lib/shared/work-order-lines.ts. That
  -- module tracks what the tech PAID as well as what the customer is charged, so a
  -- segment's margin is recoverable. LD's parent line_items keep their own older
  -- shape and their own math untouched: those records are already invoiced and
  -- billed history does not get rewritten.
  line_items           JSONB   DEFAULT '[]'::jsonb,
  labor_hours          NUMERIC,
  labor_rate           NUMERIC,
  parts_subtotal       NUMERIC,
  parts_markup_percent NUMERIC,
  labor_subtotal       NUMERIC,
  tax_percent          NUMERIC,
  tax_amount           NUMERIC,
  grand_total          NUMERIC,

  -- Set when the CUSTOMER answered, not when a tech moved a dropdown. The rollup
  -- reads `status`; these are the audit trail for who agreed to what, and when.
  authorized_at        TIMESTAMPTZ,
  declined_at          TIMESTAMPTZ,
  -- 'customer_link' | 'tech_manual' | 'phone' — same vocabulary as
  -- quotes.approval_method (011) so one reader handles both.
  authorization_method TEXT,
  customer_note        TEXT,

  -- ── A declined segment is a lead, not a deletion ──
  -- A declined clutch is the shop's best follow-up: known truck, known fault, a
  -- customer who already said "not today". Null until declined.
  followup_due_on      DATE,
  followup_closed_at   TIMESTAMPTZ,

  created_at           TIMESTAMPTZ DEFAULT now(),
  updated_at           TIMESTAMPTZ DEFAULT now()
);

-- Sequence is unique per parent. Gaps are fine and expected: deleting segment 2
-- leaves 1 and 3, and renumbering would change what the customer already approved.
CREATE UNIQUE INDEX IF NOT EXISTS idx_wos_ld_sequence
  ON public.work_order_segments (ld_work_order_id, sequence)
  WHERE ld_work_order_id IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS idx_wos_hd_sequence
  ON public.work_order_segments (hd_work_order_id, sequence)
  WHERE hd_work_order_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_wos_user   ON public.work_order_segments (user_id);
CREATE INDEX IF NOT EXISTS idx_wos_status ON public.work_order_segments (user_id, status);
-- The follow-up worklist: declined segments nobody has closed out yet.
CREATE INDEX IF NOT EXISTS idx_wos_followup
  ON public.work_order_segments (user_id, followup_due_on)
  WHERE status = 'declined' AND followup_closed_at IS NULL;

-- ── Options, for Good/Better/Best later ──────────────────────────────────────
-- Created NOW and left empty so that feature is additive rather than a rewrite.
--
-- A segment with zero options is priced by its own line_items — every segment at
-- the time of writing. A segment with options is priced by the SELECTED one, which
-- is why selected_option_id lives on the segment: the rollup reads through it, and
-- `status='authorized'` plus a selected option is how "the customer approved the
-- Better option" is recorded. A status-only model cannot express that.
CREATE TABLE IF NOT EXISTS public.work_order_segment_options (
  id                   UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  segment_id           UUID NOT NULL REFERENCES public.work_order_segments(id) ON DELETE CASCADE,
  user_id              UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  -- Free text, not a CHECK: a shop that wants "OEM / Aftermarket / Reman" instead of
  -- Good/Better/Best should not need a migration to say so.
  tier                 TEXT NOT NULL,
  label                TEXT,
  sort_order           INTEGER NOT NULL DEFAULT 0,
  line_items           JSONB   DEFAULT '[]'::jsonb,
  labor_hours          NUMERIC,
  labor_rate           NUMERIC,
  parts_subtotal       NUMERIC,
  parts_markup_percent NUMERIC,
  labor_subtotal       NUMERIC,
  tax_percent          NUMERIC,
  tax_amount           NUMERIC,
  grand_total          NUMERIC,
  created_at           TIMESTAMPTZ DEFAULT now(),
  updated_at           TIMESTAMPTZ DEFAULT now()
);

ALTER TABLE public.work_order_segments
  ADD COLUMN IF NOT EXISTS selected_option_id UUID
    REFERENCES public.work_order_segment_options(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_wso_segment ON public.work_order_segment_options (segment_id);

-- ── Customer approval on the work order ──────────────────────────────────────
-- Approval has only ever lived on QUOTES (011). Segments are approved on the WORK
-- ORDER, so each parent needs its own token. HD's columns are added here alongside
-- LD's: HD has never had a customer-facing approval surface at all, and this is the
-- schema half of giving it one.
ALTER TABLE public.work_orders
  ADD COLUMN IF NOT EXISTS public_token       TEXT UNIQUE,
  ADD COLUMN IF NOT EXISTS segments_sent_at   TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS segments_times_sent INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS customer_viewed_at TIMESTAMPTZ;

ALTER TABLE public.hd_work_orders
  ADD COLUMN IF NOT EXISTS public_token       TEXT UNIQUE,
  ADD COLUMN IF NOT EXISTS segments_sent_at   TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS segments_times_sent INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS customer_viewed_at TIMESTAMPTZ;

CREATE INDEX IF NOT EXISTS idx_work_orders_public_token    ON public.work_orders(public_token);
CREATE INDEX IF NOT EXISTS idx_hd_work_orders_public_token ON public.hd_work_orders(public_token);

-- ── RLS ──────────────────────────────────────────────────────────────────────
ALTER TABLE public.work_order_segments        ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.work_order_segment_options ENABLE ROW LEVEL SECURITY;

CREATE POLICY "work_order_segments: select own"
  ON public.work_order_segments FOR SELECT USING (auth.uid() = user_id);
CREATE POLICY "work_order_segments: insert own"
  ON public.work_order_segments FOR INSERT WITH CHECK (auth.uid() = user_id);
CREATE POLICY "work_order_segments: update own"
  ON public.work_order_segments FOR UPDATE USING (auth.uid() = user_id);
CREATE POLICY "work_order_segments: delete own"
  ON public.work_order_segments FOR DELETE USING (auth.uid() = user_id);

CREATE POLICY "work_order_segment_options: select own"
  ON public.work_order_segment_options FOR SELECT USING (auth.uid() = user_id);
CREATE POLICY "work_order_segment_options: insert own"
  ON public.work_order_segment_options FOR INSERT WITH CHECK (auth.uid() = user_id);
CREATE POLICY "work_order_segment_options: update own"
  ON public.work_order_segment_options FOR UPDATE USING (auth.uid() = user_id);
CREATE POLICY "work_order_segment_options: delete own"
  ON public.work_order_segment_options FOR DELETE USING (auth.uid() = user_id);

-- No anon policy. The public approval page reads and writes with the SERVICE client
-- keyed on the token, exactly as the public quote and invoice pages do. An anon
-- SELECT policy on a table holding every shop's pricing is a far wider blast radius
-- than the one route that actually needs the access.

CREATE TRIGGER set_work_order_segments_updated_at
  BEFORE UPDATE ON public.work_order_segments
  FOR EACH ROW EXECUTE PROCEDURE public.set_updated_at();

CREATE TRIGGER set_work_order_segment_options_updated_at
  BEFORE UPDATE ON public.work_order_segment_options
  FOR EACH ROW EXECUTE PROCEDURE public.set_updated_at();

-- ── PARENT-PRICED OR SEGMENT-PRICED, NEVER BOTH ──────────────────────────────
-- Enforced in the API (api/work-orders/[id]/segments), not by a constraint, because
-- the rule spans two tables and needs to return an explanation a tech can act on
-- rather than a 500 from a trigger.
--
-- A segment may not be added to a work order that already has parent line_items or
-- has been invoiced. Legacy work orders stay legacy and keep working exactly as they
-- do today; new work orders use segments. This is what removes the ambiguity of a
-- record carrying both a parent total and segment totals, and it is one guard
-- instead of a rule every tech has to remember.
--
-- Moving a legacy work order onto segments is an explicit "convert to segments"
-- action, to be built separately. It must never happen by accident.
