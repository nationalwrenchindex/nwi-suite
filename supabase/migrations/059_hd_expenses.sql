CREATE TABLE IF NOT EXISTS public.hd_expenses (
  id          UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id     UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  category    TEXT NOT NULL,
  description TEXT NOT NULL,
  amount      DECIMAL(10,2) NOT NULL,
  expense_date DATE NOT NULL DEFAULT CURRENT_DATE,
  notes       TEXT,
  created_at  TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_hd_expenses_user_id   ON public.hd_expenses(user_id);
CREATE INDEX IF NOT EXISTS idx_hd_expenses_date      ON public.hd_expenses(expense_date DESC);

ALTER TABLE public.hd_expenses ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Users manage own HD expenses" ON public.hd_expenses
  FOR ALL TO authenticated USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);
