-- Migration 133: Fleet Pro — driver fuel log, and a real identity for the driver.
--
-- TWO THINGS HAPPEN IN THIS FILE and they are related, which is why they are not
-- split: a new fuel_log table, and a driver_id column added to the pre-trip
-- inspections table that has been carrying a typed name since 106.
--
-- WHY MPG BELONGS IN THE DATABASE AND NOT IN A REPORT
-- Fuel is the largest controllable line in a fleet's operating cost and the earliest
-- mechanical warning a truck gives. A dragging brake, a slipping clutch fan, a
-- plugged DPF and a leaking injector all show up as MPG falling weeks before anything
-- lights the dash. That signal only exists if every fillup is a row: computing it
-- from invoices cannot work, because a fuel card statement has no odometer on it.
--
-- WHY driver_id IS BEING ADDED TO PRE-TRIP INSPECTIONS
-- fleet_pro_pretrip_inspections.driver_name has been free text since 106, because the
-- QR flow is unauthenticated and the driver types who he is. That was fine while the
-- name was only ever displayed. It stops being fine the moment anything is COUNTED
-- per driver — a scorecard, a completion rate, an MPG average — because "Mike",
-- "Mike A", "mike alvarez" and a fat-fingered "Mkie" are four drivers to a GROUP BY
-- and one man in the yard. The column is nullable and the name is kept: a driver who
-- is not on the roster still files a valid inspection, he just does not aggregate.
--
--   driver_id  — set when the driver picks himself from the fleet's roster
--   driver_name— always set, and the only identity for an off-roster driver
--
-- ON DELETE SET NULL on both, deliberately, and NOT the CASCADE that
-- fleet_pro_compliance_docs uses for its driver_id. A compliance document IS about a
-- person and follows him out the door when his record is deleted (131 explains why).
-- A fillup is about a TRUCK: it is the unit's cost and fuel-economy history, it feeds
-- cost-per-mile, and it must survive the driver record being removed. The same holds
-- for an inspection, which is a safety record about the vehicle.
--
-- STORAGE. pump_image_url holds a PATH inside the existing PRIVATE
-- fleet-pro-compliance-docs bucket, never a URL — same rule as 131. Reads are
-- short-lived signed URLs minted server-side after the membership check.


