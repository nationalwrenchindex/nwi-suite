-- Merge Kurt's duplicate unit: taylor oil company, unit 103, International s1800,
-- serial 1htlfuxn4eha38995, entered twice on 2026-10-02 three seconds apart.
--
-- STEP 1 OF 3. Run BEFORE migration 161 - its unique serial index refuses to build
-- while both rows are active.
--
-- PREVIEW AND PRODUCTION SHARE ONE DATABASE. This changes Kurt's live data.
--
-- NOTHING IS DELETED.
--   SURVIVOR  86bfb54c-c7d1-4505-a581-a937241ce415  (created first; it holds the
--             history: 1 work order WO-2026-0004, 1 invoice INV-2026-0001, 1 DOT
--             inspection - counted read-only on 2026-10-19)
--   RETIRED   a173ad9c-1ce5-4469-acd5-5c668023ae88  (no references at all)
-- Every row anywhere that points at the retired unit is repointed at the survivor -
-- found from the database's own foreign keys, not a hand list, so a table this file
-- does not name cannot be missed. Then the retired unit is marked inactive, with a
-- note saying where it went. Both rows stay.
--
-- Ends in ROLLBACK. Read the checks, then change ROLLBACK to COMMIT to keep it.

BEGIN;

-- Before: expect two rows, both active, same serial, same account.
SELECT id, unit_number, manufacturer, model, serial_number, status, active, user_id
  FROM hd_units
 WHERE id IN ('86bfb54c-c7d1-4505-a581-a937241ce415', 'a173ad9c-1ce5-4469-acd5-5c668023ae88');

-- Repoint every foreign key column that references hd_units(id).
DO $$
DECLARE
  survivor CONSTANT UUID := '86bfb54c-c7d1-4505-a581-a937241ce415';
  retired  CONSTANT UUID := 'a173ad9c-1ce5-4469-acd5-5c668023ae88';
  fk RECORD;
  n  INTEGER;
BEGIN
  -- Guard: both rows exist, belong to the same account and carry the same serial.
  IF (SELECT count(DISTINCT user_id) FROM hd_units WHERE id IN (survivor, retired)) <> 1
     OR (SELECT count(*) FROM hd_units WHERE id IN (survivor, retired)) <> 2
     OR (SELECT count(DISTINCT upper(btrim(serial_number))) FROM hd_units WHERE id IN (survivor, retired)) <> 1 THEN
    RAISE EXCEPTION 'merge guard failed: the two units are not the expected duplicate pair';
  END IF;

  FOR fk IN
    SELECT cl.relname AS tbl, att.attname AS col
      FROM pg_constraint con
      JOIN pg_class cl       ON cl.oid = con.conrelid
      JOIN pg_namespace ns   ON ns.oid = cl.relnamespace
      JOIN pg_attribute att  ON att.attrelid = con.conrelid AND att.attnum = con.conkey[1]
     WHERE con.contype = 'f'
       AND con.confrelid = 'public.hd_units'::regclass
       AND array_length(con.conkey, 1) = 1
       AND ns.nspname = 'public'
  LOOP
    EXECUTE format('UPDATE public.%I SET %I = $1 WHERE %I = $2', fk.tbl, fk.col, fk.col)
      USING survivor, retired;
    GET DIAGNOSTICS n = ROW_COUNT;
    RAISE NOTICE 'repointed % row(s) in %.%', n, fk.tbl, fk.col;
  END LOOP;

  UPDATE hd_units
     SET active = false,
         status = 'inactive',
         notes  = btrim(coalesce(notes, '') || ' Merged into unit ' || survivor ||
                  ' on 2026-10-19: duplicate entry of the same serial.'),
         updated_at = now()
   WHERE id = retired;
END;
$$;

-- After: the survivor active, the retired row inactive with its note.
SELECT id, unit_number, status, active, notes
  FROM hd_units
 WHERE id IN ('86bfb54c-c7d1-4505-a581-a937241ce415', 'a173ad9c-1ce5-4469-acd5-5c668023ae88');

-- Expect 0: nothing still points at the retired unit from the main HD tables.
SELECT
  (SELECT count(*) FROM hd_work_orders     WHERE unit_id = 'a173ad9c-1ce5-4469-acd5-5c668023ae88') AS work_orders,
  (SELECT count(*) FROM hd_invoices        WHERE unit_id = 'a173ad9c-1ce5-4469-acd5-5c668023ae88') AS invoices,
  (SELECT count(*) FROM hd_quotes          WHERE unit_id = 'a173ad9c-1ce5-4469-acd5-5c668023ae88') AS quotes,
  (SELECT count(*) FROM hd_dot_inspections WHERE unit_id = 'a173ad9c-1ce5-4469-acd5-5c668023ae88') AS dot_inspections;

-- Expect 1: the survivor still holds its work order.
SELECT count(*) AS survivor_work_orders FROM hd_work_orders
 WHERE unit_id = '86bfb54c-c7d1-4505-a581-a937241ce415';

ROLLBACK;
