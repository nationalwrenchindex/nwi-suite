-- Migration 068: extend hd_repair_items to serve as the quote-form personal labor library

ALTER TABLE public.hd_repair_items
  ADD COLUMN IF NOT EXISTS use_count INTEGER DEFAULT 0,
  ADD COLUMN IF NOT EXISTS last_used_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS source TEXT DEFAULT 'manual'
    CHECK (source IN ('manual','quickwrench','seed'));

-- source: 'seed' = master items I seeded, 'quickwrench' = auto-saved from
-- push-to-quote, 'manual' = tech typed it themselves on the quote form.

-- Most-used custom items surface first in the tech's personal library.
CREATE INDEX IF NOT EXISTS idx_hd_repair_items_use
  ON public.hd_repair_items(user_id, use_count DESC, last_used_at DESC);
