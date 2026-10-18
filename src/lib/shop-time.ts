// The shop's own calendar date, for dates printed on a document.
//
// INV-2026-0020 was created at 03:00 UTC on October 18 - 11:00 pm on October 17 in
// Winston-Salem - and read "Date: October 18, 2026". The pages render on the server,
// which runs in UTC, and toLocaleDateString with no timeZone formats in the server's
// zone. A bill dated a day ahead looks wrong to the customer holding it.
//
// There is no time zone setting anywhere in the product, so the zone comes from the
// shop's own state on its profile (profiles.state), which every shop block already
// reads. A state that spans two zones takes the zone most of it uses. No state, or an
// unrecognised one, falls back to US Eastern - the same default the booking page uses.
// If a shop ever needs an exact zone, a profiles.time_zone column belongs in front of
// this map, not in place of it.

const STATE_TIME_ZONES: Record<string, string> = {
  AL: 'America/Chicago',   AK: 'America/Anchorage', AZ: 'America/Phoenix',  AR: 'America/Chicago',
  CA: 'America/Los_Angeles', CO: 'America/Denver',  CT: 'America/New_York', DE: 'America/New_York',
  DC: 'America/New_York',  FL: 'America/New_York',  GA: 'America/New_York', HI: 'Pacific/Honolulu',
  ID: 'America/Boise',     IL: 'America/Chicago',   IN: 'America/Indiana/Indianapolis', IA: 'America/Chicago',
  KS: 'America/Chicago',   KY: 'America/New_York',  LA: 'America/Chicago',  ME: 'America/New_York',
  MD: 'America/New_York',  MA: 'America/New_York',  MI: 'America/Detroit',  MN: 'America/Chicago',
  MS: 'America/Chicago',   MO: 'America/Chicago',   MT: 'America/Denver',   NE: 'America/Chicago',
  NV: 'America/Los_Angeles', NH: 'America/New_York', NJ: 'America/New_York', NM: 'America/Denver',
  NY: 'America/New_York',  NC: 'America/New_York',  ND: 'America/Chicago',  OH: 'America/New_York',
  OK: 'America/Chicago',   OR: 'America/Los_Angeles', PA: 'America/New_York', RI: 'America/New_York',
  SC: 'America/New_York',  SD: 'America/Chicago',   TN: 'America/Chicago',  TX: 'America/Chicago',
  UT: 'America/Denver',    VT: 'America/New_York',  VA: 'America/New_York', WA: 'America/Los_Angeles',
  WV: 'America/New_York',  WI: 'America/Chicago',   WY: 'America/Denver',   PR: 'America/Puerto_Rico',
}

export const DEFAULT_SHOP_TIME_ZONE = 'America/New_York'

/** The IANA zone for a shop, from its profile's state (two-letter code or name). */
export function shopTimeZone(state: string | null | undefined): string {
  const s = String(state ?? '').trim().toUpperCase()
  if (STATE_TIME_ZONES[s]) return STATE_TIME_ZONES[s]
  const byName = STATE_NAMES[s]
  return (byName && STATE_TIME_ZONES[byName]) || DEFAULT_SHOP_TIME_ZONE
}

const STATE_NAMES: Record<string, string> = {
  ALABAMA: 'AL', ALASKA: 'AK', ARIZONA: 'AZ', ARKANSAS: 'AR', CALIFORNIA: 'CA', COLORADO: 'CO',
  CONNECTICUT: 'CT', DELAWARE: 'DE', 'DISTRICT OF COLUMBIA': 'DC', FLORIDA: 'FL', GEORGIA: 'GA',
  HAWAII: 'HI', IDAHO: 'ID', ILLINOIS: 'IL', INDIANA: 'IN', IOWA: 'IA', KANSAS: 'KS', KENTUCKY: 'KY',
  LOUISIANA: 'LA', MAINE: 'ME', MARYLAND: 'MD', MASSACHUSETTS: 'MA', MICHIGAN: 'MI', MINNESOTA: 'MN',
  MISSISSIPPI: 'MS', MISSOURI: 'MO', MONTANA: 'MT', NEBRASKA: 'NE', NEVADA: 'NV', 'NEW HAMPSHIRE': 'NH',
  'NEW JERSEY': 'NJ', 'NEW MEXICO': 'NM', 'NEW YORK': 'NY', 'NORTH CAROLINA': 'NC', 'NORTH DAKOTA': 'ND',
  OHIO: 'OH', OKLAHOMA: 'OK', OREGON: 'OR', PENNSYLVANIA: 'PA', 'RHODE ISLAND': 'RI',
  'SOUTH CAROLINA': 'SC', 'SOUTH DAKOTA': 'SD', TENNESSEE: 'TN', TEXAS: 'TX', UTAH: 'UT', VERMONT: 'VT',
  VIRGINIA: 'VA', WASHINGTON: 'WA', 'WEST VIRGINIA': 'WV', WISCONSIN: 'WI', WYOMING: 'WY',
  'PUERTO RICO': 'PR',
}

/**
 * "October 17, 2026" in the shop's zone.
 *
 * A DATE-only value ('2026-11-16') is printed as that calendar date and never shifted:
 * it has no time to convert, and reading it as UTC midnight then moving it into an
 * American zone would print the day before.
 */
export function fmtShopDate(s: string | null | undefined, timeZone: string): string {
  if (!s) return '—'
  const dateOnly = /^(\d{4})-(\d{2})-(\d{2})$/.exec(s)
  if (dateOnly) {
    const d = new Date(Date.UTC(Number(dateOnly[1]), Number(dateOnly[2]) - 1, Number(dateOnly[3]), 12))
    return d.toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric', timeZone: 'UTC' })
  }
  const d = new Date(s)
  if (Number.isNaN(d.getTime())) return '—'
  return d.toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric', timeZone })
}
