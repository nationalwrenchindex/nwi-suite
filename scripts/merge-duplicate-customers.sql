-- --- Merge duplicate customers ------------------------------------------------
--
-- ONE-OFF DATA FIX. Deliberately NOT a numbered migration: it names specific rows in
-- one production database and would be meaningless anywhere else.
--
-- Three groups, five rows deleted. Every group is the same shop holding the same person
-- more than once. Rows held by DIFFERENT shops are never touched -- customers are
-- per-shop, so three shops each having Brock Fleeman is three shops with one customer,
-- not a duplicate. (Production has exactly that, and it stays.)
--
-- -- TWO THINGS THAT WILL BITE IF THE ORDER CHANGES ---------------------------
--
--   vehicles.customer_id    ON DELETE CASCADE
--       Deleting a duplicate BEFORE repointing its vehicles DELETES THOSE VEHICLES.
--       Brock Fleeman's duplicate owns one. Repoint first, always.
--
--   inspections.customer_id NO ACTION (no ON DELETE clause at all)
--       A duplicate with an inspection cannot be deleted until it is repointed. None
--       of these three have one, but the UPDATE is included so this stays correct if
--       it is ever re-run against different rows.
--
-- Everything runs in one transaction. Read the counts it prints before COMMIT.

BEGIN;

-- -- The pairs. survivor_id keeps everything; duplicate_id is repointed then deleted --
CREATE TEMP TABLE customer_merge (survivor_id uuid, duplicate_id uuid, label text) ON COMMIT DROP;

INSERT INTO customer_merge (survivor_id, duplicate_id, label) VALUES
  -- Brock Fleeman @ Refrigerated Transportation Service and Repair.
  -- Survivor has phone, email, address and 11 referencing rows; the duplicate was
  -- created two minutes later with no contact details at all.
  ('a5a3bfca-d576-4c88-8832-535966fb89ef', '2079e57b-ac4c-40fa-a5d8-5e8a13e85c2e', 'Brock Fleeman'),

  -- Josh Johnston @ C&K UTILITY EQUIPMENT SERVICE.
  -- Three rows inside 32 minutes, none with a phone or email. Survivor is the oldest
  -- and the one holding the vehicle.
  ('7a6bf791-20fa-4dcc-93a0-b9fcba4d4b2a', '94dc525a-dad9-4640-a020-ea9fab82647e', 'Josh Johnston'),
  ('7a6bf791-20fa-4dcc-93a0-b9fcba4d4b2a', '8ce3052c-9125-4057-aef8-ace9dc4183d0', 'Josh Johnston'),

  -- Polk Sherrif @ C&K UTILITY EQUIPMENT SERVICE.
  -- Three rows inside five minutes. Survivor is the only one with an email and the only
  -- one anything references; the other two are empty shells.
  ('97e52324-4601-45f6-bea7-a794da798112', '7b9fc3f6-6b75-4e1d-8735-da90c8681eb5', 'Polk Sherrif'),
  ('97e52324-4601-45f6-bea7-a794da798112', '7901bb38-c83e-4422-b642-8f595f99da0e', 'Polk Sherrif');

-- -- Refuse to run if a pair crosses two shops ---------------------------------
-- A survivor and a duplicate under different user_ids would move one shop's customer
-- record into another shop's account. That is the one mistake here that cannot be
-- undone by re-running anything, so it aborts instead.
DO $$
DECLARE bad int;
BEGIN
  SELECT count(*) INTO bad
    FROM customer_merge m
    JOIN public.customers s ON s.id = m.survivor_id
    JOIN public.customers d ON d.id = m.duplicate_id
   WHERE s.user_id <> d.user_id;
  IF bad > 0 THEN
    RAISE EXCEPTION 'ABORT: % pair(s) span two different shops', bad;
  END IF;
END $$;

-- -- What is about to move -----------------------------------------------------
SELECT 'BEFORE' AS phase, m.label, m.duplicate_id,
       (SELECT count(*) FROM public.vehicles          x WHERE x.customer_id = m.duplicate_id) AS vehicles,
       (SELECT count(*) FROM public.jobs              x WHERE x.customer_id = m.duplicate_id) AS jobs,
       (SELECT count(*) FROM public.invoices          x WHERE x.customer_id = m.duplicate_id) AS invoices,
       (SELECT count(*) FROM public.quotes            x WHERE x.customer_id = m.duplicate_id) AS quotes,
       (SELECT count(*) FROM public.work_orders       x WHERE x.customer_id = m.duplicate_id) AS work_orders,
       (SELECT count(*) FROM public.hd_invoices       x WHERE x.customer_id = m.duplicate_id) AS hd_invoices,
       (SELECT count(*) FROM public.inspections       x WHERE x.customer_id = m.duplicate_id) AS inspections,
       (SELECT count(*) FROM public.notification_logs x WHERE x.customer_id = m.duplicate_id) AS notification_logs
  FROM customer_merge m
 ORDER BY m.label, m.duplicate_id;

