-- Migration 109: correct TK 78-1859 (781859).
--
-- Reassigns the belt to the full S-600 family and renames its function to match the
-- TK catalog data loaded in migration 108.
--
-- Worth recording, because the ticket described it differently: this row was NOT
-- assigned to the Precedent C-600. It already read unit_family = 'Precedent S-600'.
-- What actually changes here is (a) widening that to the five S-600 variants and
-- (b) the part_function, which read 'Engine to Compressor Belt'.
--
-- The row currently sitting on 'Precedent C-600' is 78-1876, whose catalog data says
-- S-600 instead. That one is deliberately left alone pending verification.
--
-- notes is not touched: the existing row carries the only Dayco cross-reference we
-- have for this belt (6PK1475, Poly-V 6-rib) and migration 108 supplied no cross-refs.
--
-- Matched on normalized digits rather than the literal string, because TK numbers are
-- stored hyphenated here ('78-1859') and the catalog data is plain ('781859').

UPDATE public.hd_parts_reference
SET    unit_family   = 'Precedent S-600,S-600M,S-600DE,S-610M,S-610DE',
       part_function = 'Generator Belt (with alternator)'
WHERE  manufacturer = 'TK'
  AND  EXISTS (
         SELECT 1
         FROM   LATERAL regexp_split_to_table(COALESCE(oem_part_number, ''), '\s*/\s*') AS tok
         WHERE  CASE
                  WHEN tok ~ '^[0-9]{2}-[0-9]{1,4}$'
                    THEN split_part(tok, '-', 1) || lpad(split_part(tok, '-', 2), 4, '0')
                  ELSE regexp_replace(tok, '[^0-9]', '', 'g')
                END = '781859'
       );
