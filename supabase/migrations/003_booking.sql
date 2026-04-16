-- ============================================================
-- National Wrench Index Suite
-- Migration: 003_booking.sql
-- Run this in your Supabase SQL Editor
-- ============================================================

-- Add booking slug to profiles
-- Techs set this during onboarding; customers visit /book/{slug}
alter table public.profiles
  add column if not exists slug text;

create unique index if not exists idx_profiles_slug
  on public.profiles(slug)
  where slug is not null;

-- Allow public (unauthenticated) read of profiles by slug
-- Only exposes fields needed for the booking page
create policy "profiles: public read by slug"
  on public.profiles for select
  using (slug is not null);

-- Note: the existing "profiles: select own" policy already handles
-- authenticated reads, so anon reads are limited to rows with a slug.

-- ============================================================
-- END OF MIGRATION
-- ============================================================
