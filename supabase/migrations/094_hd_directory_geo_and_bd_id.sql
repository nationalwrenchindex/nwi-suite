-- Columns the truck-stop enrichment pass needs.
--
-- lat/lon: Google Places returns coordinates but nothing ever stored or
-- forwarded them, so every auto-listed venue sits on the directory with
-- lat:null / lon:null and cannot appear in a map or radius search. Storing them
-- locally also makes enrichment idempotent — a re-run does not re-pay Places.
--
-- bd_user_id: BD returns message.user_id on create and we discarded it, so
-- there is no stored handle for updating a listing later. Backfilled by the
-- enrichment script and captured going forward.

ALTER TABLE public.hd_directory_prospects
  ADD COLUMN IF NOT EXISTS lat         NUMERIC,
  ADD COLUMN IF NOT EXISTS lon         NUMERIC,
  ADD COLUMN IF NOT EXISTS bd_user_id  TEXT,
  ADD COLUMN IF NOT EXISTS enriched_at TIMESTAMPTZ;

-- The enrichment script's work queue: listed venues not yet enriched.
CREATE INDEX IF NOT EXISTS hd_directory_prospects_enrich_idx
  ON public.hd_directory_prospects (service_category, enriched_at)
  WHERE bd_listing_created = TRUE;
