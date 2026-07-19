-- 073_landscaping_tables.sql
-- Landscaping vertical: chemical application logs, property before/after photos,
-- and seasonal service tracking. All tables RLS-scoped to the owning user.

-- ─────────────────────────────────────────────────────────────
-- Table 1: lawn_chemical_logs  (Part 13)
-- ─────────────────────────────────────────────────────────────
create table if not exists public.lawn_chemical_logs (
  id                       uuid primary key default gen_random_uuid(),
  user_id                  uuid not null references auth.users(id) on delete cascade,
  job_id                   uuid references public.jobs(id) on delete set null,
  product_name             text not null,
  product_epa_number       text,
  application_rate         text,
  target_area              text,
  target_pest_or_weed      text,
  application_date         date not null default current_date,
  re_entry_interval_hours  integer,
  applied_by               uuid references auth.users(id),
  notes                    text,
  created_at               timestamptz not null default now()
);

create index if not exists idx_lawn_chemical_logs_user on public.lawn_chemical_logs(user_id);
create index if not exists idx_lawn_chemical_logs_job  on public.lawn_chemical_logs(job_id);

alter table public.lawn_chemical_logs enable row level security;

do $$ begin
  create policy "lawn_chemical_logs: all own" on public.lawn_chemical_logs
    for all using (auth.uid() = user_id) with check (auth.uid() = user_id);
exception when duplicate_object then null; end $$;

-- ─────────────────────────────────────────────────────────────
-- Table 2: lawn_property_photos  (Part 12)
-- ─────────────────────────────────────────────────────────────
create table if not exists public.lawn_property_photos (
  id           uuid primary key default gen_random_uuid(),
  job_id       uuid not null references public.jobs(id) on delete cascade,
  user_id      uuid not null references auth.users(id) on delete cascade,
  photo_type   text not null check (photo_type in ('before', 'after')),
  storage_path text not null,
  created_at   timestamptz not null default now()
);

create index if not exists idx_lawn_property_photos_job  on public.lawn_property_photos(job_id);
create index if not exists idx_lawn_property_photos_user on public.lawn_property_photos(user_id);

alter table public.lawn_property_photos enable row level security;

do $$ begin
  create policy "lawn_property_photos: all own" on public.lawn_property_photos
    for all using (auth.uid() = user_id) with check (auth.uid() = user_id);
exception when duplicate_object then null; end $$;

-- ─────────────────────────────────────────────────────────────
-- Table 3: lawn_seasonal_log  (Part 14)
-- user_id added (beyond the spec) so RLS can scope to the owner.
-- ─────────────────────────────────────────────────────────────
create table if not exists public.lawn_seasonal_log (
  id           uuid primary key default gen_random_uuid(),
  user_id      uuid not null references auth.users(id) on delete cascade,
  customer_id  uuid references public.customers(id) on delete cascade,
  service_type text not null,
  season       text,
  year         integer,
  completed_at timestamptz,
  notes        text,
  created_at   timestamptz not null default now()
);

create index if not exists idx_lawn_seasonal_log_user     on public.lawn_seasonal_log(user_id);
create index if not exists idx_lawn_seasonal_log_customer on public.lawn_seasonal_log(customer_id);

alter table public.lawn_seasonal_log enable row level security;

do $$ begin
  create policy "lawn_seasonal_log: all own" on public.lawn_seasonal_log
    for all using (auth.uid() = user_id) with check (auth.uid() = user_id);
exception when duplicate_object then null; end $$;

-- ─────────────────────────────────────────────────────────────
-- Storage bucket for property photos (private; owner-scoped by folder)
-- Mirrors the business-logos pattern (migration 055).
-- ─────────────────────────────────────────────────────────────
insert into storage.buckets (id, name, public)
values ('property-photos', 'property-photos', false)
on conflict (id) do nothing;

do $$ begin
  create policy "property-photos: owner read" on storage.objects
    for select using (
      bucket_id = 'property-photos'
      and (storage.foldername(name))[1] = auth.uid()::text
    );
exception when duplicate_object then null; end $$;

do $$ begin
  create policy "property-photos: owner insert" on storage.objects
    for insert with check (
      bucket_id = 'property-photos'
      and (storage.foldername(name))[1] = auth.uid()::text
    );
exception when duplicate_object then null; end $$;

do $$ begin
  create policy "property-photos: owner delete" on storage.objects
    for delete using (
      bucket_id = 'property-photos'
      and (storage.foldername(name))[1] = auth.uid()::text
    );
exception when duplicate_object then null; end $$;
