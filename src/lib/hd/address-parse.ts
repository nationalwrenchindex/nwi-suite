// Pure US address parser for the HD single-line address input.
//
// No network and no geocoding on purpose. GOOGLE_PLACES_API_KEY exists in this
// project but is scoped to the directory agent; hanging a paid lookup off every
// address field on every quote/invoice is its own cost decision, not a data-entry
// convenience. This parser only rearranges what the tech already typed.
//
// The whole design is CONSERVATIVE. A tech who does not notice a wrongly-guessed
// city mails an invoice to the wrong place, which is worse than a blank field the
// form visibly asks them to fill. So every field is emitted only when it can be
// anchored on something unambiguous (a trailing ZIP, a real state code/name, a
// comma boundary). Anything less confident comes back null.

export interface ParsedAddress {
  address_line1: string | null
  address_line2: string | null
  city: string | null
  state: string | null
  zip: string | null
}

const STATE_ABBR = new Set([
  'AL', 'AK', 'AZ', 'AR', 'CA', 'CO', 'CT', 'DE', 'FL', 'GA', 'HI', 'ID', 'IL',
  'IN', 'IA', 'KS', 'KY', 'LA', 'ME', 'MD', 'MA', 'MI', 'MN', 'MS', 'MO', 'MT',
  'NE', 'NV', 'NH', 'NJ', 'NM', 'NY', 'NC', 'ND', 'OH', 'OK', 'OR', 'PA', 'RI',
  'SC', 'SD', 'TN', 'TX', 'UT', 'VT', 'VA', 'WA', 'WV', 'WI', 'WY',
  // Federal district and the territories a fleet can actually be billed in.
  'DC', 'PR', 'VI', 'GU', 'AS', 'MP',
])

const STATE_NAMES: Record<string, string> = {
  'alabama': 'AL', 'alaska': 'AK', 'arizona': 'AZ', 'arkansas': 'AR',
  'california': 'CA', 'colorado': 'CO', 'connecticut': 'CT', 'delaware': 'DE',
  'florida': 'FL', 'georgia': 'GA', 'hawaii': 'HI', 'idaho': 'ID',
  'illinois': 'IL', 'indiana': 'IN', 'iowa': 'IA', 'kansas': 'KS',
  'kentucky': 'KY', 'louisiana': 'LA', 'maine': 'ME', 'maryland': 'MD',
  'massachusetts': 'MA', 'michigan': 'MI', 'minnesota': 'MN', 'mississippi': 'MS',
  'missouri': 'MO', 'montana': 'MT', 'nebraska': 'NE', 'nevada': 'NV',
  'new hampshire': 'NH', 'new jersey': 'NJ', 'new mexico': 'NM', 'new york': 'NY',
  'north carolina': 'NC', 'north dakota': 'ND', 'ohio': 'OH', 'oklahoma': 'OK',
  'oregon': 'OR', 'pennsylvania': 'PA', 'rhode island': 'RI',
  'south carolina': 'SC', 'south dakota': 'SD', 'tennessee': 'TN', 'texas': 'TX',
  'utah': 'UT', 'vermont': 'VT', 'virginia': 'VA', 'washington': 'WA',
  'west virginia': 'WV', 'wisconsin': 'WI', 'wyoming': 'WY',
  'district of columbia': 'DC', 'puerto rico': 'PR',
}