-- ── 1. Fuel log ──────────────────────────────────────────────────────────────
-- fleet_account_id is denormalized onto the row (the call 115 and 131 both made) so
-- every policy below is a column comparison instead of a join through hd_units on
-- each row. It is written by the server FROM THE UNIT, never from the request body:
-- the submitting endpoint is unauthenticated, and trusting a fleet id off the wire
-- would let a driver file fuel into another carrier's books.
CREATE TABLE IF NOT EXISTS public.fleet_pro_fuel_log (
  id                UUID        DEFAULT gen_random_uuid() PRIMARY KEY,
  unit_id           UUID        NOT NULL REFERENCES public.hd_units(id)          ON DELETE CASCADE,
  fleet_account_id  UUID                 REFERENCES public.hd_fleet_accounts(id) ON DELETE SET NULL,

  -- See the header. Nullable by design; driver_name is the fallback identity.
  driver_id         UUID                 REFERENCES public.fleet_pro_drivers(id) ON DELETE SET NULL,
  driver_name       TEXT        CHECK (driver_name IS NULL OR char_length(btrim(driver_name)) <= 120),

  fuel_date         DATE        NOT NULL DEFAULT CURRENT_DATE,

  -- WHY EVERY NUMBER HERE IS NULLABLE
  -- The values are read off a photograph of a pump display by a vision model, then
  -- corrected by a driver standing at the island in the cold. A blank is a normal,
  -- expected outcome and must not block the fillup from being recorded — a row with
  -- gallons and no price is still worth having. The one thing that is never allowed
  -- is a fabricated number, so nothing here has a non-zero DEFAULT.
  --
  -- Ceilings are physical, not arbitrary: a truck tank pair is ~300 gallons, so 500
  -- is already generous; $5,000 is past any single fillup; $25/gal is past any real
  -- diesel price including the worst remote-highway markup.
  gallons           NUMERIC(8,3)  CHECK (gallons IS NULL OR (gallons > 0 AND gallons <= 500)),
  total_cost        NUMERIC(10,2) CHECK (total_cost IS NULL OR (total_cost >= 0 AND total_cost <= 5000)),
  price_per_gallon  NUMERIC(6,3)  CHECK (price_per_gallon IS NULL OR (price_per_gallon >= 0 AND price_per_gallon <= 25)),

  -- odometer_start is the PREVIOUS known reading for this unit, copied onto the row
  -- at write time rather than looked up later. It is stored because the span it
  -- defines is what mpg means, and a later correction to some other row must not
  -- silently redefine what this fillup's MPG was calculated from.
  odometer_start    NUMERIC(12,1) CHECK (odometer_start IS NULL OR (odometer_start >= 0 AND odometer_start <= 9999999)),
  odometer_end      NUMERIC(12,1) CHECK (odometer_end   IS NULL OR (odometer_end   >= 0 AND odometer_end   <= 9999999)),
  miles_driven      NUMERIC(10,1) CHECK (miles_driven   IS NULL OR (miles_driven   >= 0 AND miles_driven   <= 9999999)),

  -- NULL on a unit's first-ever fillup and that is correct, not missing data: there
  -- is no prior odometer, so there is no span, so there is no MPG. Fabricating one
  -- from the tank size would put an invented figure into the rolling average that
  -- every later fillup is judged against.
  --
  -- 0 < mpg <= 30: a loaded class-8 runs 5-9, a light truck 12-20. Anything past 30
  -- is a mis-keyed odometer (usually a driver entering trip miles instead of hub
  -- miles), and letting it in would lift the unit's average enough to suppress the
  -- very alert this table exists to raise.
  mpg               NUMERIC(6,2)  CHECK (mpg IS NULL OR (mpg > 0 AND mpg <= 30)),

  -- PATH in the private bucket. Never a URL. See the header.
  pump_image_url    TEXT        CHECK (pump_image_url IS NULL OR char_length(pump_image_url) <= 500),

  -- IDEMPOTENCY. A phone at a truck stop is routinely on one bar, and a submission
  -- WILL be replayed — a manual retry, a second tab, a backgrounded request that
  -- actually landed. The device mints this once before its first attempt and reuses it
  -- forever, exactly as fleet_pro_pretrip_inspections.client_uuid does (106).
  --
  -- NOT globally UNIQUE, unlike the pre-trip column, and the difference is deliberate:
  -- a driver can legitimately fuel the same truck twice in one day, so uniqueness has
  -- to be on the token alone, which is minted per submission rather than per fillup.
  -- A partial unique index (below) enforces it while leaving the column nullable for a
  -- client that never sent one.
  client_uuid       TEXT        CHECK (client_uuid IS NULL OR char_length(client_uuid) <= 64),

  created_at        TIMESTAMPTZ DEFAULT NOW() NOT NULL,

  -- The odometer can only go forward. A reading below the previous one is a typo or a
  -- different truck's number, and it would produce negative miles and a negative MPG.
  -- Enforced here rather than only in the API because the API is not the only thing
  -- that will ever write this table.
  CONSTRAINT fleet_pro_fuel_log_odometer_forward
    CHECK (odometer_start IS NULL OR odometer_end IS NULL OR odometer_end >= odometer_start)
);

COMMENT ON TABLE public.fleet_pro_fuel_log IS
  'Driver fuel fillups captured from the QR flow. mpg is NULL on a first fillup - no prior odometer means no span. pump_image_url is a path in the private fleet-pro-compliance-docs bucket.';

