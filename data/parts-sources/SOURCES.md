# Reefer parts sources

What each `source` key in the parts catalog means. The catalog stores the KEY, never a
file name: a file's own name can carry a retailer's, and no retailer name is ever loaded.
Every row also records `source_sheet` and `source_row` (header = row 1), so one source can
be found again, checked, or taken back out on its own.

| source key | file in this folder | loaded |
|---|---|---|
| `reefer-parts-master` | Reefer-Parts-Master.xlsx | yes |
| `reefer-parts-simple` | Reefer-Parts-Simple.xlsx | no - every row is also in Reefer-Parts-Master.xlsx, which is loaded |
| `oem-listing-2026-10-28` | can-ca-tk-carrier-parts-oem-only.csv | yes |
| `oem-listing-left-out` | can-ca-tk-left-out-rows.csv | yes |
| `tk-filters-crossref` | tk-filters-crossref.xlsx | yes |
| `tk-filters-by-model` | tk-filters-by-model.docx | no - prose copy of the By model sheet in tk-filters-crossref.xlsx, which is loaded |
| `seed-parts-2026-10-23` | seed-parts.csv | yes |
| `seed-fitment-2026-10-23` | seed-fitment.csv | yes |
| `seed-crosses-2026-10-23` | seed-crosses.csv | yes |
| `seed-supersessions-2026-10-23` | seed-supersessions.csv | yes |
| `seed-engines-2026-10-23` | seed-engines.csv | yes |

Not loaded, by instruction: truck_trailer_parts_pilot.xlsx (truck and trailer, on hold), and
the files in this folder that were never part of the reefer load (truck-trailer-*, service-truck-*,
light-duty-reseller-programs, parts-verified, parts-needs-review, sources-log).
