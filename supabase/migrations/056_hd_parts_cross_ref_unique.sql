-- Add unique constraint on hd_parts_cross_ref so seed upserts work correctly.
-- Without this, upsert with onConflict: 'part_number,cross_mfr,cross_part' fails
-- with "there is no unique or exclusion constraint matching the ON CONFLICT specification."

alter table public.hd_parts_cross_ref
  add constraint hd_parts_cross_ref_part_mfr_part_key
  unique (part_number, cross_mfr, cross_part);
