-- Adds 'awaiting_email' to the directory_prospects status lifecycle.
--
-- LD outreach now collects the mechanic's real email before creating their BD
-- listing, so they receive BD's login details at an address they control rather
-- than the generated @nwi-listing.com mailbox nobody can read. The new state
-- sits between consent and listing:
--
--   pending -> contacted -> awaiting_email -> yes
--                        \-> optout / no
--
-- HD is unchanged: hd_directory_prospects keeps its original status set because
-- the HD variant does not collect an email (see HD_VARIANT.collectEmail).

ALTER TABLE public.directory_prospects
  DROP CONSTRAINT IF EXISTS directory_prospects_status_check;

ALTER TABLE public.directory_prospects
  ADD CONSTRAINT directory_prospects_status_check
  CHECK (status IN ('pending', 'contacted', 'awaiting_email', 'yes', 'no', 'optout'));
