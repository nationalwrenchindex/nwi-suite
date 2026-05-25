-- Feature waitlist — tracks which users want to be notified when a feature launches
CREATE TABLE IF NOT EXISTS public.hd_feature_notifications (
  id         UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id    UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  feature    TEXT NOT NULL,
  email      TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(user_id, feature)
);

ALTER TABLE public.hd_feature_notifications ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users manage own feature notifications"
  ON public.hd_feature_notifications FOR ALL
  USING (auth.uid() = user_id);
