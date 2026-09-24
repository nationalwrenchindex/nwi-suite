-- Work Orders for the LD suite, plus PO numbers on quotes and invoices.
--
-- Work orders sit between a quote and an invoice for shops doing fleet or
-- commercial work: the job is authorised (often against a PO), worked over days,
-- and only billed once complete. Quotes cannot carry that — a quote is a single
-- pre-work document with no in-progress state and no photos.

-- ── 1. Feature flag ──────────────────────────────────────────────────────────
-- Beside torquewrench_addon_active (036) because it is the same kind of per-
-- business switch. Default false, and NOT NULL so no row can read as "unknown":
-- the feature is invisible until a human turns it on, and a null would make the
-- gate ambiguous at exactly the place that must fail closed.
ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS work_orders_enabled BOOLEAN DEFAULT false NOT NULL;

-- ── 2. PO numbers ────────────────────────────────────────────────────────────
-- Nullable TEXT, not an integer: a fleet's PO is "4417-B" or "PO/2026/0912" as
-- often as it is a number, and the shop types whatever the customer gave them.
ALTER TABLE public.quotes   ADD COLUMN IF NOT EXISTS po_number TEXT;
ALTER TABLE public.invoices ADD COLUMN IF NOT EXISTS po_number TEXT;

-- ── 3. Work orders ───────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.work_orders (
  id                      UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id                 UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  work_order_number       TEXT NOT NULL,
  status                  TEXT NOT NULL DEFAULT 'open',
  -- 'open' | 'in_progress' | 'complete'

  customer_id             UUID REFERENCES public.customers(id) ON DELETE SET NULL,
  vehicle_id              UUID REFERENCES public.vehicles(id)  ON DELETE SET NULL,
  -- Free text for anything that is not a vehicles row: "boat trailer", "shop
  -- compressor", "gate motor". Kept ALONGSIDE vehicle_id rather than replacing
  -- it, so a real vehicle still joins to its service history while the odd item
  -- can still be billed.
  unit_label              TEXT,

  job_description         TEXT,
  po_number               TEXT,

  -- Mirrors quotes (009) column for column so the existing line-item, markup and
  -- tax maths moves across untouched. A second implementation of money maths is
  -- how two screens start disagreeing about the same job.
  line_items              JSONB   DEFAULT '[]'::jsonb,
  labor_hours             NUMERIC,
  labor_rate              NUMERIC,
  parts_subtotal          NUMERIC,
  parts_markup_percent    NUMERIC,
  labor_subtotal          NUMERIC,
  tax_percent             NUMERIC,
  tax_amount              NUMERIC,
  grand_total             NUMERIC,

  tech_notes              TEXT,

  source                  TEXT DEFAULT 'manual',  -- 'manual' | 'quote' | 'quickwrench'
  source_quote_id         UUID REFERENCES public.quotes(id)   ON DELETE SET NULL,
  converted_invoice_id    UUID REFERENCES public.invoices(id) ON DELETE SET NULL,

  started_at              TIMESTAMP WITH TIME ZONE,
  completed_at            TIMESTAMP WITH TIME ZONE,
  converted_at            TIMESTAMP WITH TIME ZONE,

  -- Stamped when the customer text goes out. A status dragged back and forth
  -- must not text the same customer twice for the same transition — the tech
  -- correcting a misclick is not an event the customer should hear about.
  notified_in_progress_at TIMESTAMP WITH TIME ZONE,
  notified_complete_at    TIMESTAMP WITH TIME ZONE,

  created_at              TIMESTAMP WITH TIME ZONE DEFAULT now(),
  updated_at              TIMESTAMP WITH TIME ZONE DEFAULT now(),
  UNIQUE (user_id, work_order_number)
);

-- ── 4. Photos ────────────────────────────────────────────────────────────────
-- A row per file rather than a jsonb array, matching hd_work_order_photos: one
-- photo can then be deleted without rewriting the whole set, and the storage
-- object has somewhere to record its own caption.
--
-- NOTE: the 'work-order-photos' storage bucket cannot be created from SQL. Like
-- 'hd-work-order-photos' it is a dashboard step, and uploads fail until it exists.
CREATE TABLE IF NOT EXISTS public.work_order_photos (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  work_order_id UUID NOT NULL REFERENCES public.work_orders(id) ON DELETE CASCADE,
  user_id       UUID NOT NULL REFERENCES public.profiles(id)    ON DELETE CASCADE,
  file_url      TEXT NOT NULL,
  caption       TEXT,
  created_at    TIMESTAMP WITH TIME ZONE DEFAULT now()
);

-- ── 5. RLS ───────────────────────────────────────────────────────────────────
ALTER TABLE public.work_orders       ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.work_order_photos ENABLE ROW LEVEL SECURITY;

CREATE POLICY "work_orders: select own"
  ON public.work_orders FOR SELECT
  USING (auth.uid() = user_id);

CREATE POLICY "work_orders: insert own"
  ON public.work_orders FOR INSERT
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "work_orders: update own"
  ON public.work_orders FOR UPDATE
  USING (auth.uid() = user_id);

CREATE POLICY "work_orders: delete own"
  ON public.work_orders FOR DELETE
  USING (auth.uid() = user_id);

CREATE POLICY "work_order_photos: select own"
  ON public.work_order_photos FOR SELECT
  USING (auth.uid() = user_id);

CREATE POLICY "work_order_photos: insert own"
  ON public.work_order_photos FOR INSERT
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "work_order_photos: delete own"
  ON public.work_order_photos FOR DELETE
  USING (auth.uid() = user_id);

-- ── 6. Indexes ───────────────────────────────────────────────────────────────
CREATE INDEX IF NOT EXISTS idx_work_orders_user_id     ON public.work_orders(user_id);
CREATE INDEX IF NOT EXISTS idx_work_orders_status      ON public.work_orders(user_id, status);
CREATE INDEX IF NOT EXISTS idx_work_orders_customer_id ON public.work_orders(customer_id);
CREATE INDEX IF NOT EXISTS idx_work_orders_created     ON public.work_orders(user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_wo_photos_work_order_id ON public.work_order_photos(work_order_id);

-- ── 7. updated_at ────────────────────────────────────────────────────────────
CREATE TRIGGER set_work_orders_updated_at
  BEFORE UPDATE ON public.work_orders
  FOR EACH ROW EXECUTE PROCEDURE public.set_updated_at();
