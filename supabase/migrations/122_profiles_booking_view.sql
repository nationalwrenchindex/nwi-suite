-- Migration 122: close the public read on profiles; give the booking page a view.
--
-- ── THE BUG (C-01) ───────────────────────────────────────────────────────────
-- 003_booking.sql added this, under a comment claiming it "only exposes fields
-- needed for the booking page":
--
--     create policy "profiles: public read by slug"
--       on public.profiles for select
--       using (slug is not null);
--
-- An RLS SELECT policy filters ROWS, not COLUMNS. There is no column list in a
-- policy and no way to add one — USING decides whether a row is visible at all,
-- and once it is, every column of that row is visible. So the policy did not
-- expose "fields needed for the booking page"; it exposed the entire profiles
-- row, all of it, to the anon key that ships in the browser bundle.
--
-- Verified live before writing this: 5 of the 8 profiles rows (the ones that had
-- set a slug) were readable with the public anon key, including email, phone,
-- default_labor_rate, default_tax_percent and hd_labor_rate. Those last three are
-- the subscriber's own buy-side pricing — the numbers a competitor would pay for
-- and a customer would argue with. Nothing about the booking flow needs them.
--
-- ── THE FIX ──────────────────────────────────────────────────────────────────
-- Move the public surface off the table and onto a view that has the column list
-- the policy could not express, then drop the policy. Column-level GRANTs were the
-- other option and were rejected: a grant list on profiles has to be re-stated
-- every time a column is added, and the failure mode of forgetting is the same
-- leak we are fixing here. A view names the columns positively — a new column on
-- profiles is private by default and stays private until someone edits this file.

-- ── WHY security_invoker = off ───────────────────────────────────────────────
-- Postgres 15 added security_invoker on views and it defaults to OFF, meaning the
-- view's own query runs as the view's OWNER rather than as the caller. Supabase
-- runs migrations as `postgres`, which owns public.profiles, and a table's owner
-- is exempt from that table's RLS (we have not set FORCE ROW LEVEL SECURITY on
-- profiles). So a postgres-owned definer view reads profiles without consulting
-- RLS at all, which is exactly what lets us delete the anon policy and still serve
-- the booking page.
--
-- Being explicit rather than leaning on the default is deliberate. Supabase's own
-- guidance is to set security_invoker = TRUE on public views precisely so they do
-- NOT become RLS bypasses by accident, and the linter flags definer views for that
-- reason. This one is an intentional exception and says so in the SQL, so nobody
-- "fixes" it later by flipping the flag — flipping it to true would make the view
-- honor profiles' RLS, find no anon-readable policy (we drop it below), and return
-- zero rows to every booking visitor.
--
-- The bypass is safe here only because the view's column list is the whole
-- security boundary. Anything added to the SELECT below is published to the
-- internet the moment this file runs. Treat that list as a public API.
--
-- security_barrier is set alongside it. The view hides rows (slug IS NULL never
-- comes through), and PostgREST lets an anon caller append arbitrary filters to
-- the query string; the barrier stops a qualifying predicate from being pushed
-- below the slug filter and evaluated against rows the caller cannot see. On a
-- table this size the planner cost is irrelevant.

CREATE OR REPLACE VIEW public.profiles_booking
WITH (security_invoker = off, security_barrier = true) AS
SELECT
  id,
  slug,
  -- Identity and branding shown in the booking page header.
  business_name,
  full_name,
  -- Kept per spec, but flagged: profiles.phone is the technician's own
  -- notification number, and src/app/book/[techSlug]/page.tsx explicitly strips
  -- it from the branding object with the comment "this page is public". Nothing
  -- reads it through this view today. If that stays true it should come out.
  phone,
  -- Service area: the description and the geo center/radius the scheduler uses
  -- to tell a visitor whether their address is inside the coverage zone.
  service_area_description,
  service_area_radius_miles,
  service_area_lat,
  service_area_lng,
  -- jsonb; drives which time slots the picker offers.
  working_hours,
  business_logo_url,
  hd_company_logo_url,
  avatar_url,
  -- Shapes the service menu (mechanic vs detailer) and the MPI opt-in checkbox.
  profession_type,
  business_type,
  offer_mpi_on_booking,
  -- The one pricing column kept, per spec, for booking-time estimates. Note that
  -- no reader currently selects it through this view, so it can be deleted from
  -- the list without touching a caller if that estimate never ships. Its siblings
  -- default_tax_percent, default_parts_markup_percent, hd_parts_markup_percent
  -- and hd_labor_rate are deliberately NOT here.
  default_labor_rate
