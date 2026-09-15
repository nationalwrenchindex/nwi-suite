-- Migration 131: Fleet Pro — DOT & compliance calendar.
--
-- PM (105) and plate renewal (114) each track ONE recurring deadline. A DOT-regulated
-- fleet lives under a dozen of them at once, attached to three different subjects, and
-- the one that puts a truck out of service is always the one nobody was looking at:
--
--   per unit    annual DOT inspection (49 CFR 396.17, every 12 months)
--               plate / registration expiry            (already lives in 114)
--               IRP apportioned registration expiry
--   per driver  CDL expiry, DOT medical card expiry    (49 CFR 391.45)
--   per fleet   IFTA quarterly filing, HUT Form 2290, insurance certificate
--
-- WHY THREE TABLES AND NOT ONE
-- A single "compliance events" table would need a nullable unit_id AND a nullable
-- driver_id AND a free-text subject kind, which is exactly the shape that lets a CDL
-- expiry get filed against a trailer. The subject is what differs, so the subject is
-- what the schema splits on:
--
--   fleet_pro_drivers            — the driver IS the record. A CDL number and a medical
--                                  card date are attributes of a person, not documents.
--   fleet_pro_compliance_docs    — a dated document about a unit OR a driver, exactly
--                                  one, enforced by CHECK. This is the filing cabinet.
--   fleet_pro_fleet_compliance   — one row per fleet for the deadlines that belong to
--                                  the CARRIER rather than to any truck or person.
--
-- DELIBERATE NON-DUPLICATION. Two of the tracked items already have a home and are NOT
-- re-modelled here:
--   * plate/registration expiry stays in fleet_pro_unit_registration (114). The calendar
--     reads that table. A second registration date would guarantee two answers.
--   * the annual DOT inspection is DERIVED from the newest hd_dot_inspections row for
--     the unit (+ 12 months), because that row is the inspection. A compliance_docs row
--     of type annual_dot_inspection overrides the derived date, for the case where the
--     fleet had the inspection done somewhere other than through NWI.
--
-- PERSONAL DATA. fleet_pro_drivers holds CDL numbers and medical certificate dates, and
-- fleet_pro_compliance_docs points at scans of both. Read scope below is therefore the
-- same shape as every other fleet_pro_* table and no wider — and the storage bucket
-- (fleet-pro-compliance-docs, created by hand in Supabase) is PRIVATE, served only
-- through short-lived signed URLs minted server-side after the same membership check.


-- ── 1. Drivers ───────────────────────────────────────────────────────────────
-- fleet_account_id is NOT NULL here, unlike fleet_pro_unit_registration (114) where it
-- is nullable. A unit legitimately exists on the mechanic's books before it is attached
-- to a fleet; a driver does not — there is no such thing as an unattached driver record
-- in this product, and a NULL would be a row nobody's RLS can reach.
--
-- ON DELETE CASCADE for the same reason: when a department leaves, its drivers' CDL
-- numbers leave with it. SET NULL would strand personal data in an unreachable row.
CREATE TABLE IF NOT EXISTS public.fleet_pro_drivers (
  id                      UUID        DEFAULT gen_random_uuid() PRIMARY KEY,
  fleet_account_id        UUID        NOT NULL REFERENCES public.hd_fleet_accounts(id) ON DELETE CASCADE,

  full_name               TEXT        NOT NULL CHECK (char_length(btrim(full_name)) BETWEEN 1 AND 120),
  -- Not unique and not format-checked. CDL numbers are issued per jurisdiction with no
  -- common format (numeric in some states, alphanumeric in others, 7-16 characters), and
  -- a constraint that rejects a real licence would block a real driver from being tracked.
  cdl_number              TEXT        CHECK (cdl_number IS NULL OR char_length(btrim(cdl_number)) <= 32),
  -- Issuing jurisdiction. Same 2-8 rule as fleet_pro_unit_registration.jurisdiction so
  -- Canadian provinces and Mexican states are accepted.
  cdl_state               TEXT        CHECK (cdl_state IS NULL OR char_length(btrim(cdl_state)) BETWEEN 2 AND 8),
  cdl_expires_on          DATE,
  -- 49 CFR 391.45: a driver whose medical certificate has lapsed may not operate, even
  -- with a valid CDL. Two independent dates, so two columns.
  medical_card_expires_on DATE,

  phone                   TEXT        CHECK (phone IS NULL OR char_length(btrim(phone)) <= 32),
  email                   TEXT        CHECK (email IS NULL OR char_length(btrim(email)) <= 254),
  -- Soft retirement rather than DELETE. A driver who leaves still appears on last
  -- quarter's records, and deleting the row would blank that history. Inactive drivers
  -- drop out of the calendar and out of the alert digest.
  active                  BOOLEAN     NOT NULL DEFAULT true,
  notes                   TEXT        CHECK (notes IS NULL OR char_length(notes) <= 2000),

  created_by              UUID        REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at              TIMESTAMPTZ DEFAULT NOW() NOT NULL,
  updated_at              TIMESTAMPTZ DEFAULT NOW() NOT NULL
);

