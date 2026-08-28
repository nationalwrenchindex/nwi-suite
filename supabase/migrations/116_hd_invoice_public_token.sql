-- HD Suite: public (no-login) invoice payment link.
--
-- public_token is a CAPABILITY URL: possession of the token is the entire
-- authorization to view the invoice. It is minted on demand by the send flow,
-- never derived from the invoice id or invoice_number (both are guessable and
-- both are printed on paper the customer hands around).

ALTER TABLE public.hd_invoices ADD COLUMN IF NOT EXISTS public_token TEXT;

-- Partial unique index rather than a plain UNIQUE constraint: the overwhelming
-- majority of rows are NULL (drafts that were never sent), and a partial index
-- keeps those out of the btree entirely. It still guarantees that no two
-- invoices can ever collide on a live token.
CREATE UNIQUE INDEX IF NOT EXISTS idx_hd_invoices_public_token
  ON public.hd_invoices (public_token)
  WHERE public_token IS NOT NULL;

-- DELIBERATELY NOT BACKFILLED.
-- Minting on demand means a token exists only for an invoice that was actually
-- sent to a customer. Backfilling would hand every historical draft, void, and
-- internal-only invoice a live, publicly-reachable URL that nobody asked for and
-- nobody would ever audit. A row with no token has no public surface at all.

-- DELIBERATELY NO ANON RLS POLICY.
-- The LD precedent (013_invoice_finalization.sql) added
--   CREATE POLICY ... FOR SELECT USING (public_token IS NOT NULL)
-- which grants the anon role SELECT on EVERY tokened invoice row — holding one
-- customer's token is not required to read another customer's invoice; the row
-- scoping happens only in application code. That is a tenant-wide read leak
-- waiting on a single missing .eq() somewhere. It is not repeated here.
--
-- Instead, the public page reads through the SERVICE-ROLE client with an exact
-- .eq('public_token', token) filter. The service role bypasses RLS, so no anon
-- policy is needed for the feature to work — and with none present, the anon
-- key cannot read hd_invoices at all, under any query, even if a token leaks
-- into client-side code. The token filter is the only door, and it is on the
-- server.
