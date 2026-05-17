-- Add image_prompt column to social_posts for AI image generation prompts
ALTER TABLE public.social_posts ADD COLUMN IF NOT EXISTS image_prompt TEXT;
