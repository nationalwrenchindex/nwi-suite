-- ╔═══════════════════════════════════════════════════════════════════════════╗
-- ║ 143 — Payment terms on both products, and the shop's own street address    ║
-- ╚═══════════════════════════════════════════════════════════════════════════╝
--
-- BIG RUN THREE, Part 3.
--
-- SAFE TO RUN ON A LIVE DATABASE. Additive only. No existing row changes value,
-- nothing is backfilled, and there is no CHECK constraint — see WHY NO CHECK
-- CONSTRAINT below, which is the one thing in this file worth reading twice.
--
-- IDEMPOTENT.

BEGIN;

-- ─────────────────────────────────────────────────────────────────────────────
-- 1. WHAT ALREADY DRIVES "Terms: Due on receipt"
--
-- hd_invoices.payment_terms and hd_quotes.payment_terms already exist, and
-- src/lib/hd/payment-terms.ts already turns them into a label and a due date.
-- That module is the single source of truth and this migration does NOT build a
-- second one — it widens the vocabulary that module understands.
--
-- WHAT IS ACTUALLY STORED IN PRODUCTION TODAY:
--   hd_invoices : "net30" x 8, "net15" x 7, "Due on receipt" x 3   (18 rows)
--   hd_quotes   : "net30" x 5                                      (5 rows)
--   invoices    : no payment_terms column at all; `terms` is free text, set on
--                 2 of 16 rows, both reading "Payment due upon receipt."
--
-- The canonical set from here on is:
--   'due_on_receipt' | 'net_7' | 'net_15' | 'net_30'
--
-- which does NOT match the stored "net30" / "net15" / "Due on receipt". Rather
-- than rewrite 23 live rows, termsDisplay/termDays normalise the old spellings on
-- READ and new documents write the canonical form. Optional normalisation SQL is
-- in the run report; it is not run here because an UPDATE across sent invoices is
-- not something a migration should do on its own.
--
-- 'net_45' is also still accepted on read: the existing module supports net45 and
-- removing it would make a previously valid value unreadable. It is simply not
-- offered in the picker.
-- ─────────────────────────────────────────────────────────────────────────────

-- LD has no payment_terms column. `terms` is free text and is DELIBERATELY LEFT
-- ALONE — it is the human sentence a shop types, and this is the structured field.
ALTER TABLE public.invoices
  ADD COLUMN IF NOT EXISTS payment_terms TEXT;

-- due_date already exists on both invoice tables (invoices.due_date is NULL on
-- all 16 rows; hd_invoices.due_date is set on 12 of 18). Stated as a no-op so the
-- file documents the whole shape rather than half of it.
ALTER TABLE public.invoices     ADD COLUMN IF NOT EXISTS due_date DATE;
ALTER TABLE public.hd_invoices  ADD COLUMN IF NOT EXISTS due_date DATE;

-- Quotes carry terms forward to the invoice they become.
ALTER TABLE public.quotes
  ADD COLUMN IF NOT EXISTS payment_terms TEXT;
ALTER TABLE public.hd_quotes
  ADD COLUMN IF NOT EXISTS payment_terms TEXT;

COMMENT ON COLUMN public.invoices.payment_terms IS
  'due_on_receipt | net_7 | net_15 | net_30. Legacy HD spellings (net15, net30, "Due on receipt") are normalised on read by src/lib/hd/payment-terms.ts.';

-- ─────────────────────────────────────────────────────────────────────────────
-- 2. THE BUSINESS DEFAULT
--
-- DEFAULT 'net_7' per the brief. Existing rows get the DEFAULT because the column
-- is new, which is the intended behaviour: "existing invoices get the business
-- default, no due date, and read as they do today".
-- ─────────────────────────────────────────────────────────────────────────────
ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS default_payment_terms TEXT DEFAULT 'net_7';

-- ─────────────────────────────────────────────────────────────────────────────
-- 3. THE SHOP'S OWN ADDRESS
--
-- profiles had city and state and nothing else, so the shop block on a customer's
-- invoice could print "Winston-Salem, NC" and no more. shopBlockFrom() was already
-- built against the full five-column shape with the seam unwired (see
-- SHOP_BLOCK_SELECT); these are the two columns that complete it.
--
-- Named to match the five columns that already exist on customers, hd_invoices,
-- hd_quotes and hd_work_orders, so addressFrom() reads a profile with no special
-- case.
-- ─────────────────────────────────────────────────────────────────────────────
ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS address_line1 TEXT,
  ADD COLUMN IF NOT EXISTS address_line2 TEXT,
  ADD COLUMN IF NOT EXISTS zip           TEXT;

COMMENT ON COLUMN public.profiles.address_line1 IS
  'The shop''s own street address, for the shop block on customer-facing documents. city/state already existed; zip and these two did not.';

-- ─────────────────────────────────────────────────────────────────────────────
-- 4. PAST-DUE LOOKUPS
--
-- The financials past-due list filters on an unpaid invoice with a due date in the
-- past, in both products. Partial indexes because a paid invoice is never past due
-- and most rows have no due date at all.
-- ─────────────────────────────────────────────────────────────────────────────
CREATE INDEX IF NOT EXISTS invoices_due_date_idx
  ON public.invoices (user_id, due_date)
  WHERE due_date IS NOT NULL;

CREATE INDEX IF NOT EXISTS hd_invoices_due_date_idx
  ON public.hd_invoices (user_id, due_date)
  WHERE due_date IS NOT NULL;

COMMIT;

-- ╔═══════════════════════════════════════════════════════════════════════════╗
-- ║ WHY NO CHECK CONSTRAINT                                                   ║
-- ╠═══════════════════════════════════════════════════════════════════════════╣
-- ║ A CHECK on payment_terms is the obvious thing to add and it would FAIL     ║
-- ║ this migration outright. ALTER TABLE ... ADD CONSTRAINT validates every    ║
-- ║ existing row, and 18 HD invoices hold "net30" / "net15" / "Due on         ║
-- ║ receipt" — none of which are in the canonical set. The migration would     ║
-- ║ abort, and a shop would be left with half of Part 3 applied.               ║
-- ║                                                                           ║
-- ║ So the vocabulary is enforced in code (normalisePaymentTerms), and the     ║
-- ║ constraint becomes available only after the optional normalisation UPDATE  ║
-- ║ in the run report has been run. The NOT VALID form is in the report too.   ║
-- ╠═══════════════════════════════════════════════════════════════════════════╣
-- ║ THE NULL CONTRACT                                                         ║
-- ║                                                                           ║
-- ║   payment_terms NULL  -> fall back to profiles.default_payment_terms, and  ║
-- ║                          if that is NULL too, to 'net_7'                   ║
-- ║   due_date      NULL  -> NO DUE DATE IS PRINTED. Nothing derives one for   ║
-- ║                          a document already sent. An invoice that went out ║
-- ║                          without a due date must keep reading exactly as   ║
-- ║                          the customer received it.                         ║
-- ║   address_line1 NULL  -> the shop block prints city and state only, as it  ║
-- ║                          does today                                        ║
-- ╚═══════════════════════════════════════════════════════════════════════════╝
