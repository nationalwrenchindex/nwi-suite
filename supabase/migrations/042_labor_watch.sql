-- Labor Watch: arrival/departure timestamps, actual & suggested labor minutes, labor rate
ALTER TABLE public.jobs ADD COLUMN IF NOT EXISTS arrived_at              TIMESTAMPTZ;
ALTER TABLE public.jobs ADD COLUMN IF NOT EXISTS departed_at             TIMESTAMPTZ;
ALTER TABLE public.jobs ADD COLUMN IF NOT EXISTS actual_labor_minutes    INTEGER;
ALTER TABLE public.jobs ADD COLUMN IF NOT EXISTS suggested_labor_minutes INTEGER;
ALTER TABLE public.jobs ADD COLUMN IF NOT EXISTS labor_rate              DECIMAL(10,2);
