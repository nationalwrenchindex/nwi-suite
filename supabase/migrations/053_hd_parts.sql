-- HD Parts Database
-- hd_parts: master parts catalog (TK, Carrier, Delco Remy, generic)
-- hd_parts_cross_ref: supersession chains and OEM cross-references

create table if not exists public.hd_parts (
  id              uuid primary key default gen_random_uuid(),
  part_number     text not null unique,
  manufacturer    text not null check (manufacturer in ('Thermo King', 'Carrier Transicold', 'Delco Remy', 'Generic')),
  description     text not null,
  category        text not null,
  unit_models     text[] not null default '{}',
  notes           text,
  superseded_by   text,
  field_critical  boolean not null default false,
  created_at      timestamptz not null default now()
);

create table if not exists public.hd_parts_cross_ref (
  id              uuid primary key default gen_random_uuid(),
  part_number     text not null references public.hd_parts(part_number) on delete cascade,
  cross_mfr       text not null,
  cross_part      text not null,
  cross_notes     text,
  created_at      timestamptz not null default now()
);

-- Indexes
create index if not exists hd_parts_manufacturer_idx on public.hd_parts(manufacturer);
create index if not exists hd_parts_category_idx     on public.hd_parts(category);
create index if not exists hd_parts_part_number_idx  on public.hd_parts(part_number);
create index if not exists hd_parts_cross_ref_part_number_idx on public.hd_parts_cross_ref(part_number);

-- RLS
alter table public.hd_parts         enable row level security;
alter table public.hd_parts_cross_ref enable row level security;

-- All authenticated users can read parts
create policy "Authenticated users can read hd_parts"
  on public.hd_parts for select
  to authenticated
  using (true);

create policy "Authenticated users can read hd_parts_cross_ref"
  on public.hd_parts_cross_ref for select
  to authenticated
  using (true);
