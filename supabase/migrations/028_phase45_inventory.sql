-- Phase 4.5: Detailer Inventory — Barcode Scanning & Crowdsourced Product Database

-- ── Global crowdsourced product database (shared across all users) ─────────────
CREATE TABLE IF NOT EXISTS products_global (
  id                         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  barcode                    text UNIQUE,
  name                       text NOT NULL,
  brand                      text,
  container_size             text,                    -- e.g. "1 gallon", "16 oz"
  default_cost_cents         int,
  default_uses_per_container int,
  category                   text,                   -- wash, wax, polish, ceramic…
  first_added_by             uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  confirmed_count            int  NOT NULL DEFAULT 1, -- trust signal: # detailers who confirmed
  created_at                 timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE products_global ENABLE ROW LEVEL SECURITY;

DO $$ BEGIN
  CREATE POLICY products_global_select ON products_global
    FOR SELECT TO authenticated USING (true);
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE POLICY products_global_insert ON products_global
    FOR INSERT TO authenticated WITH CHECK (true);
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- ── Per-user inventory products ───────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS products_inventory (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id             uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  global_product_id   uuid REFERENCES products_global(id) ON DELETE SET NULL,
  name                text NOT NULL,
  brand               text,
  container_size      text,
  cost_cents          int  NOT NULL DEFAULT 0,
  total_uses          int  NOT NULL DEFAULT 1,
  uses_remaining      int  NOT NULL DEFAULT 1,
  low_stock_threshold int  NOT NULL DEFAULT 5,
  category            text,
  created_at          timestamptz NOT NULL DEFAULT now(),
  updated_at          timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE products_inventory ENABLE ROW LEVEL SECURITY;

DO $$ BEGIN
  CREATE POLICY products_inventory_all ON products_inventory
    FOR ALL TO authenticated
    USING (user_id = auth.uid())
    WITH CHECK (user_id = auth.uid());
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- ── Service → product mappings ────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS service_products (
  id                   uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id              uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  service_name         text NOT NULL,                  -- matches DETAILER_SERVICES display names
  product_inventory_id uuid NOT NULL REFERENCES products_inventory(id) ON DELETE CASCADE,
  quantity_used        numeric NOT NULL DEFAULT 1.0,   -- 1.0 = one full use, 0.5 = half
  created_at           timestamptz NOT NULL DEFAULT now(),
  UNIQUE (user_id, service_name, product_inventory_id)
);

ALTER TABLE service_products ENABLE ROW LEVEL SECURITY;

DO $$ BEGIN
  CREATE POLICY service_products_all ON service_products
    FOR ALL TO authenticated
    USING (user_id = auth.uid())
    WITH CHECK (user_id = auth.uid());
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- ── Per-job product usage log ─────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS product_usage_log (
  id                    uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id               uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  product_inventory_id  uuid NOT NULL REFERENCES products_inventory(id) ON DELETE CASCADE,
  job_id                uuid REFERENCES jobs(id) ON DELETE SET NULL,
  service_name          text,
  quantity_used         numeric NOT NULL,
  cost_cents_attributed int     NOT NULL DEFAULT 0,
  logged_at             timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE product_usage_log ENABLE ROW LEVEL SECURITY;

DO $$ BEGIN
  CREATE POLICY product_usage_log_all ON product_usage_log
    FOR ALL TO authenticated
    USING (user_id = auth.uid())
    WITH CHECK (user_id = auth.uid());
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- ── Bill consumables separately toggle ───────────────────────────────────────
ALTER TABLE profiles
  ADD COLUMN IF NOT EXISTS bill_consumables_separately boolean NOT NULL DEFAULT false;