-- -- Repoint. vehicles FIRST, because of the CASCADE ---------------------------
UPDATE public.vehicles          v SET customer_id = m.survivor_id FROM customer_merge m WHERE v.customer_id = m.duplicate_id;
UPDATE public.jobs              j SET customer_id = m.survivor_id FROM customer_merge m WHERE j.customer_id = m.duplicate_id;
UPDATE public.invoices          i SET customer_id = m.survivor_id FROM customer_merge m WHERE i.customer_id = m.duplicate_id;
UPDATE public.quotes            q SET customer_id = m.survivor_id FROM customer_merge m WHERE q.customer_id = m.duplicate_id;
UPDATE public.work_orders       w SET customer_id = m.survivor_id FROM customer_merge m WHERE w.customer_id = m.duplicate_id;
UPDATE public.hd_invoices       h SET customer_id = m.survivor_id FROM customer_merge m WHERE h.customer_id = m.duplicate_id;
UPDATE public.inspections       n SET customer_id = m.survivor_id FROM customer_merge m WHERE n.customer_id = m.duplicate_id;
UPDATE public.notification_logs l SET customer_id = m.survivor_id FROM customer_merge m WHERE l.customer_id = m.duplicate_id;

-- -- Fill any gap on the survivor from the row being deleted -------------------
-- Only where the survivor is NULL, so a duplicate can never overwrite a value somebody
-- maintained deliberately. All five duplicates here are emptier than their survivor, so
-- this is expected to change nothing -- it is here so a re-run against other rows does
-- not silently lose a phone number.
UPDATE public.customers s SET
  phone         = COALESCE(s.phone,         d.phone),
  email         = COALESCE(s.email,         d.email),
  company_name  = COALESCE(s.company_name,  d.company_name),
  address_line1 = COALESCE(s.address_line1, d.address_line1),
  address_line2 = COALESCE(s.address_line2, d.address_line2),
  city          = COALESCE(s.city,          d.city),
  state         = COALESCE(s.state,         d.state),
  zip           = COALESCE(s.zip,           d.zip),
  notes         = COALESCE(s.notes,         d.notes),
  updated_at    = now()
FROM customer_merge m
JOIN public.customers d ON d.id = m.duplicate_id
WHERE s.id = m.survivor_id;

-- -- Nothing may still point at a row about to be deleted ----------------------
DO $$
DECLARE stragglers int;
BEGIN
  SELECT
    (SELECT count(*) FROM public.vehicles          x JOIN customer_merge m ON x.customer_id = m.duplicate_id) +
    (SELECT count(*) FROM public.jobs              x JOIN customer_merge m ON x.customer_id = m.duplicate_id) +
    (SELECT count(*) FROM public.invoices          x JOIN customer_merge m ON x.customer_id = m.duplicate_id) +
    (SELECT count(*) FROM public.quotes            x JOIN customer_merge m ON x.customer_id = m.duplicate_id) +
    (SELECT count(*) FROM public.work_orders       x JOIN customer_merge m ON x.customer_id = m.duplicate_id) +
    (SELECT count(*) FROM public.hd_invoices       x JOIN customer_merge m ON x.customer_id = m.duplicate_id) +
    (SELECT count(*) FROM public.inspections       x JOIN customer_merge m ON x.customer_id = m.duplicate_id) +
    (SELECT count(*) FROM public.notification_logs x JOIN customer_merge m ON x.customer_id = m.duplicate_id)
    INTO stragglers;
  IF stragglers > 0 THEN
    RAISE EXCEPTION 'ABORT: % row(s) still reference a duplicate - the CASCADE on vehicles would destroy data', stragglers;
  END IF;
END $$;

-- -- Delete --------------------------------------------------------------------
DELETE FROM public.customers c USING customer_merge m WHERE c.id = m.duplicate_id;

-- -- What the survivors look like now ------------------------------------------
SELECT 'AFTER' AS phase, c.id, c.first_name, c.last_name, c.phone, c.email,
       (SELECT count(*) FROM public.vehicles    x WHERE x.customer_id = c.id) AS vehicles,
       (SELECT count(*) FROM public.jobs        x WHERE x.customer_id = c.id) AS jobs,
       (SELECT count(*) FROM public.invoices    x WHERE x.customer_id = c.id) AS invoices,
       (SELECT count(*) FROM public.quotes      x WHERE x.customer_id = c.id) AS quotes,
       (SELECT count(*) FROM public.work_orders x WHERE x.customer_id = c.id) AS work_orders,
       (SELECT count(*) FROM public.hd_invoices x WHERE x.customer_id = c.id) AS hd_invoices
  FROM public.customers c
 WHERE c.id IN (SELECT DISTINCT survivor_id FROM customer_merge)
 ORDER BY c.last_name, c.first_name;

-- Read the AFTER rows, then:
COMMIT;
-- ROLLBACK;  -- if anything looks wrong

-- -- ONE THING TO LOOK AT AFTERWARDS, NOT AUTOMATED ---------------------------
-- Brock Fleeman's survivor owns one vehicle and the duplicate owned another, so after
-- the merge he has TWO. They may be the same truck entered twice, or genuinely two
-- vehicles. Merging vehicles is a different decision with its own cascade (service
-- history hangs off vehicle_id) and is deliberately left alone:
--
--   SELECT id, year, make, model, vin, license_plate
--     FROM public.vehicles
--    WHERE customer_id = 'a5a3bfca-d576-4c88-8832-535966fb89ef';
