-- Company logo URL for white-labeled DOT inspection forms and documents
ALTER TABLE profiles
  ADD COLUMN IF NOT EXISTS hd_company_logo_url TEXT;
