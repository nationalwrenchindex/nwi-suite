-- Phase 3: Detailer Polish
-- Adds photos column to jobs table + creates booking-photos storage bucket

-- 1. Add photos JSONB array to jobs (stores uploaded photo URLs from booking page)
ALTER TABLE jobs
  ADD COLUMN IF NOT EXISTS photos jsonb NOT NULL DEFAULT '[]'::jsonb;

-- 2. Create booking-photos storage bucket (public read, write via service-role API routes)
INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES (
  'booking-photos',
  'booking-photos',
  true,
  5242880,
  ARRAY['image/jpeg', 'image/jpg', 'image/png', 'image/webp']
)
ON CONFLICT (id) DO NOTHING;

-- 3. Public read policy for booking photos
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'storage' AND tablename = 'objects'
      AND policyname = 'booking_photos_public_read'
  ) THEN
    EXECUTE $p$
      CREATE POLICY booking_photos_public_read ON storage.objects
        FOR SELECT TO public
        USING (bucket_id = 'booking-photos')
    $p$;
  END IF;
END $$;

-- 4. Service-role insert policy (used by /api/book/[slug]/photos route)
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'storage' AND tablename = 'objects'
      AND policyname = 'booking_photos_service_insert'
  ) THEN
    EXECUTE $p$
      CREATE POLICY booking_photos_service_insert ON storage.objects
        FOR INSERT TO service_role
        WITH CHECK (bucket_id = 'booking-photos')
    $p$;
  END IF;
END $$;

-- 5. Authenticated users can read their folder (for detailer reviewing their clients' uploads)
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'storage' AND tablename = 'objects'
      AND policyname = 'booking_photos_auth_read'
  ) THEN
    EXECUTE $p$
      CREATE POLICY booking_photos_auth_read ON storage.objects
        FOR SELECT TO authenticated
        USING (bucket_id = 'booking-photos')
    $p$;
  END IF;
END $$;
