-- Detailer service pricing: one row per (profile, service, vehicle_category)
create table if not exists public.detailer_service_pricing (
  id               uuid        primary key default gen_random_uuid(),
  profile_id       uuid        not null references public.profiles(id) on delete cascade,
  service_name     text        not null,
  vehicle_category text        not null
    constraint detailer_service_pricing_vc_check check (
      vehicle_category in ('sedan', 'suv', 'truck', 'van', 'motorcycle', 'boat', 'rv', 'plane', 'other')
    ),
  base_price       numeric     not null default 0,
  estimated_hours  numeric     not null default 1,
  is_offered       boolean     not null default true,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now(),
  unique (profile_id, service_name, vehicle_category)
);

create index if not exists detailer_service_pricing_profile_id_idx
  on public.detailer_service_pricing(profile_id);

alter table public.detailer_service_pricing enable row level security;

create policy "detailers_select_own_pricing"
  on public.detailer_service_pricing for select
  using (auth.uid() = profile_id);

create policy "detailers_insert_own_pricing"
  on public.detailer_service_pricing for insert
  with check (auth.uid() = profile_id);

create policy "detailers_update_own_pricing"
  on public.detailer_service_pricing for update
  using (auth.uid() = profile_id);

create policy "detailers_delete_own_pricing"
  on public.detailer_service_pricing for delete
  using (auth.uid() = profile_id);

-- Detailer add-on pricing per service
create table if not exists public.detailer_service_addons (
  id                  uuid        primary key default gen_random_uuid(),
  profile_id          uuid        not null references public.profiles(id) on delete cascade,
  parent_service_name text        not null,
  addon_name          text        not null,
  addon_price         numeric     not null default 0,
  is_offered          boolean     not null default true,
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now()
);

create index if not exists detailer_service_addons_profile_id_idx
  on public.detailer_service_addons(profile_id);

alter table public.detailer_service_addons enable row level security;

create policy "detailers_select_own_addons"
  on public.detailer_service_addons for select
  using (auth.uid() = profile_id);

create policy "detailers_insert_own_addons"
  on public.detailer_service_addons for insert
  with check (auth.uid() = profile_id);

create policy "detailers_update_own_addons"
  on public.detailer_service_addons for update
  using (auth.uid() = profile_id);

create policy "detailers_delete_own_addons"
  on public.detailer_service_addons for delete
  using (auth.uid() = profile_id);