COMMENT ON COLUMN public.fleet_pro_fuel_log.driver_id IS
  'Set when the driver picked himself from the fleet roster. NULL for an off-roster driver, who is identified by driver_name only and does not aggregate into the scorecard.';

-- The unit's fuel history, newest first. This is both the MPG rolling-average read
-- (per unit, ordered by date) and the unit-detail timeline, so one index serves both.
CREATE INDEX IF NOT EXISTS idx_fleet_pro_fuel_log_unit
  ON public.fleet_pro_fuel_log (unit_id, fuel_date DESC);

-- The fleet-wide dashboard sweep that looks for units whose MPG has dropped.
CREATE INDEX IF NOT EXISTS idx_fleet_pro_fuel_log_account
  ON public.fleet_pro_fuel_log (fleet_account_id, fuel_date DESC);

-- One driver's fuel history, for the driver scorecard. Partial: an off-roster row has
-- no driver_id and would only bloat the index.
CREATE INDEX IF NOT EXISTS idx_fleet_pro_fuel_log_driver
  ON public.fleet_pro_fuel_log (driver_id, fuel_date DESC)
  WHERE driver_id IS NOT NULL;

-- The replay guard. UNIQUE so the database refuses a duplicate submission even if two
-- retries race each other past the API's check-then-insert, which a pure application
-- check cannot prevent. Partial, so the many rows with no token do not collide on NULL.
CREATE UNIQUE INDEX IF NOT EXISTS idx_fleet_pro_fuel_log_client_uuid
  ON public.fleet_pro_fuel_log (client_uuid)
  WHERE client_uuid IS NOT NULL;


-- ── 2. Driver identity on pre-trip inspections ───────────────────────────────
-- Additive and nullable, so every one of the inspections already in this table stays
-- valid and keeps the name it was filed under. Nothing is backfilled: matching old
-- free-text names to roster rows by string similarity is exactly the guess this
-- column exists to stop, and a wrong match would attribute one driver's inspection
-- record to another.
ALTER TABLE public.fleet_pro_pretrip_inspections
  ADD COLUMN IF NOT EXISTS driver_id UUID REFERENCES public.fleet_pro_drivers(id) ON DELETE SET NULL;

COMMENT ON COLUMN public.fleet_pro_pretrip_inspections.driver_id IS
  'Set when the driver picked himself from the fleet roster. NULL for older rows and off-roster drivers - driver_name remains the fallback identity.';

-- One driver's inspection history, for the scorecard's completion rate. Partial for
-- the same reason as the fuel index: pre-2026 rows have no driver_id.
CREATE INDEX IF NOT EXISTS idx_fleet_pro_pretrip_driver
  ON public.fleet_pro_pretrip_inspections (driver_id, inspection_date DESC)
  WHERE driver_id IS NOT NULL;


-- ── 3. 'fuel' as a meter-reading provenance ──────────────────────────────────
-- Every fillup carries an odometer, which makes it one of the best sources of meter
-- history this product has: it is written by a driver who is looking at the hub
-- reading, at a cadence of every few days, without anyone being asked to do extra
-- work. /api/inspect/fuel-log therefore also writes fleet_pro_unit_meter_readings,
-- which is what cost-per-mile in src/lib/fleet-pro/cost.ts reads to find a span.
--
-- That table's source CHECK (106) predates this and does not list 'fuel', so the
-- insert would fail with 23514 and silently cost us the reading — the cost engine
-- would keep returning null for a fleet that is fuelling every day. Widened rather
-- than reusing 'manual', because provenance is the point of the column: 'manual' is
-- a human typing a number into the portal, and a fillup is not that.
--
-- Written as drop-and-recreate against the auto-generated constraint name, guarded so
-- re-running this migration is a no-op.
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conrelid = 'public.fleet_pro_unit_meter_readings'::regclass
      AND conname  = 'fleet_pro_unit_meter_readings_source_check'
  ) THEN
    ALTER TABLE public.fleet_pro_unit_meter_readings
      DROP CONSTRAINT fleet_pro_unit_meter_readings_source_check;
  END IF;

  ALTER TABLE public.fleet_pro_unit_meter_readings
    ADD CONSTRAINT fleet_pro_unit_meter_readings_source_check
    CHECK (source IN ('pretrip','work_order','pm','invoice','manual','fuel'));
