-- Migration 117: per-customer contact suppression.
--
-- A customer can tell the mechanic "stop texting me" or "email only". Until now
-- there was nowhere to record that, so the only way to honour it was to delete
-- the customer's phone number off their row — which also broke the mechanic's
-- ability to call them about a job in progress. These flags separate "we do not
-- have a number" from "we have one and are choosing not to use it".
--
-- These are SUPPRESSION flags, not consent flags. The distinction is the whole
-- reason for the DEFAULT below.

ALTER TABLE public.customers
  -- DEFAULT false on both, deliberately.
  --
  -- The alternative modelling — an opt-IN consent column defaulting to false —
  -- would be the safer-looking choice and it is the wrong one here. Every
  -- existing customer row predates this migration and therefore carries no
  -- recorded preference. Under opt-in semantics, the instant this migration ran
  -- every one of those rows would read as "do not contact", and a working
  -- business's invoices, reminders and review requests would all stop going out
  -- silently, with no error anywhere and nothing in the UI to explain it. The
  -- mechanic would discover it from unpaid invoices weeks later.
  --
  -- Defaulting to false means the migration is a no-op for behaviour: every
  -- customer keeps working exactly as they did the day before, and suppression
  -- only ever exists because a human explicitly set it.
  ADD COLUMN IF NOT EXISTS no_email                  BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS no_sms                    BOOLEAN NOT NULL DEFAULT false,

  -- Free text for WHY, e.g. "asked to be text-only at the Mar 3 visit". Kept
  -- alongside the flags rather than folded into customers.notes so the reason a
  -- channel is off travels with the switch that turned it off — a flag with no
  -- recorded reason is the thing that gets flipped back on by the next person.
  ADD COLUMN IF NOT EXISTS contact_prefs_note        TEXT,

  -- NULL until someone actually sets a preference. That NULL is meaningful: it
  -- distinguishes "never asked" from "asked, and they said contact is fine",
  -- which read identically in the two booleans above.
  ADD COLUMN IF NOT EXISTS contact_prefs_updated_at  TIMESTAMPTZ;


-- NO NEW RLS POLICY, ON PURPOSE.
--
-- public.customers already has row level security enabled with four owner
-- policies from migration 001 (select/insert/update/delete, each
-- `auth.uid() = user_id`). These columns are new columns on that same table, so
-- they inherit that scoping exactly: a mechanic can read and write contact
-- preferences on their own customers and cannot see anyone else's.
--
-- Postgres OR's permissive policies together, so adding a policy here would only
-- ever WIDEN access beyond those four — never narrow it. There is nothing to add
-- and something to lose, so nothing is added. Confirmed against 001, not assumed.


-- Partial index: the read path is "is this one customer suppressed", which is
-- already served by the primary key. This index serves the other question —
-- "show me every customer I am currently suppressing" — for the settings/audit
-- view. Partial because in any healthy roster the overwhelming majority of rows
-- have both flags false and do not belong in the btree at all.
CREATE INDEX IF NOT EXISTS idx_customers_contact_suppressed
  ON public.customers (user_id)
  WHERE no_email OR no_sms;


COMMENT ON COLUMN public.customers.no_email IS
  'Suppression flag: true means never send this customer automated email. Defaults false so existing customers keep receiving mail.';
COMMENT ON COLUMN public.customers.no_sms IS
  'Suppression flag: true means never send this customer automated SMS. Defaults false so existing customers keep receiving texts.';
COMMENT ON COLUMN public.customers.contact_prefs_note IS
  'Why the flags above are set — free text, shown next to the switches.';
COMMENT ON COLUMN public.customers.contact_prefs_updated_at IS
  'When a preference was last set. NULL means never asked, which is distinct from asked-and-allowed.';
