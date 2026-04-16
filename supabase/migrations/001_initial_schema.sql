-- ============================================================
-- National Wrench Index Suite
-- Migration: 001_initial_schema.sql
-- Run this entire file in your Supabase SQL Editor
-- ============================================================

-- Enable UUID extension (already active in most Supabase projects)
create extension if not exists "uuid-ossp";


-- ============================================================
-- PROFILES (extends auth.users)
-- One row per technician/owner account
-- ============================================================
create table public.profiles (
  id              uuid references auth.users(id) on delete cascade primary key,
  email           text unique not null,
  full_name       text,
  profession_type text check (profession_type in (
                    'mobile_mechanic', 'auto_electrician', 'diagnostician',
                    'tire_technician', 'other'
                  )),
  business_name   text,
  phone           text,
  -- Service area: human-readable description + optional geo center + radius
  service_area_description  text,
  service_area_radius_miles numeric(6,1),
  service_area_lat          numeric(10,6),
  service_area_lng          numeric(10,6),
  -- Working hours: {"monday":{"open":"08:00","close":"17:00","enabled":true}, ...}
  working_hours   jsonb    default '{}',
  avatar_url      text,
  created_at      timestamptz default now() not null,
  updated_at      timestamptz default now() not null
);

-- Auto-create a profile row whenever a new user signs up
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.profiles (id, email, full_name)
  values (
    new.id,
    new.email,
    coalesce(new.raw_user_meta_data->>'full_name', '')
  );
  return new;
end;
$$;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute procedure public.handle_new_user();


-- ============================================================
-- CUSTOMERS
-- Each technician's client roster
-- ============================================================
create table public.customers (
  id           uuid        default uuid_generate_v4() primary key,
  user_id      uuid        references public.profiles(id) on delete cascade not null,
  first_name   text        not null,
  last_name    text        not null,
  phone        text,
  email        text,
  address_line1 text,
  address_line2 text,
  city         text,
  state        text,
  zip          text,
  notes        text,
  created_at   timestamptz default now() not null,
  updated_at   timestamptz default now() not null
);


-- ============================================================
-- VEHICLES
-- Linked to a customer; one customer may have many vehicles
-- ============================================================
create table public.vehicles (
  id           uuid    default uuid_generate_v4() primary key,
  customer_id  uuid    references public.customers(id) on delete cascade not null,
  year         integer check (year between 1900 and 2100),
  make         text    not null,
  model        text    not null,
  trim         text,
  vin          text,
  color        text,
  mileage      integer,
  license_plate text,
  engine       text,
  transmission text    check (transmission in ('automatic', 'manual', 'cvt', 'other')),
  notes        text,
  created_at   timestamptz default now() not null,
  updated_at   timestamptz default now() not null
);


-- ============================================================
-- SERVICE HISTORY
-- Every service event performed on a vehicle
-- parts_used: [{name, part_number, quantity, unit_cost}]
-- ============================================================
create table public.service_history (
  id                   uuid    default uuid_generate_v4() primary key,
  vehicle_id           uuid    references public.vehicles(id) on delete cascade not null,
  service_date         date    not null,
  service_type         text    not null,
  tech_notes           text,
  mileage_at_service   integer,
  amount_charged       numeric(10,2),
  parts_used           jsonb   default '[]',
  next_service_date    date,
  next_service_mileage integer,
  created_at           timestamptz default now() not null,
  updated_at           timestamptz default now() not null
);


-- ============================================================
-- JOBS
-- Scheduled or completed work orders
-- ============================================================
create type public.job_status as enum (
  'scheduled',
  'en_route',
  'in_progress',
  'completed',
  'cancelled',
  'no_show'
);

create table public.jobs (
  id                         uuid            default uuid_generate_v4() primary key,
  user_id                    uuid            references public.profiles(id) on delete cascade not null,
  customer_id                uuid            references public.customers(id) on delete set null,
  vehicle_id                 uuid            references public.vehicles(id) on delete set null,
  job_date                   date            not null,
  job_time                   time,
  service_type               text            not null,
  status                     public.job_status default 'scheduled' not null,
  location_address           text,
  location_lat               numeric(10,6),
  location_lng               numeric(10,6),
  estimated_duration_minutes integer,
  notes                      text,
  internal_notes             text,
  created_at                 timestamptz     default now() not null,
  updated_at                 timestamptz     default now() not null
);


-- ============================================================
-- INVOICES
-- Linked to a job and a customer
-- line_items: [{description, quantity, unit_price, total}]
-- ============================================================
create type public.invoice_status as enum (
  'draft',
  'sent',
  'viewed',
  'paid',
  'overdue',
  'cancelled'
);

create type public.payment_method as enum (
  'cash',
  'card',
  'check',
  'venmo',
  'zelle',
  'paypal',
  'other'
);