COMMENT ON TABLE public.fleet_pro_drivers IS
  'Fleet Pro driver roster. Holds CDL numbers and DOT medical card dates - personal data, scoped by RLS to the fleet.';

-- The roster screen: active drivers of one fleet, alphabetical.
CREATE INDEX IF NOT EXISTS idx_fleet_pro_drivers_account
  ON public.fleet_pro_drivers (fleet_account_id, active, full_name);

-- The two renewal queues. Same shape as idx_fleet_pro_registration_due (114) — the
-- nightly cron windows on exactly these, once per fleet.
CREATE INDEX IF NOT EXISTS idx_fleet_pro_drivers_cdl_due
  ON public.fleet_pro_drivers (fleet_account_id, cdl_expires_on)
  WHERE active = true;

CREATE INDEX IF NOT EXISTS idx_fleet_pro_drivers_medical_due
  ON public.fleet_pro_drivers (fleet_account_id, medical_card_expires_on)
  WHERE active = true;


-- ── 2. Compliance documents ──────────────────────────────────────────────────
-- A dated document about exactly one subject. The XOR below is the whole point of the
-- table: without it "driver 7's medical card" and "trailer 12's IRP cab card" are the
-- same row shape, and nothing stops a UI bug from filing one as the other.
CREATE TABLE IF NOT EXISTS public.fleet_pro_compliance_docs (
  id               UUID        DEFAULT gen_random_uuid() PRIMARY KEY,
  -- Denormalized onto the row so every read policy below is a column comparison rather
  -- than a join through hd_units / fleet_pro_drivers on each row. Same call 115 made.
  -- Written by the server from the subject, never from the request body.
  fleet_account_id UUID        NOT NULL REFERENCES public.hd_fleet_accounts(id) ON DELETE CASCADE,

  unit_id          UUID        REFERENCES public.hd_units(id)          ON DELETE CASCADE,
  driver_id        UUID        REFERENCES public.fleet_pro_drivers(id) ON DELETE CASCADE,

  doc_type         TEXT        NOT NULL CHECK (doc_type IN (
                                 -- unit-side
                                 'annual_dot_inspection','registration','irp',
                                 -- driver-side
                                 'cdl','medical_card',
                                 -- either
                                 'other'
                               )),

  issued_on        DATE,
  -- Nullable, and a NULL is an ALARM rather than a blank — see the comment on
  -- REGISTRATION_COLOR in src/lib/fleet-pro/registration.ts, which this calendar
  -- follows: a document whose expiry nobody can prove is as un-dispatchable as an
  -- expired one, so the classifier colors 'missing' red too.
  expires_on       DATE,

  -- STORAGE PATH inside the private fleet-pro-compliance-docs bucket, not a URL.
  -- Named file_url to match hd_work_order_photos, which stores a path under that same
  -- column name; the app mints a signed URL from it at read time. Nothing here is
  -- public — these are scans of licences and medical certificates.
  file_url         TEXT,
  file_name        TEXT        CHECK (file_name IS NULL OR char_length(file_name) <= 255),
  notes            TEXT        CHECK (notes IS NULL OR char_length(notes) <= 2000),

  created_by       UUID        REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at       TIMESTAMPTZ DEFAULT NOW() NOT NULL,
  updated_at       TIMESTAMPTZ DEFAULT NOW() NOT NULL,

  -- Exactly one subject. Never both, never neither.
  CONSTRAINT fleet_pro_compliance_docs_subject_check CHECK (
    (unit_id IS NOT NULL AND driver_id IS NULL) OR
    (unit_id IS NULL AND driver_id IS NOT NULL)
  ),

  -- And the document type has to agree with the subject it is filed against. A CDL on a
  -- trailer is a data-entry accident that would otherwise sit in the calendar forever
  -- under a unit number, which is exactly the kind of quiet wrongness this feature
  -- exists to prevent. 'other' is allowed on either side by design.
  CONSTRAINT fleet_pro_compliance_docs_type_subject_check CHECK (
    (doc_type IN ('annual_dot_inspection','registration','irp') AND unit_id   IS NOT NULL) OR
    (doc_type IN ('cdl','medical_card')                         AND driver_id IS NOT NULL) OR
    (doc_type = 'other')
  )
);

