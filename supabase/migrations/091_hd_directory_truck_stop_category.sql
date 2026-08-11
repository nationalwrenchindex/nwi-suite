-- Adds 'truck_stop' to the hd_directory_prospects service_category taxonomy.
--
-- 089 shipped the category list before truck stops were a distinct target: they
-- were covered by the 'shop' bucket alongside repair shops. The one-time bulk
-- import (src/scripts/import-truck-stops.ts) files chain locations under their
-- own category, so the CHECK has to allow it — without this the import fails
-- every insert with a constraint violation.
--
-- Existing rows are untouched; nothing currently uses 'truck_stop'.

ALTER TABLE public.hd_directory_prospects
  DROP CONSTRAINT IF EXISTS hd_directory_prospects_service_category_check;

ALTER TABLE public.hd_directory_prospects
  ADD CONSTRAINT hd_directory_prospects_service_category_check
  CHECK (service_category IN (
    'truck', 'trailer', 'reefer', 'tire', 'fuel',
    'towing', 'washout', 'glass', 'locksmith', 'shop', 'truck_stop'
  ));
