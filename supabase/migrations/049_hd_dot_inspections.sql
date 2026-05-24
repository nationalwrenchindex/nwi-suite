CREATE TABLE IF NOT EXISTS public.hd_dot_inspections (
  id                   UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id              UUID REFERENCES auth.users(id) ON DELETE CASCADE,
  unit_id              UUID REFERENCES public.hd_units(id),
  fleet_account_id     UUID REFERENCES public.hd_fleet_accounts(id),
  inspection_date      DATE NOT NULL,
  inspector_name       TEXT,
  inspector_cert_number TEXT,
  odometer_hours       TEXT,
  location             TEXT,
  inspection_data      JSONB NOT NULL,
  violations           JSONB,
  overall_result       TEXT DEFAULT 'pass',
  signature_data       TEXT,
  locked               BOOLEAN DEFAULT false,
  locked_at            TIMESTAMPTZ,
  inspection_id        TEXT UNIQUE,
  created_at           TIMESTAMPTZ DEFAULT NOW()
);

ALTER TABLE public.hd_dot_inspections ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users manage own dot inspections"
  ON public.hd_dot_inspections
  FOR ALL
  USING (auth.uid() = user_id);
