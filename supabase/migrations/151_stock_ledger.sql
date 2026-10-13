-- =============================================================================
-- 151  The stock ledger: locations, movements, allocations
-- =============================================================================
--
-- THREE NEW TABLES, ONE VIEW, THREE TRIGGER FUNCTIONS, ONE NEW COLUMN ON
-- inventory. No existing row is modified and no table is dropped.
--
-- ONE NON-ADDITIVE STATEMENT, AND WHY. See section 2: the unique index
-- inventory_part_location_key from migration 148 is dropped and replaced. It encodes
-- the OLD location model, (location_type, location_name), and with that index in place
-- two different service vehicles both reduce to ('vehicle', NULL) and collide, which
-- makes the new model unusable. public.inventory HAS ZERO ROWS, verified immediately
-- before this migration was written, so no data is affected - only the index. The
-- location_type and location_name COLUMNS are left in place untouched.
--
-- -- WHAT ALREADY EXISTED, MEASURED -----------------------------------------
--
--   inventory (148)           0 rows. user_id, part_id, on_hand, min_qty, bin,
--                             location_type, location_name, last_cost, sell_price.
--                             There is NO `location` column - the brief says
--                             "inventory.location becomes a reference", and the thing
--                             to point at is a new location_id.
--   parts (148)               118 rows.
--   parts.vendor_price (149)  ABSENT - migration 149 has not been applied, so there is
--                             no catalog-level cost yet. inventory.last_cost is the
--                             per-shop cost and does exist, so receiving works without
--                             149; only the "vendor list price" column is missing.
--   product_usage_log         Exists, 0 rows. From migration 028, repaired by 145 - NOT
--                             a parts ledger. It logs DETAILER product usage.
--   products_inventory (028)  Exists, 2 rows. A SEPARATE, PRE-EXISTING detailer
--                             inventory with a different model entirely: total_uses,
--                             uses_remaining, low_stock_threshold, cost_cents. A bottle
--                             of wax with N applications left is not a discrete part,
--                             so it is deliberately NOT merged into this. Two systems,
--                             two domains.
--
-- -- WHERE A DEDUCTION HAS TO HOOK IN ---------------------------------------
--
--   LD work order lines   work_orders.line_items          JSONB on the parent
--   HD work order lines   hd_work_order_line_items        relational, 15 rows
--   LD invoice lines      invoices.line_items             JSONB
--   HD invoice lines      hd_invoices.line_items          JSONB
--
-- Both INVOICES store lines the same way, which is what lets one shared function
-- deduct for both products on finalize. The work-order side differs, so allocation
-- reads two shapes and writes one.
--
-- Lines identify a part by PART NUMBER (text), not by part_id. So the application
-- resolves part_number -> parts.id on the normalized number. A line whose number is
-- not in the catalog cannot move stock; those are reported, never silently dropped.

BEGIN;

