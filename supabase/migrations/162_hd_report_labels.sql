-- 162: per-shop wording for the HD audit exports.
--
-- The equipment schedule and the audit packet (spec docs/KURT-EQUIPMENT-TRACKING-SPEC.md
-- sections 5.2 and 5.3) print column headers, titles and category names. An insurer's
-- form uses its own words ("Vehicle type" for "Equipment class", "Aerial lift" for a
-- category the shop calls "Aerial / Bucket"). This column holds the shop's overrides
-- so matching that wording is a settings change, not a code change.
--
-- Shape (validated by src/lib/hd/audit-labels.ts before it is written):
--   { "text": { "classColumn": "Vehicle type", ... },
--     "categories": { "<hd_equipment_categories.id>": "Aerial lift", ... } }
--
-- Additive and nullable, NO DEFAULT. NULL means "every label is its default". The code
-- reads and writes it with a missing-column fallback, so it can deploy before this is
-- applied: until then the exports print the default labels and the settings form says
-- the labels cannot be saved yet.
--
-- No new RLS: profiles already restricts a row to its owner, and the column rides on
-- that policy.
--
-- Preview and production share one database. Applying this applies it to both.

BEGIN;

ALTER TABLE public.profiles ADD COLUMN IF NOT EXISTS hd_report_labels JSONB;

COMMENT ON COLUMN public.profiles.hd_report_labels IS
  'HD audit export wording overrides: {"text": {key: label}, "categories": {category id: name}}. NULL = defaults. Validated in src/lib/hd/audit-labels.ts.';

-- Check. Should return one row: hd_report_labels | jsonb | YES
SELECT column_name, data_type, is_nullable
  FROM information_schema.columns
 WHERE table_schema = 'public'
   AND table_name   = 'profiles'
   AND column_name  = 'hd_report_labels';

-- Re-read the API schema so PostgREST sees the new column without a restart.
NOTIFY pgrst, 'reload schema';

COMMIT;
