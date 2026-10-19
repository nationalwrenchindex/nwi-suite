// Which of a shop's units a typed serial number means - or none.
//
// One rule for every place that links a work order to a unit from text: the calendar
// booking form, and scripts/backfill-wo-unit-by-serial.ts. A serial that matches
// EXACTLY ONE of the shop's units is that unit. Zero or several and nothing is
// guessed - picking the wrong reefer puts one unit's history on another's record.
//
// The comparison is trimmed and case-insensitive, and nothing else. Dashes and spaces
// are NOT stripped: "1HT-123" and "1HT123" may well be the same unit, but this cannot
// know that, and a conservative miss is recoverable where a wrong link is not.

export interface SerialUnit {
  id: string
  serial_number: string | null
}

export function normSerial(s: string | null | undefined): string {
  return String(s ?? '').trim().toUpperCase()
}

/** The one unit whose serial matches, or null for no match or an ambiguous one. */
export function matchUnitBySerial<T extends SerialUnit>(units: T[], serial: string | null | undefined): T | null {
  const want = normSerial(serial)
  if (!want) return null
  const hits = units.filter(u => normSerial(u.serial_number) === want)
  return hits.length === 1 ? hits[0] : null
}
