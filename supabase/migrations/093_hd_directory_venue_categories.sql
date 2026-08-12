-- Adds 'fuel_station' and 'rest_area' to the hd_directory_prospects taxonomy.
--
-- These join 'truck_stop' as *venue* categories: fixed highway locations that
-- are auto-listed on discovery rather than invited by SMS. They are distinct
-- from the service-business categories they would otherwise be confused with:
--
--   'fuel'  is mobile fuel DELIVERY — an operator who drives to a stranded
--           truck. Those are small businesses that must still be invited.
--   'shop'  is repair shops and fleet maintenance, likewise invited.
--
-- Without separate categories, auto-listing "fuel stations" would publish every
-- mobile fuel-delivery operator we have found, and auto-listing "truck stops"
-- would publish every repair shop, since the 'truck stop' search term was
-- previously filed under 'shop'.

ALTER TABLE public.hd_directory_prospects
  DROP CONSTRAINT IF EXISTS hd_directory_prospects_service_category_check;

ALTER TABLE public.hd_directory_prospects
  ADD CONSTRAINT hd_directory_prospects_service_category_check
  CHECK (service_category IN (
    'truck', 'trailer', 'reefer', 'tire', 'fuel',
    'towing', 'washout', 'glass', 'locksmith', 'shop',
    'truck_stop', 'fuel_station', 'rest_area'
  ));
