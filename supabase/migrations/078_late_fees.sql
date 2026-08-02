-- Migration 078: late-fee engine (per-tech settings + invoice late-fee tracking).

CREATE TABLE IF NOT EXISTS public.late_fee_settings (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id UUID NOT NULL REFERENCES auth.users(id),
  grace_period_days INTEGER DEFAULT 0,
  fee_type TEXT CHECK (fee_type IN ('flat','percentage'))
    DEFAULT 'flat',
  flat_fee_amount DECIMAL(10,2) DEFAULT 25.00,
  percentage_rate DECIMAL(5,2) DEFAULT 1.5,
  send_sms_notification BOOLEAN DEFAULT true,
  active BOOLEAN DEFAULT true,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_late_fee_settings_user
  ON public.late_fee_settings (user_id);

ALTER TABLE public.late_fee_settings
  ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "own late fee settings" ON public.late_fee_settings;
CREATE POLICY "own late fee settings"
  ON public.late_fee_settings
  FOR ALL TO authenticated
  USING (user_id = auth.uid())
  WITH CHECK (user_id = auth.uid());

ALTER TABLE public.hd_invoices
  ADD COLUMN IF NOT EXISTS late_fee_applied
    BOOLEAN DEFAULT false,
  ADD COLUMN IF NOT EXISTS late_fee_amount
    DECIMAL(10,2) DEFAULT 0,
  ADD COLUMN IF NOT EXISTS late_fee_applied_at
    TIMESTAMPTZ;
