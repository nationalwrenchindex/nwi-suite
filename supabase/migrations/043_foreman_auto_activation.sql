-- Foreman auto-activation: on-job and after-hours coverage toggles
ALTER TABLE public.foreman_settings ADD COLUMN IF NOT EXISTS auto_job_activation   BOOLEAN DEFAULT false;
ALTER TABLE public.foreman_settings ADD COLUMN IF NOT EXISTS auto_hours_activation BOOLEAN DEFAULT false;
ALTER TABLE public.foreman_settings ADD COLUMN IF NOT EXISTS business_hours        JSONB;
ALTER TABLE public.foreman_settings ADD COLUMN IF NOT EXISTS foreman_activated_reason TEXT;
