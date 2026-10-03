-- =============================================================================
-- REQUIRED - repair the mangled "why" text on the seeded PM item
-- =============================================================================
--
-- NOT RUN BY ME. This is an UPDATE to an existing row.
--
-- PLAIN ASCII ONLY. Every character in this file, including inside the string
-- literal and inside every WHERE clause, is in the 7-bit ASCII range. That is
-- not a style choice: this file exists because non-ASCII text did not survive
-- the trip to the SQL editor, so a repair script written with non-ASCII in it
-- would be corrupted by the same transport that caused the problem.
--
-- -----------------------------------------------------------------------------
-- WHAT HAPPENED
-- -----------------------------------------------------------------------------
--
-- Migration 144 reached the SQL editor through "cat 144_pm_items.sql | clip".
-- Windows clip.exe reads stdin in the console code page (cp437 here), not UTF-8,
-- so the em-dash in the seeded text was transliterated before it ever arrived:
--
--   intended:  ...starves the engine [U+2014] erratic RPM...
--   stored:    ...starves the engine [U+0393][U+00C7][U+00F6] erratic RPM...
--
-- Those three code points are the UTF-8 bytes E2 80 94 read as cp437. The SQL
-- ran without error because mangled text is still perfectly valid text.
--
-- -----------------------------------------------------------------------------
-- WHY IT MATTERS
-- -----------------------------------------------------------------------------
--
-- pm_items.why is shown to a TECHNICIAN behind the "Why" button on the unit
-- detail page. It is the only affected thing a human reads:
--
--   pm_items.why       1 row,  TECH-VISIBLE          <- this file fixes it
--   column COMMENTs    11 of 318, metadata only, invisible in the product
--   business data      none. invoices, hd_invoices, customers and quotes were
--                      all checked and are clean.
--
-- Three of those eleven comments belong to older migrations
-- (shop_profiles.tech_name, shop_jobs.invoice_public_token,
-- customers.contact_prefs_note), so this transport problem predates this run.
-- They are cosmetic and are deliberately left alone rather than churned.
--
-- -----------------------------------------------------------------------------
-- HOW A MANGLED ROW IS IDENTIFIED, WITHOUT WRITING NON-ASCII
-- -----------------------------------------------------------------------------
--
-- The obvious test is "why LIKE '%<the bad character>%'", and that is a trap:
-- the bad character is non-ASCII, so it would be mangled on the way in and the
-- WHERE clause would match nothing. The script would report success and change
-- nothing.
--
-- Instead this uses octet_length(why) <> length(why). length() counts
-- CHARACTERS, octet_length() counts BYTES, and they differ only when the string
-- contains at least one multi-byte character. Correct ASCII text has them equal.
-- Pure ASCII, no literal needed, and it catches any corruption of this kind
-- rather than one specific character.

BEGIN;

-- -----------------------------------------------------------------------------
-- 1. BEFORE. Expect exactly one row, with bytes greater than characters.
-- -----------------------------------------------------------------------------
SELECT name,
       part_number,
       length(why)       AS characters,
       octet_length(why) AS bytes,
       octet_length(why) - length(why) AS extra_bytes,
       substring(why from 40 for 40)   AS around_the_damage
FROM   public.pm_items
WHERE  octet_length(why) <> length(why);

-- -----------------------------------------------------------------------------
-- 2. THE REPAIR. ASCII only, matching migration 144 as it now stands.
--    Safe to run more than once: the WHERE clause stops matching once fixed.
-- -----------------------------------------------------------------------------
UPDATE public.pm_items
SET    why = 'Replace at 4 months maximum. Clogged cartridge starves the engine - erratic '
          || 'RPM, idling problems, and the ETV restricts, dropping cooling capacity. '
          || 'Commonly reported as a no-cool complaint with a temperature differential '
          || 'as poor as -4 degrees.',
       updated_at = now()
WHERE  user_id IS NULL
  AND  part_number = '11-9965'
  AND  octet_length(why) <> length(why);

-- -----------------------------------------------------------------------------
-- 3. AFTER. Expect still_mangled = 0.
-- -----------------------------------------------------------------------------
SELECT count(*) AS still_mangled
FROM   public.pm_items
WHERE  octet_length(why) <> length(why);

-- The text as a technician will now read it. Expect characters = bytes.
SELECT name,
       part_number,
       length(why)       AS characters,
       octet_length(why) AS bytes,
       why
FROM   public.pm_items
WHERE  part_number = '11-9965';

-- -----------------------------------------------------------------------------
-- If still_mangled is 0 and the text reads correctly:  COMMIT;
-- Otherwise:                                           ROLLBACK;
-- -----------------------------------------------------------------------------
ROLLBACK;  -- <= change to COMMIT when the checks above look right