COMMENT ON TABLE public.fleet_pro_compliance_docs IS
  'Dated compliance documents for one unit OR one driver. file_url is a path in the private fleet-pro-compliance-docs bucket.';

-- The calendar's own query: everything in one fleet, soonest expiry first.
CREATE INDEX IF NOT EXISTS idx_fleet_pro_compliance_docs_due
  ON public.fleet_pro_compliance_docs (fleet_account_id, expires_on);

-- The two drill-downs — one unit's documents, one driver's documents. Partial because
-- every row has exactly one of the two set, so a plain index would be half dead entries.
CREATE INDEX IF NOT EXISTS idx_fleet_pro_compliance_docs_unit
  ON public.fleet_pro_compliance_docs (unit_id, doc_type)
  WHERE unit_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_fleet_pro_compliance_docs_driver
  ON public.fleet_pro_compliance_docs (driver_id, doc_type)
  WHERE driver_id IS NOT NULL;


-- ── 3. Carrier-level compliance ──────────────────────────────────────────────
-- IFTA, HUT 2290 and the insurance certificate belong to the MOTOR CARRIER, not to any
-- truck or person, so they cannot live in the XOR table above. One row per fleet.
--
-- IFTA and 2290 need no stored due date — they recur on a fixed calendar and the
-- classifier computes the next one. What IS stored is the acknowledgement that a filing
-- was made, so a fleet that has already filed is not nagged until the next period opens.
CREATE TABLE IF NOT EXISTS public.fleet_pro_fleet_compliance (
  id                       UUID        DEFAULT gen_random_uuid() PRIMARY KEY,
  -- UNIQUE, and it is the upsert target the PUT route names in onConflict. Without it
  -- every save would insert a second row and the calendar would read whichever came back.
  fleet_account_id         UUID        NOT NULL UNIQUE REFERENCES public.hd_fleet_accounts(id) ON DELETE CASCADE,

  insurance_carrier        TEXT        CHECK (insurance_carrier IS NULL OR char_length(btrim(insurance_carrier)) <= 120),
  insurance_policy_number  TEXT        CHECK (insurance_policy_number IS NULL OR char_length(btrim(insurance_policy_number)) <= 64),
  insurance_expires_on     DATE,
  -- The COI scan. A path in the same private bucket as the documents above.
  insurance_doc_url        TEXT,
  insurance_doc_name       TEXT        CHECK (insurance_doc_name IS NULL OR char_length(insurance_doc_name) <= 255),

  ifta_account_number      TEXT        CHECK (ifta_account_number IS NULL OR char_length(btrim(ifta_account_number)) <= 64),
  -- The last IFTA period the fleet says it filed, stored as that period's end date
  -- (e.g. 2026-06-30). A date rather than a "2026-Q2" string so it sorts and compares
  -- without parsing, and so a later quarter is simply a greater value.
  ifta_filed_through       DATE,
  -- Form 2290's tax period runs July 1 - June 30 and is identified by its starting year.
  -- Storing the year rather than a filing date means "filed for 2026" survives a re-file.
  hut_2290_filed_for_year  INTEGER     CHECK (hut_2290_filed_for_year IS NULL OR hut_2290_filed_for_year BETWEEN 2000 AND 2100),

  notes                    TEXT        CHECK (notes IS NULL OR char_length(notes) <= 2000),

  -- DEDUPE for the nightly digest, the same job alert_sent_for does for PM in 105. The
  -- key is a fingerprint of the exact item set that was reported; if nothing has changed
  -- the fleet is not emailed again. A fingerprint rather than a date stamp because a
  -- compliance digest is a SET, not one due date — a newly expiring CDL has to re-arm
  -- the alert even though yesterday's email already went out.
  alert_sent_at            TIMESTAMPTZ,
  alert_digest_key         TEXT,

  created_by               UUID        REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at               TIMESTAMPTZ DEFAULT NOW() NOT NULL,
  updated_at               TIMESTAMPTZ DEFAULT NOW() NOT NULL
);

