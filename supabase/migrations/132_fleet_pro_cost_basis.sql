-- Migration 132: the cost basis every per-asset money figure in Fleet Pro reads.
--
-- Two features land on top of this one (cost per mile/hour, and the replacement
-- recommendation engine) and both need the same three facts about a unit: what it
-- has cost, how far it has run, and what it is worth. Those are defined once here
-- rather than twice in two feature migrations that would inevitably drift.
--
-- ── WHAT IS *NOT* HERE, AND WHY ──────────────────────────────────────────────
-- No cost columns. Cost is DERIVED, never stored: it is the sum of hd_invoices and
-- fleet_pro_service_entries inside a rolling window, and a stored copy would be
-- wrong the moment an invoice is voided or a tech's entry is corrected. See
-- src/lib/fleet-pro/cost.ts for the one implementation.
--
-- ── MILEAGE: A CACHE, NOT THE RECORD ─────────────────────────────────────────
-- The brief said to store mileage updates on hd_units. hd_units.current_odometer
-- below does that, but it is a CACHE of the newest reading, not the source. Miles
-- driven over twelve months is a DIFFERENCE between two readings, and a single
-- scalar on the unit cannot answer it — fleet_pro_unit_meter_readings (migration
-- 106) already carries the dated series and stays the record of truth. The column
-- exists so the dashboard can render a current odometer without reaching into the
-- series for every unit on the page.


-- ── 1. Odometer cache + replacement valuation on the unit ────────────────────
ALTER TABLE public.hd_units
  ADD COLUMN IF NOT EXISTS current_odometer    NUMERIC(12,1),
  ADD COLUMN IF NOT EXISTS current_odometer_at DATE,
  -- What the fleet manager believes the asset is worth TODAY. Hand-maintained:
  -- there is no book-value feed here, and a stale figure that a human typed is
  -- more defensible in a budget meeting than a depreciation curve nobody agreed to.
  ADD COLUMN IF NOT EXISTS estimated_value     NUMERIC(12,2)
    CHECK (estimated_value IS NULL OR estimated_value >= 0),
  ADD COLUMN IF NOT EXISTS value_updated_at    DATE;

COMMENT ON COLUMN public.hd_units.current_odometer IS
  'Cache of the newest fleet_pro_unit_meter_readings.odometer. Not the source of truth for distance travelled.';
COMMENT ON COLUMN public.hd_units.estimated_value IS
  'Fleet manager''s estimate of current market value, used as the denominator of the replacement ratio.';


-- ── 2. Replacement thresholds, per fleet ─────────────────────────────────────
-- Configurable because "half the truck''s value" is a reasonable default and not a
-- universal one: a municipal fleet running assets to destruction and an owner-op
-- protecting resale draw the line in different places.
ALTER TABLE public.hd_fleet_accounts
  ADD COLUMN IF NOT EXISTS replacement_cost_ratio    NUMERIC(5,2) NOT NULL DEFAULT 50.00
    CHECK (replacement_cost_ratio > 0 AND replacement_cost_ratio <= 500),
  ADD COLUMN IF NOT EXISTS replacement_breakdown_min INTEGER      NOT NULL DEFAULT 3
    CHECK (replacement_breakdown_min >= 1);


-- ── 3. Keep the odometer cache honest ────────────────────────────────────────
-- Written by trigger rather than by the API routes that insert readings: there are
-- already four of those (pretrip, work order, PM, manual) and a fifth will be added
-- by someone who does not know the cache exists.
--
-- Guarded on the value going FORWARD. A backdated correction, or a reading typed
-- with a transposed digit and then fixed, must not drag the current odometer
-- backward — but a genuinely newer reading always wins, even if lower, because a
-- replaced ECU legitimately resets the count. The tiebreak is the reading DATE.
CREATE OR REPLACE FUNCTION public.fleet_pro_sync_unit_odometer()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  IF NEW.odometer IS NULL THEN
    RETURN NEW;
  END IF;

  UPDATE public.hd_units u
  SET    current_odometer    = NEW.odometer,
         current_odometer_at = NEW.reading_date
  WHERE  u.id = NEW.unit_id
    AND  (u.current_odometer_at IS NULL OR NEW.reading_date >= u.current_odometer_at);

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_sync_unit_odometer ON public.fleet_pro_unit_meter_readings;
CREATE TRIGGER trg_sync_unit_odometer
  AFTER INSERT OR UPDATE OF odometer, reading_date
  ON public.fleet_pro_unit_meter_readings
  FOR EACH ROW
  EXECUTE FUNCTION public.fleet_pro_sync_unit_odometer();


-- ── 4. Backfill the cache from readings that already exist ───────────────────
UPDATE public.hd_units u
SET    current_odometer    = r.odometer,
       current_odometer_at = r.reading_date
FROM  (
  SELECT DISTINCT ON (unit_id) unit_id, odometer, reading_date
  FROM   public.fleet_pro_unit_meter_readings
  WHERE  odometer IS NOT NULL
  ORDER  BY unit_id, reading_date DESC, created_at DESC
) r
WHERE u.id = r.unit_id
  AND u.current_odometer IS DISTINCT FROM r.odometer;


-- ── 5. Indexes for the rolling-window scans ──────────────────────────────────
-- Both cost queries are "every row for these units since a date". hd_invoices had
-- no unit/date index at all; the dashboard has been sequential-scanning it.
CREATE INDEX IF NOT EXISTS idx_hd_invoices_unit_created
  ON public.hd_invoices (unit_id, created_at DESC)
  WHERE unit_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_hd_work_orders_unit_created
  ON public.hd_work_orders (unit_id, created_at DESC)
  WHERE unit_id IS NOT NULL;


-- ── 6. RLS ───────────────────────────────────────────────────────────────────
-- No new tables, so no new policies. The columns added above inherit the policies
-- already on hd_units (105: fleet members read, managers update) and
-- hd_fleet_accounts (105: fleet members read). Deliberately NOT granting members
-- write on the new threshold columns — 105's "managers update units" already
-- scopes who may set estimated_value, and the thresholds are set through the
-- settings route on the service role after a manager check.
