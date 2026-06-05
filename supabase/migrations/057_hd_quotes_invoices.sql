CREATE TABLE IF NOT EXISTS public.hd_quotes (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id UUID REFERENCES public.profiles(id) ON DELETE CASCADE,
  quote_number TEXT NOT NULL,
  customer_name TEXT NOT NULL,
  customer_phone TEXT,
  customer_email TEXT,
  unit_manufacturer TEXT,
  unit_model TEXT,
  unit_serial TEXT,
  unit_year TEXT,
  truck_make TEXT,
  truck_model TEXT,
  truck_year TEXT,
  vin TEXT,
  complaint TEXT,
  diagnosis TEXT,
  line_items JSONB DEFAULT '[]',
  labor_rate DECIMAL(8,2) DEFAULT 125.00,
  subtotal_labor DECIMAL(10,2) DEFAULT 0,
  subtotal_parts DECIMAL(10,2) DEFAULT 0,
  diagnostic_fee DECIMAL(10,2) DEFAULT 125.00,
  road_call_fee DECIMAL(10,2) DEFAULT 0,
  tax_rate DECIMAL(5,2) DEFAULT 0,
  tax_amount DECIMAL(10,2) DEFAULT 0,
  total DECIMAL(10,2) DEFAULT 0,
  notes TEXT,
  status TEXT DEFAULT 'draft' CHECK (status IN ('draft','sent','approved','declined')),
  valid_until DATE,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS public.hd_invoices (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id UUID REFERENCES public.profiles(id) ON DELETE CASCADE,
  quote_id UUID REFERENCES public.hd_quotes(id),
  invoice_number TEXT NOT NULL,
  customer_name TEXT NOT NULL,
  customer_phone TEXT,
  customer_email TEXT,
  unit_manufacturer TEXT,
  unit_model TEXT,
  unit_serial TEXT,
  unit_year TEXT,
  truck_make TEXT,
  truck_model TEXT,
  truck_year TEXT,
  vin TEXT,
  complaint TEXT,
  diagnosis TEXT,
  line_items JSONB DEFAULT '[]',
  labor_rate DECIMAL(8,2) DEFAULT 125.00,
  subtotal_labor DECIMAL(10,2) DEFAULT 0,
  subtotal_parts DECIMAL(10,2) DEFAULT 0,
  diagnostic_fee DECIMAL(10,2) DEFAULT 125.00,
  road_call_fee DECIMAL(10,2) DEFAULT 0,
  tax_rate DECIMAL(5,2) DEFAULT 0,
  tax_amount DECIMAL(10,2) DEFAULT 0,
  total DECIMAL(10,2) DEFAULT 0,
  notes TEXT,
  payment_terms TEXT DEFAULT 'Due on receipt',
  status TEXT DEFAULT 'unpaid' CHECK (status IN ('unpaid','paid','partial','void')),
  paid_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_hd_quotes_user ON public.hd_quotes(user_id);
CREATE INDEX IF NOT EXISTS idx_hd_invoices_user ON public.hd_invoices(user_id);
CREATE INDEX IF NOT EXISTS idx_hd_invoices_quote ON public.hd_invoices(quote_id);

ALTER TABLE public.hd_quotes ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.hd_invoices ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users manage own HD quotes" ON public.hd_quotes FOR ALL USING (auth.uid() = user_id);
CREATE POLICY "Users manage own HD invoices" ON public.hd_invoices FOR ALL USING (auth.uid() = user_id);