COMMENT ON TABLE public.fleet_pro_fleet_compliance IS
  'Carrier-level compliance for one fleet: insurance certificate, IFTA and HUT 2290 filing state, plus the alert digest dedupe stamp.';

CREATE INDEX IF NOT EXISTS idx_fleet_pro_fleet_compliance_insurance
  ON public.fleet_pro_fleet_compliance (insurance_expires_on);


-- ── 4. RLS ───────────────────────────────────────────────────────────────────
-- The same four-audience shape as 105/106/114. The three SECURITY DEFINER helpers
-- (fleet_pro_account_ids and fleet_pro_managed_account_ids from 105,
-- fleet_pro_partner_account_ids from 106) already exist and are REUSED AS-IS.
-- Redefining any of them here would fork the subscription-liveness rule into two files
-- and silently hand a lapsed fleet its data back.
ALTER TABLE public.fleet_pro_drivers           ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.fleet_pro_compliance_docs   ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.fleet_pro_fleet_compliance  ENABLE ROW LEVEL SECURITY;

-- ---- drivers ----------------------------------------------------------------
-- The mechanic who owns the fleet account. Reached through hd_fleet_accounts rather
-- than a user_id column of its own, exactly as the PM policies in 105 do: the row is
-- about a fleet, and the fleet already knows who owns it.
DROP POLICY IF EXISTS "fleet pro drivers: owner manages" ON public.fleet_pro_drivers;
CREATE POLICY "fleet pro drivers: owner manages" ON public.fleet_pro_drivers
  FOR ALL TO authenticated
  USING (EXISTS (
    SELECT 1 FROM public.hd_fleet_accounts a
    WHERE a.id = fleet_pro_drivers.fleet_account_id AND a.user_id = auth.uid()
  ))
  WITH CHECK (EXISTS (
    SELECT 1 FROM public.hd_fleet_accounts a
    WHERE a.id = fleet_pro_drivers.fleet_account_id AND a.user_id = auth.uid()
  ));

-- Everyone on the roster reads: a supervisor has to see that a driver's medical card
-- dies on Friday even though he is not the one who renews it.
--
-- NOTE ON COLUMN SCOPE: RLS is row-level, so a read-only VIEWER who can see the row can
-- see cdl_number in it. The narrower rule — viewers get the last four characters only —
-- is enforced in /api/fleet-pro/drivers, which is the only path the portal reads by.
-- Called out rather than left implicit because it is the one place where the API is
-- stricter than the database, and a future direct-from-client query would lose it.
DROP POLICY IF EXISTS "fleet pro drivers: members read" ON public.fleet_pro_drivers;
CREATE POLICY "fleet pro drivers: members read" ON public.fleet_pro_drivers
  FOR SELECT TO authenticated
  USING (fleet_account_id IN (SELECT public.fleet_pro_account_ids()));

-- Only the fleet manager writes.
DROP POLICY IF EXISTS "fleet pro drivers: managers write" ON public.fleet_pro_drivers;
CREATE POLICY "fleet pro drivers: managers write" ON public.fleet_pro_drivers
  FOR ALL TO authenticated
  USING (fleet_account_id IN (SELECT public.fleet_pro_managed_account_ids()))
  WITH CHECK (fleet_account_id IN (SELECT public.fleet_pro_managed_account_ids()));