END $$;


-- ── 4. RLS ───────────────────────────────────────────────────────────────────
-- Identical shape to 131, including the helper functions it relies on
-- (fleet_pro_account_ids / fleet_pro_managed_account_ids /
-- fleet_pro_partner_account_ids, defined in 105/106). They are NOT redefined here:
-- forking the subscription-liveness rule into a second file is how a lapsed fleet
-- gets handed its data back.
--
-- WHAT IS DELIBERATELY ABSENT: any policy for the anon role. The driver who writes
-- this table has no session at all — the QR sticker is the capability — so the write
-- happens on the service client in /api/inspect/fuel-log, which bypasses RLS after
-- re-deriving the fleet from the unit. Granting anon an INSERT policy here would make
-- the table writable by anyone holding the public key, with no unit check at all.
ALTER TABLE public.fleet_pro_fuel_log ENABLE ROW LEVEL SECURITY;

-- The mechanic who owns the fleet account. Reached through hd_fleet_accounts rather
-- than a user_id column of its own, exactly as 105/131 do: the row is about a fleet,
-- and the fleet already knows who owns it.
DROP POLICY IF EXISTS "fleet pro fuel log: owner manages" ON public.fleet_pro_fuel_log;
CREATE POLICY "fleet pro fuel log: owner manages" ON public.fleet_pro_fuel_log
  FOR ALL TO authenticated
  USING (EXISTS (
    SELECT 1 FROM public.hd_fleet_accounts a
    WHERE a.id = fleet_pro_fuel_log.fleet_account_id AND a.user_id = auth.uid()
  ))
  WITH CHECK (EXISTS (
    SELECT 1 FROM public.hd_fleet_accounts a
    WHERE a.id = fleet_pro_fuel_log.fleet_account_id AND a.user_id = auth.uid()
  ));

-- Everyone on the roster reads, VIEWERS INCLUDED. Unlike spend, fuel economy is not
-- withheld from a read-only viewer: MPG is a use figure, not a money figure, and a
-- yard supervisor who cannot see that unit 12 is down 20% is the person who would
-- have caught it. total_cost and price_per_gallon ARE money and are stripped for
-- viewers by the API, the same split /api/fleet-pro/drivers makes for CDL numbers.
DROP POLICY IF EXISTS "fleet pro fuel log: members read" ON public.fleet_pro_fuel_log;
CREATE POLICY "fleet pro fuel log: members read" ON public.fleet_pro_fuel_log
  FOR SELECT TO authenticated
  USING (fleet_account_id IN (SELECT public.fleet_pro_account_ids()));

-- Only the fleet manager corrects a fillup after the fact — a mis-keyed odometer has
-- to be fixable, and fixing it changes the unit's MPG history.
DROP POLICY IF EXISTS "fleet pro fuel log: managers write" ON public.fleet_pro_fuel_log;
CREATE POLICY "fleet pro fuel log: managers write" ON public.fleet_pro_fuel_log
  FOR ALL TO authenticated
  USING (fleet_account_id IN (SELECT public.fleet_pro_managed_account_ids()))
  WITH CHECK (fleet_account_id IN (SELECT public.fleet_pro_managed_account_ids()));

-- The reselling partner reads the fleets he bills for, read-only, matching 114/115/131.
DROP POLICY IF EXISTS "fleet pro fuel log: partner reads" ON public.fleet_pro_fuel_log;
CREATE POLICY "fleet pro fuel log: partner reads" ON public.fleet_pro_fuel_log
  FOR SELECT TO authenticated
  USING (fleet_account_id IN (SELECT public.fleet_pro_partner_account_ids()));
