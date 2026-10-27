-- 170: reefer_unit_details - the reefer job fields hd_units does not have.
--
-- Reefer Standalone (/reefer) keeps a unit's reefer identity on hd_units, which already
-- has manufacturer, model, serial_number, bm_number, year, refrigerant_type and the
-- hours columns. A reefer job is also a tractor and a trailer, and hd_units has no
-- setpoint, no VIN and no truck make/model/year. hd_units is NOT altered (standing
-- rule: new tables only), so those fields live here, one row per unit.
--
--   unit_id      the hd_units row (primary key: at most one details row per unit).
--                ON DELETE CASCADE: the details go with the unit.
--   user_id      the shop. RLS scopes every read and write to user_id = auth.uid(),
--                and a unit_id must be one of the shop's own units (policy check).
--   setpoint_f   the unit's usual setpoint, degrees F (-40 to 90), or NULL.
--   truck_make / truck_model / truck_year / vin - the tractor or truck the unit rides
--                on, as separate labelled fields. All nullable.
--
-- NEW TABLE ONLY. No existing table, column, constraint or row is touched.
-- Preview and production share one database. Applying this applies it to both.

BEGIN;

CREATE TABLE IF NOT EXISTS public.reefer_unit_details (
  unit_id      UUID        PRIMARY KEY REFERENCES public.hd_units(id) ON DELETE CASCADE,
  user_id      UUID        NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  setpoint_f   NUMERIC(5,1),
  truck_make   TEXT,
  truck_model  TEXT,
  truck_year   INTEGER,
  vin          TEXT,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT reefer_unit_details_setpoint_range CHECK (setpoint_f IS NULL OR (setpoint_f >= -40 AND setpoint_f <= 90)),
  CONSTRAINT reefer_unit_details_truck_year_range CHECK (truck_year IS NULL OR (truck_year >= 1950 AND truck_year <= 2100)),
  CONSTRAINT reefer_unit_details_vin_length CHECK (vin IS NULL OR char_length(vin) <= 17)
);

CREATE INDEX IF NOT EXISTS reefer_unit_details_user_idx ON public.reefer_unit_details (user_id);

ALTER TABLE public.reefer_unit_details ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "reefer_unit_details own" ON public.reefer_unit_details;
CREATE POLICY "reefer_unit_details own" ON public.reefer_unit_details
  FOR ALL TO authenticated
  USING (user_id = auth.uid())
  WITH CHECK (
    user_id = auth.uid()
    AND EXISTS (SELECT 1 FROM public.hd_units u WHERE u.id = unit_id AND u.user_id = auth.uid())
  );

COMMENT ON TABLE public.reefer_unit_details IS
  'Migration 170. Reefer Standalone: setpoint and tractor fields for an hd_units row. One row per unit.';

-- Check 1. The new table is empty. Should return 0.
SELECT count(*) AS reefer_unit_details_rows FROM public.reefer_unit_details;

-- Check 2 (last, so it is the result the editor shows). Should return 9 rows.
SELECT column_name, data_type, is_nullable
  FROM information_schema.columns
 WHERE table_schema = 'public' AND table_name = 'reefer_unit_details'
 ORDER BY ordinal_position;

NOTIFY pgrst, 'reload schema';

COMMIT;
