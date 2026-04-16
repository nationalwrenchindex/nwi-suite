-- ============================================================
-- National Wrench Index Suite
-- Migration: 004_subscriptions.sql
-- Run this in your Supabase SQL Editor
-- ============================================================

create table if not exists public.subscriptions (
  id                      uuid        default uuid_generate_v4() primary key,
  user_id                 uuid        references public.profiles(id) on delete cascade not null unique,
  stripe_customer_id      text        unique,
  stripe_subscription_id  text        unique,
  status                  text        not null default 'inactive'
                          check (status in ('active','trialing','past_due','canceled','incomplete','unpaid','inactive')),
  tier                    text        check (tier in ('starter','pro','full_suite')),
  modules                 text[]      not null default '{}',
  current_period_end      timestamptz,
  cancel_at_period_end    boolean     not null default false,
  created_at              timestamptz default now() not null,
  updated_at              timestamptz default now() not null
);

alter table public.subscriptions enable row level security;

create policy "subscriptions: select own"
  on public.subscriptions for select
  using (auth.uid() = user_id);

create policy "subscriptions: insert own"
  on public.subscriptions for insert
  with check (auth.uid() = user_id);

create policy "subscriptions: update own"
  on public.subscriptions for update
  using (auth.uid() = user_id);

create index if not exists idx_subscriptions_user_id
  on public.subscriptions(user_id);

create index if not exists idx_subscriptions_stripe_customer_id
  on public.subscriptions(stripe_customer_id);

create index if not exists idx_subscriptions_stripe_subscription_id
  on public.subscriptions(stripe_subscription_id);

create trigger set_subscriptions_updated_at
  before update on public.subscriptions
  for each row execute procedure public.set_updated_at();

-- ============================================================
-- END OF MIGRATION
-- ============================================================