-- The reselling partner reads the fleets he bills for. Read only, matching 114/115 —
-- running the compliance calendar is the service he sells, so he has to be able to see
-- the driver whose card is about to lapse. His write path is the API route, on the
-- service client, after its own ownership check.
DROP POLICY IF EXISTS "fleet pro drivers: partner reads" ON public.fleet_pro_drivers;
CREATE POLICY "fleet pro drivers: partner reads" ON public.fleet_pro_drivers
  FOR SELECT TO authenticated
  USING (fleet_account_id IN (SELECT public.fleet_pro_partner_account_ids()));

-- ---- compliance documents ---------------------------------------------------
DROP POLICY IF EXISTS "fleet pro compliance docs: owner manages" ON public.fleet_pro_compliance_docs;
CREATE POLICY "fleet pro compliance docs: owner manages" ON public.fleet_pro_compliance_docs
  FOR ALL TO authenticated
  USING (EXISTS (
    SELECT 1 FROM public.hd_fleet_accounts a
    WHERE a.id = fleet_pro_compliance_docs.fleet_account_id AND a.user_id = auth.uid()
  ))
  WITH CHECK (EXISTS (
    SELECT 1 FROM public.hd_fleet_accounts a
    WHERE a.id = fleet_pro_compliance_docs.fleet_account_id AND a.user_id = auth.uid()
  ));

DROP POLICY IF EXISTS "fleet pro compliance docs: members read" ON public.fleet_pro_compliance_docs;
CREATE POLICY "fleet pro compliance docs: members read" ON public.fleet_pro_compliance_docs
  FOR SELECT TO authenticated
  USING (fleet_account_id IN (SELECT public.fleet_pro_account_ids()));

DROP POLICY IF EXISTS "fleet pro compliance docs: managers write" ON public.fleet_pro_compliance_docs;
CREATE POLICY "fleet pro compliance docs: managers write" ON public.fleet_pro_compliance_docs
  FOR ALL TO authenticated
  USING (fleet_account_id IN (SELECT public.fleet_pro_managed_account_ids()))
  WITH CHECK (fleet_account_id IN (SELECT public.fleet_pro_managed_account_ids()));

DROP POLICY IF EXISTS "fleet pro compliance docs: partner reads" ON public.fleet_pro_compliance_docs;
CREATE POLICY "fleet pro compliance docs: partner reads" ON public.fleet_pro_compliance_docs
  FOR SELECT TO authenticated
  USING (fleet_account_id IN (SELECT public.fleet_pro_partner_account_ids()));

-- ---- carrier-level compliance -----------------------------------------------
DROP POLICY IF EXISTS "fleet pro fleet compliance: owner manages" ON public.fleet_pro_fleet_compliance;
CREATE POLICY "fleet pro fleet compliance: owner manages" ON public.fleet_pro_fleet_compliance
  FOR ALL TO authenticated
  USING (EXISTS (
    SELECT 1 FROM public.hd_fleet_accounts a
    WHERE a.id = fleet_pro_fleet_compliance.fleet_account_id AND a.user_id = auth.uid()
  ))
  WITH CHECK (EXISTS (
    SELECT 1 FROM public.hd_fleet_accounts a
    WHERE a.id = fleet_pro_fleet_compliance.fleet_account_id AND a.user_id = auth.uid()
  ));

DROP POLICY IF EXISTS "fleet pro fleet compliance: members read" ON public.fleet_pro_fleet_compliance;
CREATE POLICY "fleet pro fleet compliance: members read" ON public.fleet_pro_fleet_compliance
  FOR SELECT TO authenticated
  USING (fleet_account_id IN (SELECT public.fleet_pro_account_ids()));

DROP POLICY IF EXISTS "fleet pro fleet compliance: managers write" ON public.fleet_pro_fleet_compliance;
CREATE POLICY "fleet pro fleet compliance: managers write" ON public.fleet_pro_fleet_compliance
  FOR ALL TO authenticated
  USING (fleet_account_id IN (SELECT public.fleet_pro_managed_account_ids()))
  WITH CHECK (fleet_account_id IN (SELECT public.fleet_pro_managed_account_ids()));

DROP POLICY IF EXISTS "fleet pro fleet compliance: partner reads" ON public.fleet_pro_fleet_compliance;
CREATE POLICY "fleet pro fleet compliance: partner reads" ON public.fleet_pro_fleet_compliance
  FOR SELECT TO authenticated
  USING (fleet_account_id IN (SELECT public.fleet_pro_partner_account_ids()));