-- -----------------------------------------------------------------------------
-- 1. stock_location - one row per place parts live
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.stock_location (
  id         UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id    UUID        NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,

  name       TEXT        NOT NULL CHECK (btrim(name) <> ''),
  kind       TEXT        NOT NULL DEFAULT 'shop' CHECK (kind IN ('shop', 'vehicle')),

  -- Where a deduction goes when the technician did not say. Exactly one per account,
  -- enforced by the partial unique index below.
  is_default BOOLEAN     NOT NULL DEFAULT FALSE,

  -- Retired rather than deleted: a location with movement history cannot be removed
  -- without taking the ledger with it, and the ledger is the point.
  active     BOOLEAN     NOT NULL DEFAULT TRUE,

  note       TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Case-insensitive, so "Truck 2" and "truck 2" cannot both exist and split a count.
CREATE UNIQUE INDEX IF NOT EXISTS stock_location_user_name_key
  ON public.stock_location (user_id, lower(btrim(name)));

CREATE UNIQUE INDEX IF NOT EXISTS stock_location_one_default_per_user
  ON public.stock_location (user_id) WHERE is_default;

CREATE INDEX IF NOT EXISTS stock_location_user_idx ON public.stock_location (user_id);

COMMENT ON TABLE public.stock_location IS
  'Every place a shop keeps parts: the shop itself and each named service vehicle. Per account. inventory.location_id and stock_movement.location_id both point here, which is what makes a location dropdown real and gives a transfer somewhere to go.';
COMMENT ON COLUMN public.stock_location.active IS
  'FALSE retires a location without deleting it. Deleting one would cascade away its movement history, and that history is what makes a count defensible.';

-- -----------------------------------------------------------------------------
-- 2. inventory.location_id
-- -----------------------------------------------------------------------------
ALTER TABLE public.inventory
  ADD COLUMN IF NOT EXISTS location_id UUID REFERENCES public.stock_location(id) ON DELETE RESTRICT;

COMMENT ON COLUMN public.inventory.location_id IS
  'The real location reference. Supersedes location_type and location_name, which are left in place from migration 148 but are no longer the key. ON DELETE RESTRICT so a location holding stock cannot be deleted out from under it.';

-- THE ONE NON-ADDITIVE STATEMENT. The 148 index keys on (location_type,
-- location_name); two vehicles with no name both collapse to ('vehicle', NULL) and
-- conflict. inventory has 0 rows, so this drops an index and no data.
DROP INDEX IF EXISTS public.inventory_part_location_key;

CREATE UNIQUE INDEX IF NOT EXISTS inventory_part_location_id_key
  ON public.inventory (user_id, part_id, location_id);

CREATE INDEX IF NOT EXISTS inventory_location_idx ON public.inventory (location_id);

-- Below or at the minimum, for the low-stock screen. min_qty IS NULL means nobody set
-- one, which is NOT a shortage - see migration 148's comment on that column.
CREATE INDEX IF NOT EXISTS inventory_low_stock_idx
  ON public.inventory (user_id, part_id)
  WHERE min_qty IS NOT NULL;

-- -----------------------------------------------------------------------------
-- 3. stock_movement - the ledger
-- -----------------------------------------------------------------------------
--
-- Every change to on_hand, ever. Append only. on_hand is DERIVED from this by the
-- trigger in section 6, and section 7 refuses any other way of changing it.
CREATE TABLE IF NOT EXISTS public.stock_movement (
  id           UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id      UUID        NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  part_id      UUID        NOT NULL REFERENCES public.parts(id) ON DELETE RESTRICT,
  location_id  UUID        NOT NULL REFERENCES public.stock_location(id) ON DELETE RESTRICT,

  -- Signed. Negative is a reduction. NOT NULL and never zero: a movement that moves
  -- nothing is noise in a ledger that exists to be read.
  delta        INTEGER     NOT NULL CHECK (delta <> 0),

  reason       TEXT        NOT NULL CHECK (reason IN (
                             'received',          -- bought from a vendor
                             'used',              -- billed on a finalized invoice
                             'adjusted',          -- a physical count differed
                             'transferred_in',    -- arrived from another location
                             'transferred_out',   -- left for another location
                             'returned',          -- came back from a job or to a vendor
                             'opening'            -- the first count when stock is set up
                           )),

  -- THE COST AT THE MOMENT OF USE. Copied onto the movement and never recalculated.
  -- Receiving at a new price changes inventory.last_cost; it must not change what an
  -- invoice already said, so the invoice reads the cost off its own movement row.
  unit_cost    NUMERIC(10, 2) CHECK (unit_cost IS NULL OR unit_cost >= 0),

  -- Where it came from. source_id is deliberately NOT a foreign key: a movement
  -- outlives the invoice or work order that caused it, and losing the ledger row
  -- because a document was deleted would defeat the purpose.
  source_type  TEXT        CHECK (source_type IS NULL OR source_type IN
                             ('invoice', 'hd_invoice', 'work_order', 'hd_work_order',
                              'receipt', 'count', 'transfer', 'manual')),
  source_id    UUID,
  -- The human reference - "INV-2026-0022", a vendor invoice number - so the ledger
  -- reads without a join.
  source_ref   TEXT,

  -- Groups the two halves of a transfer so they can be shown and reversed as one.
  transfer_id  UUID,

  note         TEXT,
  created_by   UUID        REFERENCES public.profiles(id) ON DELETE SET NULL,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS stock_movement_user_time_idx  ON public.stock_movement (user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS stock_movement_part_idx       ON public.stock_movement (part_id, location_id);
CREATE INDEX IF NOT EXISTS stock_movement_source_idx     ON public.stock_movement (source_type, source_id);
CREATE INDEX IF NOT EXISTS stock_movement_transfer_idx   ON public.stock_movement (transfer_id) WHERE transfer_id IS NOT NULL;

-- =====================================================================
-- THE DOUBLE-DEDUCTION GUARD. This is the rule "the ledger is the guard".
-- =====================================================================
--
-- One 'used' movement per (source document, part, location). An invoice that is
-- reopened and finalized again tries to insert the same row and the index refuses it,
-- so re-finalizing cannot deduct twice - and it cannot do so even if the application
-- logic is wrong, which is the point of putting it here.
--
-- This requires the application to AGGREGATE: an invoice with the same part on two
-- lines from one location writes ONE movement for the summed quantity, not two.
CREATE UNIQUE INDEX IF NOT EXISTS stock_movement_one_use_per_source
  ON public.stock_movement (source_type, source_id, part_id, location_id)
  WHERE reason = 'used' AND source_id IS NOT NULL;

COMMENT ON TABLE public.stock_movement IS
  'The stock ledger. Append only; every change to inventory.on_hand has a row here, and the trigger in this migration makes on_hand follow it rather than the other way round. A unique partial index refuses a second "used" movement for the same document, part and location, so re-finalizing an invoice cannot deduct twice.';
COMMENT ON COLUMN public.stock_movement.unit_cost IS
  'The cost recorded AT THE MOMENT OF THE MOVEMENT, never the current last_cost. An invoice reads its cost from here so that receiving at a new price cannot retroactively change a document the customer has already seen.';
COMMENT ON COLUMN public.stock_movement.source_id IS
  'Not a foreign key on purpose. The ledger must outlive the document that caused it; a cascade here would delete the evidence along with the invoice.';

-- -----------------------------------------------------------------------------
-- 4. stock_allocation - committed to an open job, not yet billed
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.stock_allocation (
  id               UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id          UUID        NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  part_id          UUID        NOT NULL REFERENCES public.parts(id) ON DELETE CASCADE,
  location_id      UUID        NOT NULL REFERENCES public.stock_location(id) ON DELETE RESTRICT,

  -- Which work order. Two products, two id spaces, so the kind is carried explicitly
  -- rather than guessed from which column is null.
  work_order_kind  TEXT        NOT NULL CHECK (work_order_kind IN ('ld', 'hd')),
  work_order_id    UUID        NOT NULL,

  quantity         INTEGER     NOT NULL CHECK (quantity > 0),

  -- Set when the allocation stops being live: the invoice finalized and became a
  -- movement, or the job was cancelled. Kept rather than deleted so "what did we
  -- commit to this job" is still answerable afterwards.
  released_at      TIMESTAMPTZ,
  released_reason  TEXT,

  created_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at       TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- One LIVE allocation per part per location per work order. Partial, so a released
-- row does not block a later re-allocation of the same part to the same job.
CREATE UNIQUE INDEX IF NOT EXISTS stock_allocation_live_key
  ON public.stock_allocation (work_order_kind, work_order_id, part_id, location_id)
  WHERE released_at IS NULL;

CREATE INDEX IF NOT EXISTS stock_allocation_part_idx
  ON public.stock_allocation (part_id, location_id) WHERE released_at IS NULL;
CREATE INDEX IF NOT EXISTS stock_allocation_wo_idx
  ON public.stock_allocation (work_order_kind, work_order_id);

COMMENT ON TABLE public.stock_allocation IS
  'Parts committed to an open work order but not yet billed. Available = on_hand - sum(live allocations). An allocation never changes on_hand; only a movement does.';

-- -----------------------------------------------------------------------------
-- 5. The counter view: on hand, allocated, available
-- -----------------------------------------------------------------------------
CREATE OR REPLACE VIEW public.inventory_position AS
SELECT
  i.id                AS inventory_id,
  i.user_id,
  i.part_id,
  i.location_id,
  l.name              AS location_name,
  l.kind              AS location_kind,
  i.bin,
  i.on_hand,
  i.min_qty,
  i.last_cost,
  i.sell_price,
  COALESCE(a.allocated, 0)              AS allocated,
  i.on_hand - COALESCE(a.allocated, 0)  AS available,
  -- Below the minimum only counts when a minimum was actually SET. min_qty IS NULL
  -- means nobody chose one, and treating that as a shortage would put the whole
  -- catalog on the low-stock screen.
  CASE WHEN i.min_qty IS NOT NULL
            AND (i.on_hand - COALESCE(a.allocated, 0)) <= i.min_qty
       THEN TRUE ELSE FALSE END         AS below_minimum,
  CASE WHEN i.on_hand < 0 THEN TRUE ELSE FALSE END AS negative
FROM public.inventory i
LEFT JOIN public.stock_location l ON l.id = i.location_id
LEFT JOIN (
  SELECT user_id, part_id, location_id, SUM(quantity) AS allocated
  FROM   public.stock_allocation
  WHERE  released_at IS NULL
  GROUP  BY user_id, part_id, location_id
) a ON a.user_id = i.user_id AND a.part_id = i.part_id AND a.location_id = i.location_id;

COMMENT ON VIEW public.inventory_position IS
  'What the parts counter reads: on hand, allocated and available per part per location, plus below_minimum and negative flags. One place, so no screen computes availability its own way.';

-- -----------------------------------------------------------------------------
-- 6. on_hand FOLLOWS the ledger
-- -----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.apply_stock_movement()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  -- Upsert, because the first movement for a part at a location is also what creates
  -- its inventory row. A received part should not need a row to exist first.
  INSERT INTO public.inventory (user_id, part_id, location_id, on_hand, location_type, location_name)
  VALUES (
    NEW.user_id, NEW.part_id, NEW.location_id, NEW.delta,
    COALESCE((SELECT kind FROM public.stock_location WHERE id = NEW.location_id), 'shop'),
    (SELECT name FROM public.stock_location WHERE id = NEW.location_id)
  )
  ON CONFLICT (user_id, part_id, location_id) DO UPDATE
    SET on_hand    = public.inventory.on_hand + NEW.delta,
        updated_at = now();

  -- Receiving updates the per-shop cost. Deliberately ONLY on 'received': a count or a
  -- transfer says nothing about what was paid, and 'used' must never write a cost back
  -- or the figure on an old invoice would start moving.
  IF NEW.reason = 'received' AND NEW.unit_cost IS NOT NULL THEN
    UPDATE public.inventory
    SET    last_cost = NEW.unit_cost, updated_at = now()
    WHERE  user_id = NEW.user_id AND part_id = NEW.part_id AND location_id = NEW.location_id;
  END IF;

  RETURN NEW;
END;
$$;

COMMENT ON FUNCTION public.apply_stock_movement() IS
  'Applies a ledger row to inventory.on_hand, creating the inventory row if this is the first movement for that part and location. Also updates last_cost, but only for a received movement - a count or a transfer is not evidence of a price.';

DROP TRIGGER IF EXISTS trg_apply_stock_movement ON public.stock_movement;
CREATE TRIGGER trg_apply_stock_movement
  AFTER INSERT ON public.stock_movement
  FOR EACH ROW
  EXECUTE FUNCTION public.apply_stock_movement();

-- -----------------------------------------------------------------------------
-- 7. NOTHING changes on_hand without a movement
-- -----------------------------------------------------------------------------
--
-- The brief's rule, made structural. pg_trigger_depth() is 0 for a statement issued
-- directly and greater than 0 inside a trigger, so the movement trigger above can
-- write on_hand and nothing else can - not the application, not a hand-typed UPDATE in
-- the SQL editor, not a future code path that forgets.
CREATE OR REPLACE FUNCTION public.guard_inventory_on_hand()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
  IF NEW.on_hand IS DISTINCT FROM OLD.on_hand AND pg_trigger_depth() <= 1 THEN
    RAISE EXCEPTION
      'on_hand cannot be set directly - insert a stock_movement instead (part %, location %)',
      OLD.part_id, OLD.location_id
      USING ERRCODE = 'check_violation',
            HINT = 'Every change to on_hand must leave a ledger row. See migration 151.';
  END IF;
  RETURN NEW;
END;
$$;

COMMENT ON FUNCTION public.guard_inventory_on_hand() IS
  'Refuses a direct change to inventory.on_hand. Only apply_stock_movement may change it, which is how "nothing changes on_hand without a movement row" stops being a convention and becomes a constraint. Everything else on the row - min_qty, bin, sell_price - is freely editable.';

DROP TRIGGER IF EXISTS trg_guard_inventory_on_hand ON public.inventory;
CREATE TRIGGER trg_guard_inventory_on_hand
  BEFORE UPDATE ON public.inventory
  FOR EACH ROW
  EXECUTE FUNCTION public.guard_inventory_on_hand();

-- -----------------------------------------------------------------------------
-- 8. Row level security - stock is the shop's own
-- -----------------------------------------------------------------------------
ALTER TABLE public.stock_location   ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.stock_movement   ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.stock_allocation ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Owner reads stock_location"    ON public.stock_location;
DROP POLICY IF EXISTS "Owner writes stock_location"   ON public.stock_location;
DROP POLICY IF EXISTS "Owner updates stock_location"  ON public.stock_location;
DROP POLICY IF EXISTS "Owner reads stock_movement"    ON public.stock_movement;
DROP POLICY IF EXISTS "Owner writes stock_movement"   ON public.stock_movement;
DROP POLICY IF EXISTS "Owner reads stock_allocation"  ON public.stock_allocation;
DROP POLICY IF EXISTS "Owner writes stock_allocation" ON public.stock_allocation;
DROP POLICY IF EXISTS "Owner updates stock_allocation" ON public.stock_allocation;

CREATE POLICY "Owner reads stock_location"
  ON public.stock_location FOR SELECT TO authenticated USING (auth.uid() = user_id);
CREATE POLICY "Owner writes stock_location"
  ON public.stock_location FOR INSERT TO authenticated WITH CHECK (auth.uid() = user_id);
CREATE POLICY "Owner updates stock_location"
  ON public.stock_location FOR UPDATE TO authenticated
  USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);

-- A ledger is append only. There is deliberately NO update or delete policy on
-- stock_movement: a wrong movement is corrected by a compensating movement, which
-- leaves both rows visible. Editing history is how a count stops being trustworthy.
CREATE POLICY "Owner reads stock_movement"
  ON public.stock_movement FOR SELECT TO authenticated USING (auth.uid() = user_id);
CREATE POLICY "Owner writes stock_movement"
  ON public.stock_movement FOR INSERT TO authenticated WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Owner reads stock_allocation"
  ON public.stock_allocation FOR SELECT TO authenticated USING (auth.uid() = user_id);
CREATE POLICY "Owner writes stock_allocation"
  ON public.stock_allocation FOR INSERT TO authenticated WITH CHECK (auth.uid() = user_id);
CREATE POLICY "Owner updates stock_allocation"
  ON public.stock_allocation FOR UPDATE TO authenticated
  USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);

-- -----------------------------------------------------------------------------
-- 9. Check it
-- -----------------------------------------------------------------------------
-- Expect three tables and one view.
SELECT table_name, table_type
FROM   information_schema.tables
WHERE  table_schema = 'public'
  AND  table_name IN ('stock_location', 'stock_movement', 'stock_allocation', 'inventory_position')
ORDER  BY table_name;

-- Expect inventory.location_id, uuid, nullable.
SELECT column_name, data_type, is_nullable
FROM   information_schema.columns
WHERE  table_schema = 'public' AND table_name = 'inventory' AND column_name = 'location_id';

-- Expect the double-deduction guard, and NOT the old 148 location index.
SELECT indexname
FROM   pg_indexes
WHERE  schemaname = 'public'
  AND  indexname IN ('stock_movement_one_use_per_source',
                     'inventory_part_location_id_key',
                     'inventory_part_location_key',
                     'stock_allocation_live_key',
                     'stock_location_one_default_per_user')
ORDER  BY indexname;

-- Expect both triggers.
SELECT trigger_name, event_object_table, event_manipulation, action_timing
FROM   information_schema.triggers
WHERE  event_object_schema = 'public'
  AND  trigger_name IN ('trg_apply_stock_movement', 'trg_guard_inventory_on_hand')
ORDER  BY trigger_name;

-- Expect SELECT and INSERT only on stock_movement - no UPDATE, no DELETE.
SELECT tablename, cmd, count(*) AS policies
FROM   pg_policies
WHERE  schemaname = 'public'
  AND  tablename IN ('stock_location', 'stock_movement', 'stock_allocation')
GROUP  BY tablename, cmd
ORDER  BY tablename, cmd;

-- Expect 0, 0, 0 - this migration creates structure, not stock.
SELECT (SELECT count(*) FROM public.stock_location)   AS locations,
       (SELECT count(*) FROM public.stock_movement)   AS movements,
       (SELECT count(*) FROM public.stock_allocation) AS allocations;

-- Expect 0. inventory was empty before this ran and this migration adds no rows, so
-- anything here means the index swap in section 2 was not as safe as stated.
SELECT count(*) AS inventory_rows FROM public.inventory;

COMMIT;
