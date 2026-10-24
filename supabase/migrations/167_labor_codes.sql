-- 167: labor codes on hd_repair_items, the OEM reference field, and no hard deletes.
--
-- (The HD document parity pass, which was going to be 167, is now 168.)
--
-- LABOR CODE: NWI's own permanent handle for an operation. Not any manufacturer's
-- labor operation code.
--   Format  PREFIX-NNNN, four digits minimum, five past 9999 (RF-0142, RF-10001).
--   Prefix  from equipment_type at the moment the row is first saved:
--             reefer RF   truck TC   trailer TR   boom BM   aerial AE
--             digger_derrick DD   apu AP   genset GS   other OT   (none) GN
--           Truck is TC, not TK: TK-nnnn reads as a Thermo King operation.
--   One counter per prefix for the WHOLE table, not per shop, so a code is unique
--   everywhere and stays unique when a card is later published. Gaps are expected.
--   Assigned by a trigger on INSERT for every writer (labor cards screen, quote modal,
--   QuickWrench, catalog seed). A code sent by a caller is ignored.
--   PERMANENT: an UPDATE that changes labor_code is refused. Rewording the
--   description or changing equipment_type never changes the code. Counters only go
--   up, so a number is never handed out twice.
--
-- OEM_LABOR_CODE: optional free text, the shop's own note of an OEM code. Private.
--   Refused on any row whose scope is 'global', so it never travels with a published
--   NWI operation.
--
-- NO HARD DELETES by a shop: the "hd_repair_items delete own" policy from 166 is
--   dropped. The app only soft deletes (active = false), so a code's row never
--   disappears. The service role (smoke cleanup) is unaffected.
--
-- BACKFILL of the 31 rows that exist on 2026-10-24, by id. Brock's decisions:
--   the 20 NWI catalog reefer rows -> reefer; the catalog EGR row -> truck (reefer
--   engines carry no EGR); Brock's six real rows -> reefer; "test labor", Kurt's row
--   and the LD trial subscriber's two rows get no type (GN). equipment_type is set
--   only where it is NULL today. Nothing else on any row changes; updated_at is not
--   touched. Order within a prefix: catalog first, then by created_at.
--     RF-0001  R&R Evaporator Fan Motor                     NWI
--     RF-0002  R&R Condenser Fan Motor                      NWI
--     RF-0003  R&R Electric Standby Motor (trailer)         NWI
--     RF-0004  R&R Electric Standby Motor (truck)           NWI
--     RF-0005  R&R Contactor                                NWI
--     RF-0006  R&R Compressor (truck)                       NWI
--     RF-0007  R&R Compressor (trailer)                     NWI
--     RF-0008  R&R ETV Valve                                NWI
--     RF-0009  R&R Alternator                               NWI
--     RF-0010  R&R Fuel Solenoid                            NWI
--     RF-0011  R&R Temperature Sensor                       NWI
--     RF-0012  R&R High Pressure Cutout Switch              NWI
--     RF-0013  R&R Belts (Full Set) (trailer)               NWI
--     RF-0014  R&R Belts (Full Set) (truck)                 NWI
--     RF-0015  R&R Defrost Damper Solenoid                  NWI
--     TC-0001  R&R EGR Cooler / EGR Valve + Coolant D&R     NWI
--     RF-0016  R&R 3-Way Valve                              NWI
--     RF-0017  Service Refrigeration A                      NWI
--     RF-0018  Service Refrigeration B                      NWI
--     RF-0019  Service Refrigeration C                      NWI
--     RF-0020  Service Refrigeration D                      NWI
--     RF-0021  Replace fan bearing                          Brock
--     RF-0022  Replace Water pump belt                      Brock
--     RF-0023  Service Refrigeration A                      Brock
--     RF-0024  R&R Electric Standby Motor                   Brock
--     RF-0025  R&R Alternator                               Brock
--     RF-0026  Replace engine mounts, lower 2 rear, 2 front Brock
--     GN-0001  test labor                                   Brock
--     GN-0002  pull driver headlight assembly               Kurt
--     GN-0003  DISPATCH FEE                                 LD trial subscriber
--     GN-0004  SHOP SUPPLIES                                LD trial subscriber
--   Any row added after this list was written is coded after these, in created_at
--   order, from the same counters.
--
-- Preview and production share one database. Applying this applies it to both.

BEGIN;

ALTER TABLE public.hd_repair_items
  ADD COLUMN IF NOT EXISTS labor_code     TEXT,
  ADD COLUMN IF NOT EXISTS oem_labor_code TEXT;

