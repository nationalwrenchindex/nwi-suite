-- QuickWrench module: parts finder + AI tech guide + quote builder

CREATE TABLE IF NOT EXISTS public.quickwrench_quotes (
  id                 UUID          DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id            UUID          REFERENCES auth.users(id) ON DELETE CASCADE,
  vin                TEXT,
  vehicle_year       TEXT,
  vehicle_make       TEXT,
  vehicle_model      TEXT,
  vehicle_engine     TEXT,
  job_category       TEXT,
  job_name           TEXT,
  parts_list         JSONB,
  parts_total        DECIMAL(10,2),
  labor_hours        DECIMAL(5,2),
  labor_rate         DECIMAL(10,2),
  labor_total        DECIMAL(10,2),
  markup_percent     DECIMAL(5,2),
  tax_amount         DECIMAL(10,2),
  grand_total        DECIMAL(10,2),
  customer_name      TEXT,
  customer_phone     TEXT,
  status             TEXT          DEFAULT 'draft',
  created_at         TIMESTAMPTZ   DEFAULT NOW()
);

ALTER TABLE public.quickwrench_quotes ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can manage their own quickwrench quotes"
  ON public.quickwrench_quotes
  FOR ALL
  USING  (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

CREATE INDEX IF NOT EXISTS quickwrench_quotes_user_id_created_at
  ON public.quickwrench_quotes (user_id, created_at DESC);
