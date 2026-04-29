-- Add vehicle_category for detailer workflows (boat, RV, plane, etc.)
alter table public.vehicles
  add column if not exists vehicle_category text
  constraint vehicles_vehicle_category_check check (
    vehicle_category in ('sedan', 'suv', 'truck', 'van', 'motorcycle', 'boat', 'rv', 'plane', 'other')
  );

-- Non-VIN identifier: HIN for boats, N-number for planes, unit number for RVs
alter table public.vehicles
  add column if not exists non_vin_identifier text;

-- Condition rating on jobs: 1=Showroom 2=Good 3=Average 4=Dirty 5=Disaster
alter table public.jobs
  add column if not exists condition_rating smallint
  constraint jobs_condition_rating_check check (condition_rating between 1 and 5);

-- Store vehicle category on jobs for quick lookup without joining vehicles
alter table public.jobs
  add column if not exists vehicle_category text
  constraint jobs_vehicle_category_check check (
    vehicle_category in ('sedan', 'suv', 'truck', 'van', 'motorcycle', 'boat', 'rv', 'plane', 'other')
  );