// Secondary-unit designators. ONLY these split a street string into line 1 and
// line 2 — an unrecognised trailing token stays on line 1 rather than being
// guessed into a suite number. Bare "FL" is deliberately absent (it collides
// with Florida); "floor" spelled out is fine.
const UNIT_RE = /\s+(?:(?:suite|ste|apt|apartment|unit|bldg|building|floor|rm|room|dept|department|lot|trlr|trailer)\b\.?|#)\s*\S.*$/i

const EMPTY: ParsedAddress = {
  address_line1: null, address_line2: null, city: null, state: null, zip: null,
}

// Nothing parsed confidently → hand the whole input back as line 1 so the text
// the tech typed is never silently dropped. They can then split it by hand in
// the individual fields, which stay visible underneath the single-line input.
function fallback(raw: string): ParsedAddress {
  return { ...EMPTY, address_line1: raw || null }
}

function splitUnit(street: string): [string, string | null] {
  const m = UNIT_RE.exec(street)
  if (!m) return [street, null]
  const line1 = street.slice(0, m.index).trim()
  const line2 = street.slice(m.index).trim()
  // A designator with no street in front of it is not a split worth making.
  if (!line1 || !line2) return [street, null]
  return [line1, line2]
}

// Pulls a trailing state off `rest`, returning the code plus what is left before
// it. Accepts a 2-letter code or a spelled-out name (up to three words, so
// "District Of Columbia" resolves).
function takeState(rest: string): { state: string; before: string } | null {
  const abbr = /(?:^|[,\s])([A-Za-z]{2})$/.exec(rest)
  if (abbr && STATE_ABBR.has(abbr[1].toUpperCase())) {
    return { state: abbr[1].toUpperCase(), before: rest.slice(0, abbr.index) }
  }

  const words = rest.split(/[\s,]+/).filter(Boolean)
  for (let n = 3; n >= 1; n--) {
    if (words.length < n) continue
    const tail = words.slice(words.length - n).join(' ').toLowerCase()
    const code = STATE_NAMES[tail]
    if (!code) continue
    // Cut the matched words off by length so the original punctuation survives
    // in `before` (the comma boundary is what the city detection relies on).
    const idx = rest.toLowerCase().lastIndexOf(tail)
    if (idx <= 0) continue
    return { state: code, before: rest.slice(0, idx) }
  }
  return null
}

export function parseAddress(input: string): ParsedAddress {
  const raw = (input ?? '').trim()
  if (!raw) return { ...EMPTY }

  // A newline is just another field separator; normalise it to a comma so one
  // code path handles both "123 Main St\nWauchula, FL" and the comma form.
  let s = raw.replace(/[\r\n]+/g, ', ').replace(/\s+/g, ' ').trim()
  // A trailing country name is not one of our fields.
  s = s.replace(/,?\s*(?:u\.?s\.?a\.?|united states(?: of america)?)\.?$/i, '')
  s = s.replace(/[,\s]+$/, '')

  // Anchor 1: the ZIP at the very end. Without it we have no reliable end of the
  // address, so everything downstream would be guesswork.
  const zipMatch = /(\d{5})(-\d{4})?$/.exec(s)
  if (!zipMatch || zipMatch.index === 0) return fallback(raw)
  const zip = zipMatch[0]
  const beforeZip = s.slice(0, zipMatch.index).replace(/[,\s]+$/, '')

  // Anchor 2: the state immediately before the ZIP. A ZIP with no recognisable
  // state in front of it means the string is not in a shape we understand, so we
  // fall back wholesale rather than emit a half-parse the tech has to untangle.
  const st = takeState(beforeZip)
  if (!st) return fallback(raw)
  const state = st.state
  const rest = st.before.replace(/[,\s]+$/, '')
  if (!rest) return { ...EMPTY, state, zip }

  const segments = rest.split(',').map(p => p.trim()).filter(Boolean)

  // No comma left means the street and the city run together ("123 Main St
  // Wauchula"). There is no safe way to know where one ends, so the city stays
  // blank and the whole remainder becomes line 1.
  if (segments.length < 2) {
    const [l1, l2] = splitUnit(rest)
    return { address_line1: l1 || null, address_line2: l2, city: null, state, zip }
  }

  const city = segments[segments.length - 1]
  // A digit in the last segment means it is almost certainly still part of the
  // street (a suite or lot number), not a city name.
  if (/\d/.test(city)) {
    const [l1, l2] = splitUnit(rest)
    return { address_line1: l1 || null, address_line2: l2, city: null, state, zip }
  }

  const street = segments.slice(0, -1)
  if (street.length >= 2) {
    // The tech already separated the unit with a comma — trust that boundary.
    return {
      address_line1: street[0],
      address_line2: street.slice(1).join(', '),
      city,
      state,
      zip,
    }
  }

  const [l1, l2] = splitUnit(street[0])
  return { address_line1: l1 || null, address_line2: l2, city, state, zip }
}