create table public.invoices (
  id              uuid                   default uuid_generate_v4() primary key,
  user_id         uuid                   references public.profiles(id) on delete cascade not null,
  job_id          uuid                   references public.jobs(id) on delete set null,
  customer_id     uuid                   references public.customers(id) on delete set null,
  invoice_number  text                   not null,
  invoice_date    date                   default current_date not null,
  due_date        date,
  line_items      jsonb                  default '[]' not null,
  subtotal        numeric(10,2)          default 0 not null,
  tax_rate        numeric(6,4)           default 0,  -- e.g. 0.0875 = 8.75 %
  tax_amount      numeric(10,2)          default 0,
  discount_amount numeric(10,2)          default 0,
  total           numeric(10,2)          default 0 not null,
  status          public.invoice_status  default 'draft' not null,
  payment_method  public.payment_method,
  paid_at         timestamptz,
  notes           text,
  terms           text,
  created_at      timestamptz            default now() not null,
  updated_at      timestamptz            default now() not null,
  unique(user_id, invoice_number)
);


-- ============================================================
-- EXPENSES
-- Operational costs tracked per technician
-- ============================================================
create table public.expenses (
  id           uuid    default uuid_generate_v4() primary key,
  user_id      uuid    references public.profiles(id) on delete cascade not null,
  expense_date date    not null,
  category     text    not null check (category in (
                 'parts', 'tools', 'fuel', 'insurance', 'licensing',
                 'marketing', 'software', 'training', 'vehicle_maintenance',
                 'office_supplies', 'subcontractor', 'other'
               )),
  description  text    not null,
  amount       numeric(10,2) not null,
  receipt_url  text,
  vendor       text,
  job_id       uuid    references public.jobs(id) on delete set null,
  notes        text,
  created_at   timestamptz default now() not null,
  updated_at   timestamptz default now() not null
);


-- ============================================================
-- NOTIFICATION TEMPLATES
-- Reusable SMS / email message templates per technician
-- Supported merge tags: {{customer_name}}, {{job_date}},
--   {{job_time}}, {{service_type}}, {{invoice_total}}, etc.
-- ============================================================
create type public.notification_template_type as enum (
  'appointment_reminder',
  'appointment_confirmation',
  'invoice_sent',
  'invoice_overdue',
  'job_completed',
  'follow_up',
  'custom'
);

create table public.notification_templates (
  id              uuid                                  default uuid_generate_v4() primary key,
  user_id         uuid                                  references public.profiles(id) on delete cascade not null,
  template_type   public.notification_template_type     not null,
  name            text                                  not null,
  subject         text,                                 -- email subject line
  message_content text                                  not null,
  channel         text    check (channel in ('sms', 'email', 'both')) default 'sms',
  is_active       boolean default true,
  created_at      timestamptz default now() not null,
  updated_at      timestamptz default now() not null
);


-- ============================================================
-- UPDATED_AT TRIGGER
-- Automatically keeps updated_at current on every row change
-- ============================================================
create or replace function public.set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

create trigger set_profiles_updated_at
  before update on public.profiles
  for each row execute procedure public.set_updated_at();

create trigger set_customers_updated_at
  before update on public.customers
  for each row execute procedure public.set_updated_at();

create trigger set_vehicles_updated_at
  before update on public.vehicles
  for each row execute procedure public.set_updated_at();

create trigger set_service_history_updated_at
  before update on public.service_history
  for each row execute procedure public.set_updated_at();

create trigger set_jobs_updated_at
  before update on public.jobs
  for each row execute procedure public.set_updated_at();

create trigger set_invoices_updated_at
  before update on public.invoices
  for each row execute procedure public.set_updated_at();

create trigger set_expenses_updated_at
  before update on public.expenses
  for each row execute procedure public.set_updated_at();

create trigger set_notification_templates_updated_at
  before update on public.notification_templates
  for each row execute procedure public.set_updated_at();


-- ============================================================
-- ROW LEVEL SECURITY (RLS)
-- Every user sees and modifies only their own data
-- ============================================================
alter table public.profiles              enable row level security;
alter table public.customers             enable row level security;
alter table public.vehicles              enable row level security;
alter table public.service_history       enable row level security;
alter table public.jobs                  enable row level security;
alter table public.invoices              enable row level security;
alter table public.expenses              enable row level security;
alter table public.notification_templates enable row level security;

-- ---- PROFILES ----
create policy "profiles: select own"
  on public.profiles for select
  using (auth.uid() = id);

create policy "profiles: update own"
  on public.profiles for update
  using (auth.uid() = id);

-- ---- CUSTOMERS ----
create policy "customers: select own"
  on public.customers for select
  using (auth.uid() = user_id);

create policy "customers: insert own"
  on public.customers for insert
  with check (auth.uid() = user_id);

create policy "customers: update own"
  on public.customers for update
  using (auth.uid() = user_id);

create policy "customers: delete own"
  on public.customers for delete
  using (auth.uid() = user_id);

