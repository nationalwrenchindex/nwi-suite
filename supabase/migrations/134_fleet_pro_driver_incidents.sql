-- Migration 134: Fleet Pro — driver incident and complaint log.
--
-- The driver roster (131) records what a driver IS — name, CDL, medical card. This
-- records what HAPPENED: the customer complaint, the backing incident, the logged
-- hours-of-service violation. They are separate tables because they answer different
-- questions and have different lifetimes. A driver is one row that gets edited; an
-- incident is an append-only fact about a date that must never be edited away.
--
-- WHY NOT fleet_pro_drivers.notes
-- That column already exists and was the obvious home. It is wrong for this:
--   * one text blob cannot be counted, so "open complaints" has no query;
--   * it has no date, so nothing can be windowed to "this month" or aged out;
--   * it has no resolved flag, so a handled complaint and a live one read the same;
--   * concurrent edits to one blob lose each other, and a complaint log is exactly
--     the thing two managers append to on the same afternoon.
-- notes stays what it is — a free-text scratchpad about the person.
--
-- PERSONAL DATA — READ SCOPE IS DELIBERATELY NO WIDER THAN THE DRIVER'S.
-- 131 reasoned that CDL numbers and medical certificate dates are personal data and
-- scoped fleet_pro_drivers to the fleet and nothing wider. An incident row is a
-- written allegation about a named person's conduct — at least as sensitive as their
-- licence number, and considerably more damaging if it leaks to the wrong fleet. The
-- policies below are therefore the SAME four-audience shape as fleet_pro_drivers,
-- copied rather than loosened. In particular the partner arm is SELECT-only, matching
-- 131: a reselling partner runs the compliance service and can see the record, but
-- writing an allegation about somebody else's driver is not a thing he does.
--
-- NO created_by AUDIT COLUMN, AND THAT IS A KNOWN GAP.
-- fleet_pro_drivers has created_by. This table does not, because the brief did not
-- ask for it and inventing a column the API never populates is worse than not having
-- one. It should be added before this log is ever used in an employment dispute,
-- where "who wrote this and when" is the first question asked.


-- ── 1. Incidents ─────────────────────────────────────────────────────────────
-- driver_id is NOT NULL and CASCADEs, for the reason 131 gives for the driver row
-- itself: an incident has no meaning detached from the person it is about, and a
-- SET NULL would strand an allegation in a row nobody's RLS can reach and nobody can
-- delete. When a driver is purged, what was written about them goes too.
--
-- fleet_account_id is likewise NOT NULL and CASCADE. It is denormalized onto the row
-- — the same call 115 and 131 made — so every policy below is a column comparison
-- instead of a join through fleet_pro_drivers on every row. The server writes it from
-- the driver, never from the request body.
CREATE TABLE IF NOT EXISTS public.fleet_pro_driver_incidents (
  id               UUID        DEFAULT gen_random_uuid() PRIMARY KEY,
  driver_id        UUID        NOT NULL REFERENCES public.fleet_pro_drivers(id)  ON DELETE CASCADE,
  fleet_account_id UUID        NOT NULL REFERENCES public.hd_fleet_accounts(id)  ON DELETE CASCADE,

  -- The date the thing happened, which is not the date it was entered. A complaint
  -- phoned in on Friday about Tuesday's delivery is a Tuesday incident, and the
  -- scorecard windows on this column.
  incident_date    DATE        NOT NULL DEFAULT CURRENT_DATE,

  -- Closed vocabulary, enforced here rather than only in the API. These four are not
  -- interchangeable: 'accident' has DOT reporting consequences, 'policy_violation' is
  -- an internal HR matter, and a free-text kind would let the UI file one as the
  -- other. 'other' exists so a real event is never lost for want of a category.
  incident_type    TEXT        NOT NULL CHECK (incident_type IN (
                                 'complaint','accident','policy_violation','other'
                               )),

  -- NOT NULL and non-empty: an incident with no description is a row that can only
  -- mislead — it inflates the open-complaint count while telling nobody what happened.
  description      TEXT        NOT NULL CHECK (char_length(btrim(description)) BETWEEN 1 AND 4000),

  resolved         BOOLEAN     NOT NULL DEFAULT false,
  resolution_notes TEXT        CHECK (resolution_notes IS NULL OR char_length(resolution_notes) <= 4000),

  created_at       TIMESTAMPTZ DEFAULT NOW() NOT NULL,
  updated_at       TIMESTAMPTZ DEFAULT NOW() NOT NULL
);

