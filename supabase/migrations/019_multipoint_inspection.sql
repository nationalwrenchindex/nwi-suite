-- ============================================================
-- Migration: 019_multipoint_inspection.sql
-- Adds multi-point inspection tables and supporting columns
-- ============================================================

-- Mechanic opt-in setting for offering MPI on booking page
alter table public.profiles
  add column if not exists offer_mpi_on_booking boolean not null default false;

-- Flag on jobs so the scheduler card can badge the request
alter table public.jobs
  add column if not exists inspection_requested boolean not null default false;

-- ─── inspections ─────────────────────────────────────────────────────────────

create table public.inspections (
  id                    uuid        primary key default gen_random_uuid(),
  job_id                uuid        not null references public.jobs(id) on delete cascade,
  mechanic_id           uuid        not null references public.profiles(id),
  customer_id           uuid        references public.customers(id),
  status                text        not null default 'pending'
                          check (status in ('pending', 'in_progress', 'completed')),
  requested_by_customer boolean     not null default false,
  labor_charge_applied  boolean     not null default true,
  created_at            timestamptz not null default now(),
  completed_at          timestamptz
);

alter table public.inspections enable row level security;

create policy "mechanic_own_inspections"
  on public.inspections for all
  using  (auth.uid() = mechanic_id)
  with check (auth.uid() = mechanic_id);

-- ─── inspection_items ─────────────────────────────────────────────────────────
-- Seeded with all 25 points (not_checked) when the inspection record is created.

create table public.inspection_items (
  id                  uuid    primary key default gen_random_uuid(),
  inspection_id       uuid    not null references public.inspections(id) on delete cascade,
  point_number        integer not null,
  point_name          text    not null,
  category            text    not null
                        check (category in ('fluids_engine', 'tires_wheels', 'brakes_underside', 'lights_safety')),
  status              text    not null default 'not_checked'
                        check (status in ('not_checked', 'pass', 'fail', 'needs_attention')),
  notes               text,
  mapped_service_name text
);

alter table public.inspection_items enable row level security;

create policy "mechanic_own_inspection_items"
  on public.inspection_items for all
  using (
    exists (
      select 1 from public.inspections i
      where i.id = inspection_id
        and i.mechanic_id = auth.uid()
    )
  )
  with check (
    exists (
      select 1 from public.inspections i
      where i.id = inspection_id
        and i.mechanic_id = auth.uid()
    )
  );
