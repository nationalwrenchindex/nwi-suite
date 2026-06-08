CREATE TABLE IF NOT EXISTS public.hd_alarm_codes (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  manufacturer TEXT NOT NULL CHECK (manufacturer IN ('TK','Carrier')),
  unit_family TEXT NOT NULL,
  alarm_code TEXT,
  display_text TEXT,
  meaning TEXT NOT NULL,
  severity TEXT CHECK (severity IN ('immediate','check','maintenance','info')) DEFAULT 'check',
  common_causes TEXT,
  diagnostic_steps TEXT,
  field_notes TEXT,
  common_fix TEXT,
  parts_needed TEXT,
  safety_warning TEXT,
  shore_power_warning BOOLEAN DEFAULT false,
  wiring_reference TEXT,
  book_time DECIMAL(4,1),
  mobile_time DECIMAL(4,1),
  verified BOOLEAN DEFAULT true,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_alarm_codes_manufacturer ON public.hd_alarm_codes(manufacturer);
CREATE INDEX IF NOT EXISTS idx_alarm_codes_unit_family  ON public.hd_alarm_codes(unit_family);
CREATE INDEX IF NOT EXISTS idx_alarm_codes_code         ON public.hd_alarm_codes(alarm_code);
CREATE INDEX IF NOT EXISTS idx_alarm_codes_display
  ON public.hd_alarm_codes USING gin(to_tsvector('english', coalesce(display_text,'')));

ALTER TABLE public.hd_alarm_codes ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Public read alarm codes"       ON public.hd_alarm_codes FOR SELECT TO public        USING (true);
CREATE POLICY "Authenticated manage alarm codes" ON public.hd_alarm_codes FOR ALL    TO authenticated USING (true);