COMMENT ON TABLE public.fleet_pro_driver_incidents IS
  'Complaints, accidents and policy violations logged against a Fleet Pro driver. Personal data - RLS scoped to the fleet, same as fleet_pro_drivers.';

-- The driver detail page: one driver's log, newest first.
CREATE INDEX IF NOT EXISTS idx_fleet_pro_driver_incidents_driver
  ON public.fleet_pro_driver_incidents (driver_id, incident_date DESC);

-- The scorecard's only aggregate query: open items for one driver. Partial, because
-- resolved rows are the majority in any healthy fleet and never appear in this count.
CREATE INDEX IF NOT EXISTS idx_fleet_pro_driver_incidents_open
  ON public.fleet_pro_driver_incidents (driver_id)
  WHERE resolved = false;

-- Fleet-wide review ("everything unresolved across the roster"), which the detail
-- page does not use but a future manager dashboard will.
CREATE INDEX IF NOT EXISTS idx_fleet_pro_driver_incidents_account
  ON public.fleet_pro_driver_incidents (fleet_account_id, incident_date DESC);


-- ── 2. RLS ───────────────────────────────────────────────────────────────────
-- The same four-audience shape as 105/106/114/131. The three SECURITY DEFINER helpers
-- (fleet_pro_account_ids and fleet_pro_managed_account_ids from 105,
-- fleet_pro_partner_account_ids from 106) already exist and are REUSED AS-IS.
-- Redefining any of them here would fork the subscription-liveness rule into two files
-- and silently hand a lapsed fleet its data back.
ALTER TABLE public.fleet_pro_driver_incidents ENABLE ROW LEVEL SECURITY;

-- The mechanic who owns the fleet account, reached through hd_fleet_accounts rather
-- than a user_id column of its own — the row is about a fleet, and the fleet already
-- knows who owns it.
DROP POLICY IF EXISTS "fleet pro driver incidents: owner manages" ON public.fleet_pro_driver_incidents;
CREATE POLICY "fleet pro driver incidents: owner manages" ON public.fleet_pro_driver_incidents
  FOR ALL TO authenticated
  USING (EXISTS (
    SELECT 1 FROM public.hd_fleet_accounts a
    WHERE a.id = fleet_pro_driver_incidents.fleet_account_id AND a.user_id = auth.uid()
  ))
  WITH CHECK (EXISTS (
    SELECT 1 FROM public.hd_fleet_accounts a
    WHERE a.id = fleet_pro_driver_incidents.fleet_account_id AND a.user_id = auth.uid()
  ));

-- Everyone on the roster reads, matching "fleet pro drivers: members read". A
-- supervisor who cannot see that a driver has three open complaints cannot supervise.
--
-- This is the widest audience an incident row reaches, and it is the same audience
-- that already reads the driver row itself. Narrowing incidents to managers only
-- would be defensible on privacy grounds, but it would then be the only fleet_pro_*
-- table with its own audience rule, and a rule that exists in one file drifts.
DROP POLICY IF EXISTS "fleet pro driver incidents: members read" ON public.fleet_pro_driver_incidents;
CREATE POLICY "fleet pro driver incidents: members read" ON public.fleet_pro_driver_incidents
  FOR SELECT TO authenticated
  USING (fleet_account_id IN (SELECT public.fleet_pro_account_ids()));

-- Only the fleet manager writes. Logging an allegation against a named person, and
-- deciding it is resolved, are both manager acts.
DROP POLICY IF EXISTS "fleet pro driver incidents: managers write" ON public.fleet_pro_driver_incidents;
CREATE POLICY "fleet pro driver incidents: managers write" ON public.fleet_pro_driver_incidents
  FOR ALL TO authenticated
  USING (fleet_account_id IN (SELECT public.fleet_pro_managed_account_ids()))
  WITH CHECK (fleet_account_id IN (SELECT public.fleet_pro_managed_account_ids()));

-- The reselling partner reads the fleets he bills for. Read only, matching 114/115/131.
DROP POLICY IF EXISTS "fleet pro driver incidents: partner reads" ON public.fleet_pro_driver_incidents;
CREATE POLICY "fleet pro driver incidents: partner reads" ON public.fleet_pro_driver_incidents
  FOR SELECT TO authenticated
  USING (fleet_account_id IN (SELECT public.fleet_pro_partner_account_ids()));
