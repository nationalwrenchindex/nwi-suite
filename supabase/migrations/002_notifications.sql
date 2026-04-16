-- ============================================================
-- National Wrench Index Suite
-- Migration: 002_notifications.sql
-- Run this in your Supabase SQL Editor
-- ============================================================

-- Add on_my_way to the notification_template_type enum
-- (IF NOT EXISTS guard prevents error on re-run)
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_enum
    WHERE enumlabel = 'on_my_way'
      AND enumtypid = 'public.notification_template_type'::regtype
  ) THEN
    ALTER TYPE public.notification_template_type ADD VALUE 'on_my_way';
  END IF;
END;
$$;


-- ============================================================
-- NOTIFICATION LOGS
-- Audit trail of every sent/failed notification
-- ============================================================
create table if not exists public.notification_logs (
  id           uuid        default uuid_generate_v4() primary key,
  user_id      uuid        references public.profiles(id) on delete cascade not null,
  job_id       uuid        references public.jobs(id) on delete set null,
  customer_id  uuid        references public.customers(id) on delete set null,
  trigger_type text        not null,
  channel      text        not null check (channel in ('sms', 'email')),
  recipient    text        not null,
  message      text        not null,
  subject      text,
  status       text        not null default 'sent' check (status in ('sent', 'failed')),
  error        text,
  provider_id  text,       -- Twilio SID or Resend email ID
  created_at   timestamptz default now() not null
);

alter table public.notification_logs enable row level security;

create policy "notification_logs: select own"
  on public.notification_logs for select
  using (auth.uid() = user_id);

create policy "notification_logs: insert own"
  on public.notification_logs for insert
  with check (auth.uid() = user_id);

create index if not exists idx_notification_logs_user_id
  on public.notification_logs(user_id);

create index if not exists idx_notification_logs_job_id
  on public.notification_logs(job_id);

create index if not exists idx_notification_logs_created_at
  on public.notification_logs(created_at desc);

-- ============================================================
-- END OF MIGRATION
-- ============================================================
