-- Migration 055: business logo + tire size fields
-- Run in Supabase SQL Editor

-- 1. Business logo columns on profiles
ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS business_logo_url text,
  ADD COLUMN IF NOT EXISTS business_logo_storage_path text;

-- 2. Tire size fields on jobs
ALTER TABLE public.jobs
  ADD COLUMN IF NOT EXISTS tire_size_type text,
  ADD COLUMN IF NOT EXISTS tire_size text;

-- 3. Storage bucket for business logos
INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES (
  'business-logos',
  'business-logos',
  true,
  5242880,
  ARRAY['image/jpeg', 'image/png', 'image/webp']
)
ON CONFLICT (id) DO NOTHING;

-- 4. RLS policies for business-logos bucket (idempotent via DO block)
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'storage' AND tablename = 'objects'
      AND policyname = 'Business logos — owner insert'
  ) THEN
    CREATE POLICY "Business logos — owner insert"
    ON storage.objects FOR INSERT TO authenticated
    WITH CHECK (
      bucket_id = 'business-logos'
      AND (storage.foldername(name))[1] = auth.uid()::text
    );
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'storage' AND tablename = 'objects'
      AND policyname = 'Business logos — owner update'
  ) THEN
    CREATE POLICY "Business logos — owner update"
    ON storage.objects FOR UPDATE TO authenticated
    USING (
      bucket_id = 'business-logos'
      AND (storage.foldername(name))[1] = auth.uid()::text
    );
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'storage' AND tablename = 'objects'
      AND policyname = 'Business logos — owner delete'
  ) THEN
    CREATE POLICY "Business logos — owner delete"
    ON storage.objects FOR DELETE TO authenticated
    USING (
      bucket_id = 'business-logos'
      AND (storage.foldername(name))[1] = auth.uid()::text
    );
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'storage' AND tablename = 'objects'
      AND policyname = 'Business logos — public read'
  ) THEN
    CREATE POLICY "Business logos — public read"
    ON storage.objects FOR SELECT TO public
    USING (bucket_id = 'business-logos');
  END IF;
END $$;