-- ---------------------------------------------------------------------------
-- 1. Counters, one row per prefix. Only the trigger function writes them.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.hd_labor_code_counters (
  prefix     TEXT    PRIMARY KEY,
  last_value INTEGER NOT NULL DEFAULT 0 CHECK (last_value >= 0)
);
ALTER TABLE public.hd_labor_code_counters ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.hd_labor_code_counters FROM anon, authenticated;

CREATE OR REPLACE FUNCTION public.hd_labor_code_prefix(t TEXT) RETURNS TEXT
LANGUAGE sql IMMUTABLE AS $fn$
  SELECT CASE t
    WHEN 'reefer'         THEN 'RF'
    WHEN 'truck'          THEN 'TC'
    WHEN 'trailer'        THEN 'TR'
    WHEN 'boom'           THEN 'BM'
    WHEN 'aerial'         THEN 'AE'
    WHEN 'digger_derrick' THEN 'DD'
    WHEN 'apu'            THEN 'AP'
    WHEN 'genset'         THEN 'GS'
    WHEN 'other'          THEN 'OT'
    ELSE 'GN'
  END
$fn$;

-- The next code for a prefix. Row-locks that prefix's counter for the transaction,
-- so two saves at once can never get the same number.
CREATE OR REPLACE FUNCTION public.hd_next_labor_code(p TEXT) RETURNS TEXT
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $fn$
DECLARE n INTEGER;
BEGIN
  INSERT INTO public.hd_labor_code_counters AS c (prefix, last_value) VALUES (p, 1)
    ON CONFLICT (prefix) DO UPDATE SET last_value = c.last_value + 1
    RETURNING c.last_value INTO n;
  RETURN p || '-' || CASE WHEN n < 10000 THEN lpad(n::TEXT, 4, '0') ELSE n::TEXT END;
END
$fn$;
REVOKE ALL ON FUNCTION public.hd_next_labor_code(TEXT) FROM PUBLIC, anon, authenticated;

-- ---------------------------------------------------------------------------
-- 2. Backfill the 31 existing rows, by id.
-- ---------------------------------------------------------------------------
CREATE TEMP TABLE labor_code_backfill_167 (
  id         UUID PRIMARY KEY,
  set_type   TEXT,
  expected   TEXT NOT NULL,
  note       TEXT NOT NULL
) ON COMMIT DROP;

