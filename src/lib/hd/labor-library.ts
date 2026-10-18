// The labor library's billed-hours pre-fill, as one rule the quote form and the smoke
// suite both read.
//
// The mobile figure, else the book (shop) figure, else BLANK. A 0 counts as missing:
// "test labor" was saved with book 1.5 and mobile 0, and the pick pre-filled 0, so
// the line priced at 0 hrs x $135.00 = $0.00. An entry with only book hours means the
// job takes that long, not that it takes no time. One with neither returns '' so the
// field is empty and the form refuses to add it, rather than a $0.00 line nobody
// noticed.

const positive = (v: number | string | null | undefined): number | null => {
  if (v == null || v === '') return null
  const n = Number(v)
  return Number.isFinite(n) && n > 0 ? n : null
}

export function billedHoursFromLibrary(
  mobileHours: number | string | null | undefined,
  shopHours: number | string | null | undefined,
): string {
  const h = positive(mobileHours) ?? positive(shopHours)
  return h == null ? '' : String(h)
}
