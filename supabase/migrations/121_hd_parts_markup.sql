-- Migration 121: the HD suite gets its own parts markup default.
--
-- Until now both suites seeded their parts markup from
-- profiles.default_parts_markup_percent. That column defaults to 20, it is the
-- number LD Settings writes to, and it is what the LD side bills from. The HD
-- brief specifies 30 — so the shared column quietly produced the wrong answer for
-- every subscriber who had ever opened LD Settings: HD forms opened at 20 while
-- the constant in src/lib/hd/parts-pricing.ts said 30, and only subscribers who
-- had never saved a markup ever saw the HD number.
--
-- ── WHY A SEPARATE COLUMN AND NOT A CHANGED DEFAULT ──────────────────────────
-- The obvious "fix" is to bump default_parts_markup_percent to 30. It would be a
-- silent repricing of every LD quote and invoice a subscriber writes from that
-- day forward — the LD forms read the same column, and nobody asked for LD to
-- move. Light-duty and heavy-duty parts carry genuinely different margins, so the
-- two suites want two numbers, not one number that both fight over.
--
-- ── WHY NULLABLE ─────────────────────────────────────────────────────────────
-- NULL means "never set for this subscriber" and every reader falls back to 30.
-- Postgres 11+ backfills a non-volatile DEFAULT into existing rows without a
-- table rewrite, so live profiles land on 30 immediately rather than on a NULL
-- that each call site has to remember to coalesce.
--
-- Range: 0-99 is enforced in /api/user/profile, not by a CHECK here. NUMERIC(5,2)
-- leaves headroom (up to 999.99) so a future policy change that allows a 150%
-- markup on a hard-to-source part is an API edit, not a migration.

ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS hd_parts_markup_percent NUMERIC(5,2) DEFAULT 30;

COMMENT ON COLUMN public.profiles.hd_parts_markup_percent IS
  'Default parts markup percent for the HD suite (quotes, invoices, work orders). Deliberately separate from default_parts_markup_percent, which is the LD default and which LD bills from — HD parts carry a different margin and changing the LD column would silently reprice every LD quote. NULL means never set; readers fall back to 30 (DEFAULT_HD_PARTS_MARKUP).';
