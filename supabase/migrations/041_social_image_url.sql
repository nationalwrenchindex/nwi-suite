-- Add image_url column to social_posts for DALL-E 3 generated image URLs
ALTER TABLE public.social_posts ADD COLUMN IF NOT EXISTS image_url TEXT;
