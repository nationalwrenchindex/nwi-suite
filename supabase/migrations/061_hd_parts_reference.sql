CREATE TABLE IF NOT EXISTS public.hd_parts_reference (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  manufacturer TEXT NOT NULL
    CHECK (manufacturer IN ('TK','Carrier','Both')),
  unit_family TEXT,
  part_category TEXT NOT NULL,
  part_function TEXT NOT NULL,
  oem_part_number TEXT,
  baldwin TEXT,
  napa_gold TEXT,
  luber_finer TEXT,
  donaldson TEXT,
  fleetguard TEXT,
  wix TEXT,
  dayco TEXT,
  continental TEXT,
  gates TEXT,
  notes TEXT,
  verified BOOLEAN DEFAULT true,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

ALTER TABLE public.hd_parts_reference
  ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Public read parts reference"
  ON public.hd_parts_reference
  FOR SELECT TO public USING (true);
CREATE POLICY "Authenticated manage parts reference"
  ON public.hd_parts_reference
  FOR ALL TO authenticated USING (true);

CREATE INDEX IF NOT EXISTS idx_parts_ref_manufacturer
  ON public.hd_parts_reference(manufacturer);
CREATE INDEX IF NOT EXISTS idx_parts_ref_category
  ON public.hd_parts_reference(part_category);
CREATE INDEX IF NOT EXISTS idx_parts_ref_oem
  ON public.hd_parts_reference(oem_part_number);
