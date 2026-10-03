-- ╔═══════════════════════════════════════════════════════════════════════════╗
-- ║ REQUIRED — repair the mangled em-dash in the seeded PM item                ║
-- ╚═══════════════════════════════════════════════════════════════════════════╝
--
-- NOT RUN BY ME. This is an UPDATE to an existing row.
--
-- ── WHAT HAPPENED ───────────────────────────────────────────────────────────
--
-- Migration 144 reached the SQL editor via `cat 144_pm_items.sql | clip`.
-- Windows clip.exe reads stdin in the CONSOLE CODE PAGE (cp437 here), not UTF-8,
-- so the em-dash in the seed text was transliterated before it ever arrived:
--
--   intended : ...starves the engine U+2014 erratic RPM...        (one em-dash)
--   stored   : ...starves the engine U+0393 U+00C7 U+00F6 ...     (three chars)
--
-- Those three code points are the UTF-8 bytes E2 80 94 read as cp437. The SQL ran
-- without error because the mangled text is perfectly valid text.
--
-- ── WHY IT MATTERS ──────────────────────────────────────────────────────────
--
-- pm_items.why is shown to a TECHNICIAN behind the "Why" button on the unit detail
-- page. It is the only one of the three affected categories that a human reads:
--
--   pm_items.why          1 row,  TECH-VISIBLE   <- this file fixes it
--   column COMMENTs      11 of 318, metadata only, invisible in the product
--   business data         none. invoices, hd_invoices, customers and quotes
--                         were all checked and are clean.
--
-- Three of those eleven comments (shop_profiles.tech_name,
-- shop_jobs.invoice_public_token, customers.contact_prefs_note) belong to older
-- migrations, so this transport problem predates this run. They are cosmetic and
-- are deliberately left alone rather than churned.
--
-- ── THE FIX ─────────────────────────────────────────────────────────────────
--
-- Rewrites the one string, in ASCII, matching migration 144 as it now stands. Safe
-- to run more than once: it only touches a row whose text still contains the
-- mangled sequence.

BEGIN;

-- Before. Expect one row, with the three-character sequence visible.
SELECT name,
       part_number,
       position('Γ' in why) AS mojibake_at,
       substring(why from 1 from 90) AS first_90
FROM   public.pm_items
WHERE  why LIKE '%Γ%';

UPDATE public.pm_items
SET    why = 'Replace at 4 months maximum. Clogged cartridge starves the engine - erratic '
          || 'RPM, idling problems, and the ETV restricts, dropping cooling capacity. '
          || 'Commonly reported as a no-cool complaint with a temperature differential '
          || 'as poor as -4 degrees.',
       updated_at = now()
WHERE  user_id IS NULL
  AND  part_number = '11-9965'
  AND  why LIKE '%Γ%';

-- After. Expect: 1 row updated above, and ZERO rows from this.
SELECT count(*) AS still_mangled
FROM   public.pm_items
WHERE  why LIKE '%Γ%' OR why LIKE '%Ç%' OR why LIKE '%ö%';

-- And the text as a tech will now read it.
SELECT name, why FROM public.pm_items WHERE part_number = '11-9965';

-- If still_mangled is 0 and the text reads correctly:
--   COMMIT;
-- Otherwise:
--   ROLLBACK;
ROLLBACK;  -- <= change to COMMIT when the checks above look right
