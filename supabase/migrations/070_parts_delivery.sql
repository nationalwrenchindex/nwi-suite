-- Migration 070: Parts on the Way — Roadie delivery dispatch + Stripe payment

-- Parts delivery requests log
CREATE TABLE IF NOT EXISTS public.parts_deliveries (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id UUID NOT NULL REFERENCES auth.users(id),
  suite TEXT NOT NULL CHECK (suite IN ('ld','hd')),
  status TEXT NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending','quoted','payment_collected',
    'dispatched','picked_up','delivered','failed','cancelled')),

  -- Vehicle/unit info
  vehicle_year TEXT,
  vehicle_make TEXT,
  vehicle_model TEXT,
  vehicle_engine TEXT,
  vehicle_trim TEXT,
  vin TEXT,
  unit_manufacturer TEXT,
  unit_model TEXT,
  unit_serial TEXT,

  -- Parts
  parts_requested JSONB NOT NULL DEFAULT '[]',
  parts_confirmed JSONB DEFAULT '[]',

  -- Store
  store_name TEXT,
  store_address TEXT,
  store_phone TEXT,
  store_place_id TEXT,

  -- Delivery location
  delivery_lat DECIMAL(10,6),
  delivery_lng DECIMAL(10,6),
  delivery_address TEXT,

  -- Roadie
  roadie_delivery_id TEXT,
  roadie_quote_id TEXT,
  roadie_fee_cents INTEGER,
  roadie_eta_minutes INTEGER,
  roadie_tracking_url TEXT,
  roadie_driver_name TEXT,
  roadie_driver_phone TEXT,

  -- Payment
  platform_fee_cents INTEGER,
  total_charged_cents INTEGER,
  stripe_payment_intent_id TEXT,
  stripe_charge_id TEXT,

  -- Parts catalog contribution
  parts_verified BOOLEAN DEFAULT false,
  catalog_contributed BOOLEAN DEFAULT false,

  -- Timestamps
  quoted_at TIMESTAMPTZ,
  payment_collected_at TIMESTAMPTZ,
  dispatched_at TIMESTAMPTZ,
  delivered_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_parts_deliveries_user
  ON public.parts_deliveries(user_id);
CREATE INDEX IF NOT EXISTS idx_parts_deliveries_status
  ON public.parts_deliveries(status);

ALTER TABLE public.parts_deliveries ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "own deliveries" ON public.parts_deliveries;
CREATE POLICY "own deliveries" ON public.parts_deliveries
  FOR ALL TO authenticated
  USING (user_id = auth.uid())
  WITH CHECK (user_id = auth.uid());

-- Confirmed parts catalog (grows from verified deliveries)
CREATE TABLE IF NOT EXISTS public.confirmed_parts (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  suite TEXT NOT NULL CHECK (suite IN ('ld','hd')),

  -- Vehicle/unit identification
  vehicle_year TEXT,
  vehicle_make TEXT,
  vehicle_model TEXT,
  vehicle_engine TEXT,
  vehicle_trim TEXT,
  unit_manufacturer TEXT,
  unit_model TEXT,

  -- Part info
  part_name TEXT NOT NULL,
  oem_part_number TEXT,
  aftermarket_part_number TEXT,
  aftermarket_brand TEXT,

  -- Diagnostic context
  dtc_code TEXT,
  alarm_code TEXT,

  -- Verification
  confirmed_count INTEGER DEFAULT 1,
  last_confirmed_at TIMESTAMPTZ DEFAULT NOW(),
  first_confirmed_by UUID REFERENCES auth.users(id),

  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),

  UNIQUE(suite, vehicle_year, vehicle_make, vehicle_model,
         vehicle_engine, oem_part_number)
);

ALTER TABLE public.confirmed_parts ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "read confirmed parts" ON public.confirmed_parts;
CREATE POLICY "read confirmed parts" ON public.confirmed_parts
  FOR SELECT TO authenticated USING (true);
-- Writes via service role only
