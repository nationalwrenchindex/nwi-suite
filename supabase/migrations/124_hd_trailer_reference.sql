-- Migration 124: trailer systems reference for HD QuickWrench.
--
-- QuickWrench already carries reefer alarm codes (058) and a reefer parts cross-ref
-- (061), but a trailer tech on a roadside call has nothing to look up for the running
-- gear: chamber sizes, pushrod stroke limits, slack adjuster geometry, ABS blink codes,
-- and the seven-way pin-out. Those live in seven different manufacturer manuals that
-- nobody carries in the truck. This table is the one place the app can search them.
--
-- Deliberately generic rather than one table per system. Every one of those subjects is
-- the same shape at heart — a named component, a plain-language description, and
-- optionally one spec with a unit — so splitting them into four tables would buy four
-- schemas and four API routes to serve one search box. `system` is what separates them,
-- and TrailerSystem in src/lib/hd/trailer/types.ts is the authoritative list of its
-- values. No CHECK constraint is placed on `system` on purpose: the constraint would
-- have to be edited (and a migration shipped) every time a system is added, while the
-- rows only ever arrive through the founder-gated seed route, which is typed against
-- TrailerSystem and is the real gate.

CREATE TABLE IF NOT EXISTS public.hd_trailer_reference (
  id            UUID        DEFAULT gen_random_uuid() PRIMARY KEY,
  -- 'Air Brakes', 'Brake Chambers', 'ABS', ... — see TrailerSystem.
  system        TEXT        NOT NULL,
  -- The specific part or code: 'Type 30 Brake Chamber', 'Haldex Code 1-1'.
  component     TEXT        NOT NULL,
  description   TEXT        NOT NULL,
  -- value/units are split rather than stored as one display string ('120-135 PSI') so
  -- the UI can render the unit in its own column and so a later feature can filter or
  -- compare on the number without parsing it back out of prose. Both are nullable
  -- together: plenty of these rows are a procedure with no single figure attached.
  value         TEXT,
  units         TEXT,
  notes         TEXT,
  -- Defaults to 'Trailer' because most of this is industry-standard and not owned by
  -- any brand (FMVSS 121 stroke limits, chamber types, the J560 pin-out). A real brand
  -- goes here only when the spec genuinely differs by manufacturer — ABS blink codes,
  -- for instance, mean different things on Haldex than on Bendix.
  manufacturer  TEXT        NOT NULL DEFAULT 'Trailer',
  created_at    TIMESTAMPTZ DEFAULT NOW()
);

ALTER TABLE public.hd_trailer_reference ENABLE ROW LEVEL SECURITY;

-- Same policy pair as hd_parts_reference (061) and hd_alarm_codes (058), and for the
-- same reason: this is a static catalog with no user_id, so there is no per-row owner
-- to scope reads to. Writes are still authenticated-only, and in practice only the
-- founder-gated seed route writes here.
--
-- Acknowledged: public SELECT means the whole catalog is readable with the anon key by
-- anyone who has it. That is intentional. A recent audit flagged the identical property
-- on hd_parts_reference and it was confirmed as by-design — the contents are published
-- manufacturer specs, not customer data, and the app reads them from unauthenticated
-- contexts. Do not "fix" this by tightening it to authenticated without first checking
-- who reads the catalog; the finding is known and accepted, not an oversight.
DROP POLICY IF EXISTS "Public read trailer reference" ON public.hd_trailer_reference;
CREATE POLICY "Public read trailer reference"
  ON public.hd_trailer_reference
  FOR SELECT TO public USING (true);

DROP POLICY IF EXISTS "Authenticated manage trailer reference" ON public.hd_trailer_reference;
CREATE POLICY "Authenticated manage trailer reference"
  ON public.hd_trailer_reference
  FOR ALL TO authenticated USING (true);

-- The two filters QuickWrench actually issues: pick a system from the tab strip, or
-- jump straight to a component by name.
CREATE INDEX IF NOT EXISTS idx_trailer_ref_system
  ON public.hd_trailer_reference(system);
CREATE INDEX IF NOT EXISTS idx_trailer_ref_component
  ON public.hd_trailer_reference(component);

-- btree on component above, NOT a GIN trigram index on description.
--
-- A trigram index would be the better fit for the substring search the UI does over
-- descriptions, but it requires the pg_trgm extension and this project has never
-- enabled it: the only CREATE EXTENSION in the tree is uuid-ossp in 001, and the sole
-- GIN index in the tree (058) uses to_tsvector, which is core Postgres and needs no
-- extension. Rather than ship SQL that fails on a database where pg_trgm was never
-- installed, this stays on btree. The table is a few hundred rows of static reference
-- data, so a sequential scan on description costs nothing at this size.
--
-- If description search ever does need an index, the cheap next step is the 058
-- pattern -- USING gin(to_tsvector('english', description)) -- which works today with
-- no extension. Move to pg_trgm only after confirming the extension is available, and
-- add its CREATE EXTENSION in its own migration.