INSERT INTO labor_code_backfill_167 (id, set_type, expected, note) VALUES
  ('39456de9-15d8-449f-9845-0d67015608a3', 'reefer', 'RF-0001', 'NWI R&R Evaporator Fan Motor'),
  ('895ce556-29ef-4f6f-b0e4-213b1bd28970', 'reefer', 'RF-0002', 'NWI R&R Condenser Fan Motor'),
  ('c0f7bc8a-69ee-46c6-9259-d06cd0a3e8ac', 'reefer', 'RF-0003', 'NWI R&R Electric Standby Motor (trailer)'),
  ('b1f6338f-a9c3-40e3-ac26-96e7effb660f', 'reefer', 'RF-0004', 'NWI R&R Electric Standby Motor (truck)'),
  ('b137ffe1-1e49-4728-83ec-9ba8287bcafe', 'reefer', 'RF-0005', 'NWI R&R Contactor'),
  ('e92de903-9a13-4993-a202-77babdb95f2a', 'reefer', 'RF-0006', 'NWI R&R Compressor (truck)'),
  ('a723428f-007a-4ec5-93f6-59709b6d6106', 'reefer', 'RF-0007', 'NWI R&R Compressor (trailer)'),
  ('3cccc6d8-622d-4a63-9056-63c48eac6572', 'reefer', 'RF-0008', 'NWI R&R ETV Valve'),
  ('07c5ccde-5dd8-4783-a2ec-d2430c2f134f', 'reefer', 'RF-0009', 'NWI R&R Alternator'),
  ('c3b7e47e-6ac9-490e-9b21-222e397d47ce', 'reefer', 'RF-0010', 'NWI R&R Fuel Solenoid'),
  ('2df65462-b3d8-4e01-9d62-a15ab7c712aa', 'reefer', 'RF-0011', 'NWI R&R Temperature Sensor'),
  ('4dd658e9-a46f-46ee-8fc4-95db90c6e6db', 'reefer', 'RF-0012', 'NWI R&R High Pressure Cutout Switch'),
  ('6b47307b-cc1f-4528-850a-c2505d2c23ed', 'reefer', 'RF-0013', 'NWI R&R Belts (Full Set) (trailer)'),
  ('c6bd11f0-5e51-4f8b-9c13-66f3db078596', 'reefer', 'RF-0014', 'NWI R&R Belts (Full Set) (truck)'),
  ('28faccba-f805-4a68-b704-26f83c220378', 'reefer', 'RF-0015', 'NWI R&R Defrost Damper Solenoid'),
  ('62c6b925-5446-4249-8dad-bb2ebee50f92', 'truck',  'TC-0001', 'NWI R&R EGR Cooler / EGR Valve + Coolant Drain & Refill'),
  ('d070c7ae-0d28-4c87-821a-a926647b00b0', 'reefer', 'RF-0016', 'NWI R&R 3-Way Valve'),
  ('e02cde0a-1455-4473-b44a-59b9af02abcc', 'reefer', 'RF-0017', 'NWI Service Refrigeration A'),
  ('9e0db595-d7ae-4c11-b4ad-c181485e59e1', 'reefer', 'RF-0018', 'NWI Service Refrigeration B'),
  ('276cda85-ff3d-41d8-bc76-c6d7fc22d5d3', 'reefer', 'RF-0019', 'NWI Service Refrigeration C'),
  ('4cbfbf0c-28a0-4c94-b877-19ba1e542a37', 'reefer', 'RF-0020', 'NWI Service Refrigeration D'),
  ('5b47d389-1b88-424d-aa8e-cc74d86d6cb8', 'reefer', 'RF-0021', 'Brock Replace fan bearing'),
  ('cf4a3e80-ae92-411e-9474-2e9dd0c8e212', 'reefer', 'RF-0022', 'Brock Replace Water pump belt'),
  ('89103ec3-4254-4422-8688-04e099b073c4', 'reefer', 'RF-0023', 'Brock Service Refrigeration A'),
  ('41001683-9563-4590-b0c2-b5d5a8f6f9ef', 'reefer', 'RF-0024', 'Brock R&R Electric Standby Motor'),
  ('71f0e1dc-9c65-4106-ab42-572569905e77', 'reefer', 'RF-0025', 'Brock R&R Alternator'),
  ('485ab7e9-486f-4454-bf5a-2742d2cb346f', 'reefer', 'RF-0026', 'Brock Replace engine mounts, lower 2 rear, lower 2 front'),
  ('f086b183-c370-4681-a7ed-16109e9a0349', NULL,     'GN-0001', 'Brock test labor'),
  ('846fb88d-f59b-47f0-b08a-3b726a6edad9', NULL,     'GN-0002', 'Kurt pull driver headlight assembly to install new bulbs'),
  ('25f4af55-c6b6-4593-bbdb-b2c3c4164655', NULL,     'GN-0003', 'LD trial subscriber DISPATCH FEE'),
  ('a0e86de2-d19d-4ec7-99bf-1936f9de5ebc', NULL,     'GN-0004', 'LD trial subscriber SHOP SUPPLIES');

UPDATE public.hd_repair_items i
   SET equipment_type = COALESCE(i.equipment_type, b.set_type),
       labor_code     = b.expected
  FROM labor_code_backfill_167 b
 WHERE i.id = b.id AND i.labor_code IS NULL;

-- Counters start at the highest number used so far, for every prefix.
INSERT INTO public.hd_labor_code_counters AS c (prefix, last_value)
SELECT p, COALESCE((SELECT max(split_part(r.labor_code, '-', 2)::INTEGER)
                      FROM public.hd_repair_items r
                     WHERE split_part(r.labor_code, '-', 1) = p), 0)
  FROM unnest(ARRAY['RF','TC','TR','BM','AE','DD','AP','GS','OT','GN']) AS p
ON CONFLICT (prefix) DO UPDATE SET last_value = GREATEST(c.last_value, EXCLUDED.last_value);

-- Any row not in the list (added after it was written) is coded after it.
DO $do$
DECLARE r RECORD;
BEGIN
  FOR r IN SELECT id, equipment_type FROM public.hd_repair_items
            WHERE labor_code IS NULL ORDER BY is_master DESC, created_at, id LOOP
    UPDATE public.hd_repair_items
       SET labor_code = public.hd_next_labor_code(public.hd_labor_code_prefix(r.equipment_type))
     WHERE id = r.id;
  END LOOP;
END
$do$;

-- ---------------------------------------------------------------------------
-- 3. Constraints, now that every row has a code.
-- ---------------------------------------------------------------------------
ALTER TABLE public.hd_repair_items ALTER COLUMN labor_code SET NOT NULL;