FROM public.profiles
WHERE slug IS NOT NULL;

-- Explicit for the same reason the flag above is explicit: the definer bypass is
-- only correct while postgres owns this view. If some other role ever creates it,
-- the view reads profiles as that role, hits RLS, and silently returns nothing.
ALTER VIEW public.profiles_booking OWNER TO postgres;

COMMENT ON VIEW public.profiles_booking IS
  'Public booking surface for profiles. Definer view (security_invoker = off) owned by postgres, so it reads profiles without RLS — the SELECT column list IS the security boundary and every column here is world-readable via the anon key. Never add email, tax/markup/labor-rate columns beyond default_labor_rate, Stripe or addon columns, or any *_stripe_subscription_id. See migration 122.';

GRANT SELECT ON public.profiles_booking TO anon, authenticated;

-- ── Drop the overbroad policy ────────────────────────────────────────────────
-- Safe: every current reader of profiles-by-slug goes through createServiceClient,
-- which uses the service_role key and bypasses RLS entirely. Confirmed by grep at
-- the time of writing — the only three slug lookups in the codebase are
--   src/app/book/[techSlug]/page.tsx:25   (createServiceClient)
--   src/app/api/book/[slug]/route.ts:108  (createServiceClient, GET)
--   src/app/api/book/[slug]/route.ts:217  (createServiceClient, POST)
-- and none of them is rewritten to use this view, on purpose: the POST handler
-- reads profiles.email and sms_booking_notifications_enabled to notify the tech of
-- a new booking, and those must stay off the public surface. A service-role read of
-- the base table is the right tool for a server-side job that legitimately needs
-- private columns; the view exists for anything running under an anon session.
DROP POLICY IF EXISTS "profiles: public read by slug" ON public.profiles;

-- ── Verification: what anon can and cannot reach after this runs ─────────────
-- CAN:    SELECT on public.profiles_booking — the 17 columns listed above, and
--         only for rows where slug IS NOT NULL. Everything the booking page and
--         /api/book/[slug] render is still reachable.
-- CANNOT: SELECT on public.profiles at all. RLS stays enabled and the only
--         remaining SELECT policy is "profiles: select own" (auth.uid() = id),
--         which matches nothing for anon because auth.uid() is NULL. So email,
--         default_tax_percent, hd_labor_rate, default_parts_markup_percent,
--         hd_parts_markup_percent, share_* templates, foreman_stripe_subscription_id
--         and every future column are no longer publicly readable.
-- CANNOT: write anything. This grants SELECT only; the view is auto-updatable in
--         principle, but no INSERT/UPDATE/DELETE is granted on it and the base
--         table's "profiles: update own" policy still requires auth.uid() = id.
-- Authenticated users are unaffected: they keep full row access to their own
-- profile through "profiles: select own", and also get the view.
--
-- Re-runnability: CREATE OR REPLACE VIEW keeps the grants and is safe to re-run,
-- and DROP POLICY IF EXISTS no-ops after the first run. One caveat for whoever
-- edits this next — CREATE OR REPLACE VIEW can only APPEND columns; removing or
-- reordering one requires DROP VIEW public.profiles_booking; first, after which
-- the GRANT and OWNER lines above must run again.

-- PostgREST caches the schema; Supabase reloads it on DDL automatically, but this
-- makes the view queryable over the REST API immediately rather than on the next
-- reload.
NOTIFY pgrst, 'reload schema';
