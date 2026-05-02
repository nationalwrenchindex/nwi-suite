-- Phase 4.6 Sub-3: Detailer quote redesign
-- Adds service_lines / adjustments / tip model; replaces labor_rate for detailers.

-- ── 1. Adjustment presets table ───────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.detailer_adjustment_presets (
  id          UUID                     PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id     UUID                     NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  name        TEXT                     NOT NULL,
  price_cents INTEGER                  NOT NULL DEFAULT 0,
  sort_order  INTEGER                  NOT NULL DEFAULT 0,
  created_at  TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

ALTER TABLE public.detailer_adjustment_presets ENABLE ROW LEVEL SECURITY;

CREATE INDEX IF NOT EXISTS idx_adj_presets_user
  ON public.detailer_adjustment_presets(user_id, sort_order);

CREATE POLICY "adj_presets: select own"
  ON public.detailer_adjustment_presets FOR SELECT  USING (auth.uid() = user_id);
CREATE POLICY "adj_presets: insert own"
  ON public.detailer_adjustment_presets FOR INSERT  WITH CHECK (auth.uid() = user_id);
CREATE POLICY "adj_presets: update own"
  ON public.detailer_adjustment_presets FOR UPDATE  USING (auth.uid() = user_id);
CREATE POLICY "adj_presets: delete own"
  ON public.detailer_adjustment_presets FOR DELETE  USING (auth.uid() = user_id);

-- ── 2. New JSONB columns on quotes ────────────────────────────────────────────
ALTER TABLE public.quotes
  ADD COLUMN IF NOT EXISTS service_lines    JSONB   NOT NULL DEFAULT '[]'::jsonb,
  ADD COLUMN IF NOT EXISTS adjustments      JSONB   NOT NULL DEFAULT '[]'::jsonb,
  ADD COLUMN IF NOT EXISTS tip_amount_cents INTEGER NOT NULL DEFAULT 0;

-- ── 3. New JSONB columns on invoices ─────────────────────────────────────────
ALTER TABLE public.invoices
  ADD COLUMN IF NOT EXISTS service_lines    JSONB   NOT NULL DEFAULT '[]'::jsonb,
  ADD COLUMN IF NOT EXISTS adjustments      JSONB   NOT NULL DEFAULT '[]'::jsonb,
  ADD COLUMN IF NOT EXISTS tip_amount_cents INTEGER NOT NULL DEFAULT 0;

-- ── 4. Seed 6 default adjustment presets for existing detailer accounts ───────
-- Only seeds for accounts that have no presets yet (idempotent).
INSERT INTO public.detailer_adjustment_presets (user_id, name, price_cents, sort_order)
SELECT
  p.id AS user_id,
  v.name,
  v.price_cents,
  v.sort_order
FROM public.profiles p
CROSS JOIN (VALUES
  ('Heavy soil',          5000, 0),
  ('Pet hair (heavy)',    4000, 1),
  ('Smoke remediation',   7500, 2),
  ('Excessive odor',      5000, 3),
  ('Extra-large vehicle', 3500, 4),
  ('Engine bay add',      4000, 5)
) AS v(name, price_cents, sort_order)
WHERE p.business_type = 'detailer'
  AND NOT EXISTS (
    SELECT 1 FROM public.detailer_adjustment_presets x WHERE x.user_id = p.id
  );

-- ── 5. Migrate existing detailer quotes ───────────────────────────────────────
-- Move labor_rate → service_lines (if nonzero and service_lines still empty).
-- Strip synthetic 'Service' entries from line_items.
-- Zero out legacy labor fields — they are mechanic-only going forward.
UPDATE public.quotes q
SET
  service_lines = CASE
    WHEN COALESCE(q.labor_rate, 0) > 0
      AND (q.service_lines IS NULL OR q.service_lines = '[]'::jsonb)
    THEN jsonb_build_array(jsonb_build_object(
      'service_name',     COALESCE(q.job_subtype, 'Service'),
      'vehicle_category', NULL,
      'price_cents',      ROUND(COALESCE(q.labor_rate, 0) * 100)::integer
    ))
    ELSE COALESCE(q.service_lines, '[]'::jsonb)
  END,
  line_items = COALESCE(
    (SELECT jsonb_agg(li)
     FROM   jsonb_array_elements(
              CASE WHEN jsonb_typeof(q.line_items) = 'array'
                   THEN q.line_items ELSE '[]'::jsonb END
            ) AS li
     WHERE  (li->>'description') IS DISTINCT FROM 'Service'),
    '[]'::jsonb
  ),
  labor_rate     = 0,
  labor_subtotal = 0
WHERE q.user_id IN (
  SELECT id FROM public.profiles WHERE business_type = 'detailer'
);