ALTER TABLE public.hd_repair_items
  DROP CONSTRAINT IF EXISTS hd_repair_items_labor_code_key,
  DROP CONSTRAINT IF EXISTS hd_repair_items_labor_code_format_check,
  DROP CONSTRAINT IF EXISTS hd_repair_items_oem_labor_code_private_check;

ALTER TABLE public.hd_repair_items
  ADD CONSTRAINT hd_repair_items_labor_code_key UNIQUE (labor_code),
  ADD CONSTRAINT hd_repair_items_labor_code_format_check CHECK (
    labor_code ~ '^(RF|TC|TR|BM|AE|DD|AP|GS|OT|GN)-[0-9]{4,}$'),
  ADD CONSTRAINT hd_repair_items_oem_labor_code_private_check CHECK (
    oem_labor_code IS NULL OR scope <> 'global');

COMMENT ON COLUMN public.hd_repair_items.labor_code IS
  'Migration 167. NWI labor code, PREFIX-NNNN, assigned on insert by trigger, permanent, never reused.';
COMMENT ON COLUMN public.hd_repair_items.oem_labor_code IS
  'Migration 167. The shop''s private note of an OEM labor code. Never allowed on a global row.';

-- ---------------------------------------------------------------------------
-- 4. The triggers: assign on insert, refuse any change after.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.hd_repair_items_labor_code() RETURNS TRIGGER
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $fn$
BEGIN
  IF TG_OP = 'INSERT' THEN
    NEW.labor_code := public.hd_next_labor_code(public.hd_labor_code_prefix(NEW.equipment_type));
    RETURN NEW;
  END IF;
  IF NEW.labor_code IS DISTINCT FROM OLD.labor_code THEN
    RAISE EXCEPTION 'labor_code is permanent: % cannot be changed to %', OLD.labor_code, NEW.labor_code
      USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END
$fn$;

DROP TRIGGER IF EXISTS hd_repair_items_labor_code_insert ON public.hd_repair_items;
CREATE TRIGGER hd_repair_items_labor_code_insert
  BEFORE INSERT ON public.hd_repair_items
  FOR EACH ROW EXECUTE FUNCTION public.hd_repair_items_labor_code();

DROP TRIGGER IF EXISTS hd_repair_items_labor_code_update ON public.hd_repair_items;
CREATE TRIGGER hd_repair_items_labor_code_update
  BEFORE UPDATE ON public.hd_repair_items
  FOR EACH ROW EXECUTE FUNCTION public.hd_repair_items_labor_code();

-- ---------------------------------------------------------------------------
-- 5. No hard deletes by a shop.
-- ---------------------------------------------------------------------------
DROP POLICY IF EXISTS "hd_repair_items delete own" ON public.hd_repair_items;

-- ---------------------------------------------------------------------------
-- Checks
-- ---------------------------------------------------------------------------

-- Check 2. Expect 0, 0, 0 and the row count of the table (31 on 2026-10-24).
SELECT (SELECT count(*) FROM labor_code_backfill_167 b
          LEFT JOIN public.hd_repair_items i ON i.id = b.id
         WHERE i.labor_code IS DISTINCT FROM b.expected)                 AS mismatched,
       (SELECT count(*) FROM public.hd_repair_items WHERE labor_code IS NULL) AS without_code,
       (SELECT count(*) - count(DISTINCT labor_code) FROM public.hd_repair_items) AS duplicate_codes,
       (SELECT count(*) FROM public.hd_repair_items)                     AS total_rows;

-- Check 3. Counters. Expect RF 26, TC 1, GN 4, every other prefix 0.
SELECT prefix, last_value FROM public.hd_labor_code_counters ORDER BY prefix;

-- Check 4. Policies. Expect exactly 3: read own or catalog, insert own private,
-- update own private. No delete policy.
SELECT policyname, cmd FROM pg_policies
 WHERE schemaname = 'public' AND tablename = 'hd_repair_items'
 ORDER BY policyname;

-- Check 5. Triggers. Expect hd_repair_items_labor_code_insert and _update.
SELECT tgname FROM pg_trigger
 WHERE tgrelid = 'public.hd_repair_items'::regclass AND NOT tgisinternal
 ORDER BY tgname;

-- Check 1 (last, so the SQL editor shows it). EVERY existing row and the code it got. Expect 31 rows, ok true on all.
SELECT b.expected, i.labor_code AS got, (i.labor_code = b.expected) AS ok,
       i.equipment_type, b.note
  FROM labor_code_backfill_167 b
  LEFT JOIN public.hd_repair_items i ON i.id = b.id
 ORDER BY b.expected;

NOTIFY pgrst, 'reload schema';

COMMIT;