-- ---- VEHICLES ----
-- Access is derived through customer ownership
create policy "vehicles: select own"
  on public.vehicles for select
  using (
    exists (
      select 1 from public.customers c
      where c.id = customer_id
        and c.user_id = auth.uid()
    )
  );

create policy "vehicles: insert own"
  on public.vehicles for insert
  with check (
    exists (
      select 1 from public.customers c
      where c.id = customer_id
        and c.user_id = auth.uid()
    )
  );

create policy "vehicles: update own"
  on public.vehicles for update
  using (
    exists (
      select 1 from public.customers c
      where c.id = customer_id
        and c.user_id = auth.uid()
    )
  );

create policy "vehicles: delete own"
  on public.vehicles for delete
  using (
    exists (
      select 1 from public.customers c
      where c.id = customer_id
        and c.user_id = auth.uid()
    )
  );

-- ---- SERVICE HISTORY ----
-- Access derived through vehicle → customer ownership
create policy "service_history: select own"
  on public.service_history for select
  using (
    exists (
      select 1 from public.vehicles v
      join   public.customers c on c.id = v.customer_id
      where  v.id = vehicle_id
        and  c.user_id = auth.uid()
    )
  );

create policy "service_history: insert own"
  on public.service_history for insert
  with check (
    exists (
      select 1 from public.vehicles v
      join   public.customers c on c.id = v.customer_id
      where  v.id = vehicle_id
        and  c.user_id = auth.uid()
    )
  );

create policy "service_history: update own"
  on public.service_history for update
  using (
    exists (
      select 1 from public.vehicles v
      join   public.customers c on c.id = v.customer_id
      where  v.id = vehicle_id
        and  c.user_id = auth.uid()
    )
  );

create policy "service_history: delete own"
  on public.service_history for delete
  using (
    exists (
      select 1 from public.vehicles v
      join   public.customers c on c.id = v.customer_id
      where  v.id = vehicle_id
        and  c.user_id = auth.uid()
    )
  );

-- ---- JOBS ----
create policy "jobs: select own"
  on public.jobs for select
  using (auth.uid() = user_id);

create policy "jobs: insert own"
  on public.jobs for insert
  with check (auth.uid() = user_id);

create policy "jobs: update own"
  on public.jobs for update
  using (auth.uid() = user_id);

create policy "jobs: delete own"
  on public.jobs for delete
  using (auth.uid() = user_id);

-- ---- INVOICES ----
create policy "invoices: select own"
  on public.invoices for select
  using (auth.uid() = user_id);

create policy "invoices: insert own"
  on public.invoices for insert
  with check (auth.uid() = user_id);

create policy "invoices: update own"
  on public.invoices for update
  using (auth.uid() = user_id);

create policy "invoices: delete own"
  on public.invoices for delete
  using (auth.uid() = user_id);

-- ---- EXPENSES ----
create policy "expenses: select own"
  on public.expenses for select
  using (auth.uid() = user_id);

create policy "expenses: insert own"
  on public.expenses for insert
  with check (auth.uid() = user_id);

create policy "expenses: update own"
  on public.expenses for update
  using (auth.uid() = user_id);

create policy "expenses: delete own"
  on public.expenses for delete
  using (auth.uid() = user_id);

-- ---- NOTIFICATION TEMPLATES ----
create policy "notification_templates: select own"
  on public.notification_templates for select
  using (auth.uid() = user_id);

create policy "notification_templates: insert own"
  on public.notification_templates for insert
  with check (auth.uid() = user_id);

create policy "notification_templates: update own"
  on public.notification_templates for update
  using (auth.uid() = user_id);

create policy "notification_templates: delete own"
  on public.notification_templates for delete
  using (auth.uid() = user_id);


-- ============================================================
-- INDEXES
-- Covering the most common query patterns
-- ============================================================
create index idx_customers_user_id              on public.customers(user_id);
create index idx_vehicles_customer_id           on public.vehicles(customer_id);
create index idx_service_history_vehicle_id     on public.service_history(vehicle_id);
create index idx_service_history_service_date   on public.service_history(service_date);
create index idx_jobs_user_id                   on public.jobs(user_id);
create index idx_jobs_customer_id               on public.jobs(customer_id);
create index idx_jobs_vehicle_id                on public.jobs(vehicle_id);
create index idx_jobs_job_date                  on public.jobs(job_date);
create index idx_jobs_status                    on public.jobs(status);
create index idx_invoices_user_id               on public.invoices(user_id);
create index idx_invoices_customer_id           on public.invoices(customer_id);
create index idx_invoices_job_id                on public.invoices(job_id);
create index idx_invoices_status                on public.invoices(status);
create index idx_invoices_invoice_date          on public.invoices(invoice_date);
create index idx_expenses_user_id               on public.expenses(user_id);
create index idx_expenses_expense_date          on public.expenses(expense_date);
create index idx_expenses_category              on public.expenses(category);
create index idx_notification_templates_user_id on public.notification_templates(user_id);

-- ============================================================
-- END OF MIGRATION
-- ============================================================
