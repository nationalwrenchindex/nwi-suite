/**
 * One-time bulk import: major truck-stop chain locations along key US
 * interstate corridors → Brilliant Directories listings on NWI HD.
 *
 * Run:
 *   npm run import-truck-stops                 # live — creates real listings
 *   npm run import-truck-stops -- --dry-run    # find + report, write nothing
 *   npm run import-truck-stops -- --limit=10   # cap listings created
 *   npm run import-truck-stops -- --cities=Charlotte,Winston-Salem
 *                                              # sweep only these cities
 *
 * --cities takes comma-separated names matched against the corridor list. A
 * bare name matches every state it appears under (Charleston hits both SC and
 * WV); append :ST to pin one, or to sweep a city that is not on a corridor at
 * all — e.g. --cities=Charleston:SC,Dallas:TX. Useful as a cheap smoke test:
 * each city costs 8 Places queries, a full sweep costs ~496.
 *
 * This is NOT an API route. It is deliberately self-contained — it does not
 * import from src/lib, because those modules pull in next/server and the
 * request-scoped Supabase client, neither of which exists outside a request.
 *
 * Safe to re-run: every location already banked in hd_directory_prospects (by
 * google_place_id or phone) is skipped, so a second pass only picks up what the
 * first one missed.
 */

import { loadEnvConfig } from '@next/env'
import { randomBytes } from 'crypto'
import { createClient, type SupabaseClient } from '@supabase/supabase-js'

// .env.local is loaded by Next at runtime; a standalone script has to ask.
loadEnvConfig(process.cwd())

// ─── Configuration ───────────────────────────────────────────────────────────

// Endpoint per the import spec — BD serves /api/v2 from the directory's own
// platform host. Note this differs from the HD agent's BD_HD_BASE_URL default
// (www.nwihd.com); see the deploy note printed at the end of this file.
const BD_URL = 'https://national-wrench-index-hd.directoryup.com/api/v2/user/create'

const PLACES_URL = 'https://places.googleapis.com/v1/places:searchText'

const PLACES_CONCURRENCY = 5      // simultaneous Google Places queries
const BD_DELAY_MS        = 500    // gap between BD writes, per spec
const LOOKUP_CHUNK       = 100    // ids/phones per exclusion query

const SERVICE_CATEGORY = 'truck_stop'
const PROFESSION_NAME  = 'Truck Stop'

// Chain queries run per city, plus a generic sweep to catch independents and
// chains not named here.
const CHAIN_QUERIES = [
  'Pilot Flying J',
  "Love's Travel Stop",
  'TA Petro',
  'Sapp Bros',
  'Petro Stopping Centers',
  // Kept because a genuine hit is usually named "Iron Skillet — Petro Stopping
  // Center", which passes the allowlist on its petro token. The brand alone is
  // NOT on the allowlist: as a bare pattern it matched every skillet, waffle and
  // grill in the metro. The truck stop is what we want listed anyway, not its
  // in-house diner.
  'Iron Skillet',
  'SpeedCo',
  'truck stop',
] as const

/**
 * Name allowlist, same approach as CHAIN_NAMES in src/lib/roadie/nearby-stores.ts.
 *
 * Text search returns anything textually adjacent to the query, and two of our
 * chain names are traps: "Iron Skillet" is the restaurant brand inside Petro/TA
 * stops, so it pulls in every skillet/waffle/grill in the metro, and a generic
 * "truck stop" sweep drags in convenience stores and gas stations. Without this
 * filter a Waffle House gets published with profession_name "Truck Stop".
 *
 * Genuine Iron Skillet locations still pass — they carry a Petro/TA token, or
 * the brand name itself, which is on the list.
 */
const TRUCK_STOP_NAME_PATTERNS = [
  'pilot travel', 'pilot flying', 'flying j', 'pilot #',
  "love's", 'loves travel', 'truck care',
  'ta travel', 'travelcenters', 'ta petro', 'petro stopping', 'petro travel',
  'travel center', 'travel centre', 'travel plaza', 'travel stop',
  'sapp bros', 'speedco',
  'truck stop', 'truckstop', 'truck plaza', 'trucker',
]

/**
 * Administrative locations that carry a chain name but are not a place a driver
 * can pull into. Knoxville is Pilot Flying J's corporate home, so a Knoxville
 * sweep surfaces "Pilot Flying J Corporate Office" alongside its travel centers.
 */
const EXCLUDED_NAME_PATTERNS = [
  'corporate office', 'corporate hq', 'headquarters', 'home office',
  'distribution center', 'support center',

  // Unrelated businesses that happen to share a chain token. "SpeedCo Roofing &
  // Metalwork" in Cincinnati matched on 'speedco'; these trades never overlap
  // with a travel center, so excluding them costs nothing.
  'roofing', 'metalwork', 'sheet metal', 'plumbing', 'landscaping',
  'salon', 'dental', 'realty', 'insurance',

  // Crowd-sourced parking entries from the Trucker Path app are not businesses
  // and have no service desk to list.
  'trucker path',
]

function isTruckStopName(name: string): boolean {
  const n = name.toLowerCase()
  if (EXCLUDED_NAME_PATTERNS.some(p => n.includes(p))) return false
  return TRUCK_STOP_NAME_PATTERNS.some(p => n.includes(p))
}

/**
 * Toll-free numbers are national call centres or corporate switchboards, never
 * a specific site. They fail the directory twice over: a driver calling one
 * cannot reach the location, and because chains reuse a single toll-free line
 * across every site, the UNIQUE phone constraint makes the first one imported
 * evict all its siblings. Dropping them keeps the real, locally-numbered
 * locations that would otherwise be collapsed away.
 */
const TOLL_FREE_PREFIXES = ['800', '833', '844', '855', '866', '877', '888']

function isTollFree(e164: string): boolean {
  return TOLL_FREE_PREFIXES.includes(e164.slice(2, 5))
}

/** Great-circle miles — used to enforce the search radius client-side. */
function distanceMiles(lat1: number, lng1: number, lat2: number, lng2: number): number {
  const toRad = (d: number) => (d * Math.PI) / 180
  const R = 3958.8
  const dLat = toRad(lat2 - lat1)
  const dLng = toRad(lng2 - lng1)
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLng / 2) ** 2
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a))
}

interface City {
  city:  string
  state: string
}

// Cities repeat across corridors (Charlotte on I-85 and I-77, Atlanta on I-85
// and I-75, and so on). The corridor grouping is kept for logging; the search
// list below is deduped so no city is swept twice.
const CORRIDORS: Record<string, City[]> = {
  'I-40': [
    { city: 'Wilmington',    state: 'NC' }, { city: 'Raleigh',       state: 'NC' },
    { city: 'Durham',        state: 'NC' }, { city: 'Greensboro',    state: 'NC' },
    { city: 'Winston-Salem', state: 'NC' }, { city: 'Statesville',   state: 'NC' },
    { city: 'Asheville',     state: 'NC' }, { city: 'Knoxville',     state: 'TN' },
    { city: 'Nashville',     state: 'TN' }, { city: 'Memphis',       state: 'TN' },
    { city: 'Little Rock',   state: 'AR' }, { city: 'Oklahoma City', state: 'OK' },
    { city: 'Amarillo',      state: 'TX' }, { city: 'Albuquerque',   state: 'NM' },
  ],
  'I-85': [
    { city: 'Charlotte',  state: 'NC' }, { city: 'Gastonia',   state: 'NC' },
    { city: 'Spartanburg', state: 'SC' }, { city: 'Greenville', state: 'SC' },
    { city: 'Anderson',   state: 'SC' }, { city: 'Atlanta',    state: 'GA' },
    { city: 'Auburn',     state: 'AL' }, { city: 'Montgomery', state: 'AL' },
  ],
  'I-95': [
    { city: 'Jacksonville', state: 'FL' }, { city: 'Savannah',    state: 'GA' },
    { city: 'Charleston',   state: 'SC' }, { city: 'Fayetteville', state: 'NC' },
    { city: 'Rocky Mount',  state: 'NC' }, { city: 'Richmond',    state: 'VA' },
    { city: 'Washington',   state: 'DC' },
  ],
  'I-77': [
    { city: 'Columbia',    state: 'SC' }, { city: 'Charlotte',  state: 'NC' },
    { city: 'Statesville', state: 'NC' }, { city: 'Mooresville', state: 'NC' },
    { city: 'Beckley',     state: 'WV' }, { city: 'Charleston', state: 'WV' },
    { city: 'Cleveland',   state: 'OH' },
  ],
  'I-81': [
    { city: 'Bristol',     state: 'TN' }, { city: 'Roanoke',    state: 'VA' },
    { city: 'Harrisonburg', state: 'VA' }, { city: 'Hagerstown', state: 'MD' },
    { city: 'Chambersburg', state: 'PA' }, { city: 'Harrisburg', state: 'PA' },
  ],
  'I-10': [
    { city: 'Jacksonville', state: 'FL' }, { city: 'Tallahassee', state: 'FL' },
    { city: 'Pensacola',    state: 'FL' }, { city: 'Mobile',      state: 'AL' },
    { city: 'New Orleans',  state: 'LA' }, { city: 'Baton Rouge', state: 'LA' },
    { city: 'Houston',      state: 'TX' }, { city: 'San Antonio', state: 'TX' },
    { city: 'El Paso',      state: 'TX' },
  ],
  'I-75': [
    { city: 'Miami',       state: 'FL' }, { city: 'Fort Lauderdale', state: 'FL' },
    { city: 'Orlando',     state: 'FL' }, { city: 'Tampa',           state: 'FL' },
    { city: 'Gainesville', state: 'FL' }, { city: 'Valdosta',        state: 'GA' },
    { city: 'Macon',       state: 'GA' }, { city: 'Atlanta',         state: 'GA' },
    { city: 'Chattanooga', state: 'TN' }, { city: 'Knoxville',       state: 'TN' },
    { city: 'Lexington',   state: 'KY' }, { city: 'Cincinnati',      state: 'OH' },
  ],
}

// ─── Types ───────────────────────────────────────────────────────────────────

interface AddressComponent {
  longText?:  string
  shortText?: string
  types?:     string[]
}

interface PlaceNew {
  id?:                       string
  displayName?:              { text?: string }
  formattedAddress?:         string
  nationalPhoneNumber?:      string
  internationalPhoneNumber?: string
  addressComponents?:        AddressComponent[]
  location?:                 { latitude?: number; longitude?: number }
}

/** Why a candidate was dropped — reported in the summary so nothing is silent. */
interface RejectTally {
  outOfRange: number
  notATruckStop: number
  noPhoneOrAddress: number
  tollFree: number
}

interface TruckStop {
  placeId:      string
  businessName: string
  phone:        string
  address:      string
  city:         string
  state:        string
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

const sleep = (ms: number) => new Promise(resolve => setTimeout(resolve, ms))

function chunk<T>(items: T[], size: number): T[][] {
  const out: T[][] = []
  for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size))
  return out
}

/** E.164 for a valid US number, else null. Rejects invalid NANP outright. */
function normalizeUsPhone(raw: string | null | undefined): string | null {
  if (!raw) return null
  const digits = raw.replace(/\D/g, '')
  const ten =
    digits.length === 10 ? digits :
    digits.length === 11 && digits.startsWith('1') ? digits.slice(1) :
    null
  if (!ten) return null
  if (!/^[2-9]\d{2}[2-9]\d{6}$/.test(ten)) return null
  return `+1${ten}`
}

function componentOf(components: AddressComponent[] | undefined, type: string, short = false) {
  const match = components?.find(c => c.types?.includes(type))
  if (!match) return null
  return (short ? match.shortText : match.longText) ?? null
}

/** Runs `worker` over `items`, at most `limit` in flight. Throwers yield null. */
async function mapWithConcurrency<T, R>(
  items: readonly T[],
  limit: number,
  worker: (item: T) => Promise<R>,
): Promise<(R | null)[]> {
  const results = new Array<R | null>(items.length).fill(null)
  let cursor = 0

  async function runner() {
    while (cursor < items.length) {
      const index = cursor++
      try {
        results[index] = await worker(items[index])
      } catch (err) {
        console.error(`   ! query failed: ${err instanceof Error ? err.message : String(err)}`)
      }
    }
  }

  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, runner))
  return results
}

function generatePassword(): string {
  return randomBytes(18).toString('base64url')
}

/** placeid@nwi-hd-listing.com, sanitized to a legal local part. */
function listingEmail(placeId: string): string {
  const local = placeId.replace(/[^A-Za-z0-9._-]/g, '').slice(0, 60) || randomBytes(8).toString('hex')
  return `${local}@nwi-hd-listing.com`
}

// ─── Google Places ───────────────────────────────────────────────────────────

const FIELD_MASK = [
  'places.id',
  'places.displayName',
  'places.formattedAddress',
  'places.nationalPhoneNumber',
  'places.internationalPhoneNumber',
  'places.addressComponents',
  'places.location',
].join(',')

async function searchText(
  key: string,
  textQuery: string,
  bias: { lat: number; lng: number; radius: number } | null,
  fieldMask: string = FIELD_MASK,
): Promise<PlaceNew[]> {
  const body: Record<string, unknown> = { textQuery, maxResultCount: 20 }
  if (bias) {
    body.locationBias = {
      circle: { center: { latitude: bias.lat, longitude: bias.lng }, radius: bias.radius },
    }
  }

  const res = await fetch(PLACES_URL, {
    method: 'POST',
    headers: {
      'Content-Type':     'application/json',
      'X-Goog-Api-Key':   key,
      'X-Goog-FieldMask': fieldMask,
    },
    body:   JSON.stringify(body),
    signal: AbortSignal.timeout(20_000),
  })

  if (!res.ok) {
    const body = await res.text().catch(() => '')
    throw new Error(`Places ${res.status}${body ? ` — ${body.slice(0, 200)}` : ''}`)
  }

  const data = await res.json() as { places?: PlaceNew[] }
  return data.places ?? []
}

/**
 * Resolves "Charlotte, NC" to a lat/lng so the chain queries can be radius-
 * biased and then hard-filtered by distance. Without this, a chain with no
 * presence in the target state (Sapp Bros in NC) returns its nationwide
 * locations — Salt Lake City, Omaha, Sidney NE — and they all look valid.
 */
async function geocodeCity(key: string, target: City) {
  const places = await searchText(key, `${target.city}, ${target.state}`, null, 'places.location')
  const loc = places[0]?.location
  if (typeof loc?.latitude === 'number' && typeof loc?.longitude === 'number') {
    return { lat: loc.latitude, lng: loc.longitude }
  }
  return null
}

/** Sweeps every chain query for one city. Deduped by place id within the city. */
async function searchCity(
  key: string,
  target: City,
  radiusMeters: number,
  tally: RejectTally,
): Promise<TruckStop[]> {
  const center = await geocodeCity(key, target)
  if (!center) {
    // No center means no way to enforce the radius, and an unbounded sweep is
    // exactly the failure this guards against. Skip rather than import junk.
    throw new Error(`could not geocode ${target.city}, ${target.state}`)
  }

  const bias       = { ...center, radius: radiusMeters }
  const radiusMi   = radiusMeters / 1609.344
  const queries    = CHAIN_QUERIES.map(q => `${q} ${target.city}, ${target.state}`)
  const batches    = await mapWithConcurrency(queries, PLACES_CONCURRENCY, q => searchText(key, q, bias))

  const found = new Map<string, TruckStop>()

  for (const places of batches) {
    if (!places) continue
    for (const p of places) {
      if (!p.id || found.has(p.id)) continue

      const name = p.displayName?.text ?? ''

      // locationBias only *steers* Places — it does not constrain. Enforce the
      // radius here, against the coordinates Google returned.
      const lat = p.location?.latitude
      const lng = p.location?.longitude
      if (typeof lat !== 'number' || typeof lng !== 'number') { tally.outOfRange++; continue }
      if (distanceMiles(center.lat, center.lng, lat, lng) > radiusMi) { tally.outOfRange++; continue }

      if (!isTruckStopName(name)) { tally.notATruckStop++; continue }

      // Both are hard requirements: no phone means the listing cannot be
      // contacted, no address means it cannot be placed on a corridor.
      const phone   = normalizeUsPhone(p.nationalPhoneNumber ?? p.internationalPhoneNumber)
      const address = p.formattedAddress?.trim()
      if (!phone || !address) { tally.noPhoneOrAddress++; continue }
      if (isTollFree(phone)) { tally.tollFree++; continue }

      found.set(p.id, {
        placeId:      p.id,
        businessName: name || 'Truck Stop',
        phone,
        address,
        city:  componentOf(p.addressComponents, 'locality') ?? target.city,
        state: componentOf(p.addressComponents, 'administrative_area_level_1', true) ?? target.state,
      })
    }
  }

  return [...found.values()]
}

// ─── Brilliant Directories ───────────────────────────────────────────────────

/** Public directory host — where a listing is actually viewed, not the API host. */
const DIRECTORY_URL = 'https://www.nwihd.com'

/**
 * BD's create response shape is not contractually documented. Prefer a profile
 * permalink when one comes back; otherwise fall back to the directory search URL
 * for the business name. Mirrors extractListingUrl in
 * src/lib/hd-directory-agent/bd.ts so agent-created and imported rows carry the
 * same kind of value.
 */
function extractListingUrl(rawBody: string, businessName: string): string {
  try {
    const json = JSON.parse(rawBody) as Record<string, unknown>
    const data = json.data as Record<string, unknown> | undefined
    const url  = json.profile_url ?? json.url ?? data?.profile_url ?? data?.url
    if (typeof url === 'string' && url.startsWith('http')) return url

    const userId = json.user_id ?? json.id ?? data?.user_id
    if (typeof userId === 'string' || typeof userId === 'number') {
      return `${DIRECTORY_URL}/profile/${userId}`
    }
  } catch { /* non-JSON success body — fall through to search URL */ }

  return `${DIRECTORY_URL}/search?q=${encodeURIComponent(businessName)}`
}

async function createBdListing(
  stop: TruckStop,
  apiKey: string,
  subscriptionId: string,
): Promise<string> {
  const body = new URLSearchParams({
    email:           listingEmail(stop.placeId),
    password:        generatePassword(),
    subscription_id: subscriptionId,
    company:         stop.businessName,
    profession_name: PROFESSION_NAME,
    listing_type:    'Company',
    first_name:      'Business',
    last_name:       'Owner',
    city:            stop.city,
    state:           stop.state,
    phone:           stop.phone,
    listing_live:    '1',
    bdapi_model:     'user',
  })

  const res = await fetch(BD_URL, {
    method: 'POST',
    headers: {
      'X-Api-Key':    apiKey,
      'Content-Type': 'application/x-www-form-urlencoded',
      accept:         'application/json',
    },
    body: body.toString(),
    // A redirect would silently downgrade this POST to a bodyless GET, which BD
    // answers with "405 Invalid Request Method" — surface it as an error instead.
    redirect: 'manual',
    signal:   AbortSignal.timeout(20_000),
  })

  if (res.status >= 300 && res.status < 400) {
    throw new Error(`BD redirected (${res.status}) to ${res.headers.get('location') ?? 'unknown'}`)
  }

  const raw = await res.text().catch(() => '')
  if (!res.ok) throw new Error(`BD ${res.status}: ${(raw || res.statusText).slice(0, 300)}`)

  return extractListingUrl(raw, stop.businessName)
}

// ─── Exclusions ──────────────────────────────────────────────────────────────

/**
 * Drops anything already banked. Place ids are the spec's dedupe key; phones are
 * checked too because hd_directory_prospects.phone is UNIQUE — without this a
 * known number would get a BD listing created and then fail to record, leaving
 * an orphan listing on the directory.
 */
async function filterKnown(supabase: SupabaseClient, stops: TruckStop[]): Promise<{
  fresh:   TruckStop[]
  skipped: number
}> {
  const knownPlaceIds  = new Set<string>()
  const blockedPhones  = new Set<string>()

  for (const ids of chunk(stops.map(s => s.placeId), LOOKUP_CHUNK)) {
    const { data, error } = await supabase
      .from('hd_directory_prospects')
      .select('google_place_id')
      .in('google_place_id', ids)
    if (error) throw new Error(`prospect place-id lookup failed: ${error.message}`)
    for (const r of data ?? []) knownPlaceIds.add(r.google_place_id as string)
  }

  for (const phones of chunk(stops.map(s => s.phone), LOOKUP_CHUNK)) {
    const [{ data: optouts, error: optErr }, { data: existing, error: exErr }] = await Promise.all([
      supabase.from('hd_directory_optouts').select('phone').in('phone', phones),
      supabase.from('hd_directory_prospects').select('phone').in('phone', phones),
    ])
    if (optErr) throw new Error(`optout lookup failed: ${optErr.message}`)
    if (exErr)  throw new Error(`prospect phone lookup failed: ${exErr.message}`)
    for (const r of optouts  ?? []) blockedPhones.add(r.phone as string)
    for (const r of existing ?? []) blockedPhones.add(r.phone as string)
  }

  const fresh = stops.filter(s => !knownPlaceIds.has(s.placeId) && !blockedPhones.has(s.phone))
  return { fresh, skipped: stops.length - fresh.length }
}

// ─── Main ────────────────────────────────────────────────────────────────────

async function main() {
  const args   = process.argv.slice(2)
  const dryRun = args.includes('--dry-run')
  const limitArg = args.find(a => a.startsWith('--limit='))
  const limit  = limitArg ? Number.parseInt(limitArg.split('=')[1] ?? '', 10) : Number.POSITIVE_INFINITY

  if (Number.isNaN(limit) || limit <= 0) {
    console.error('--limit must be a positive integer')
    process.exit(1)
  }

  // Matches DEFAULT_RADIUS_METERS in the LD/HD agents. Raise it to reach stops
  // further out on a corridor; lower it to keep a metro tight.
  const radiusArg = args.find(a => a.startsWith('--radius='))
  const radiusMeters = radiusArg ? Number.parseInt(radiusArg.split('=')[1] ?? '', 10) : 50000
  if (Number.isNaN(radiusMeters) || radiusMeters <= 0) {
    console.error('--radius must be a positive integer (meters)')
    process.exit(1)
  }

  // Argument validation runs BEFORE the env check so a typo in --cities is
  // caught immediately, without needing any credentials configured.

  // Dedupe cities across corridors — Charlotte, Atlanta, Knoxville and others
  // appear on two corridors each.
  const byKey = new Map<string, City & { corridors: string[] }>()
  for (const [corridor, list] of Object.entries(CORRIDORS)) {
    for (const c of list) {
      const key = `${c.city}|${c.state}`.toLowerCase()
      const hit = byKey.get(key)
      if (hit) hit.corridors.push(corridor)
      else byKey.set(key, { ...c, corridors: [corridor] })
    }
  }
  const allCities = [...byKey.values()]

  const citiesArg = args.find(a => a.startsWith('--cities='))
  let cities = allCities

  if (citiesArg) {
    const names = citiesArg.slice('--cities='.length)
      .split(',')
      .map(s => s.trim())
      .filter(Boolean)

    if (names.length === 0) {
      console.error('--cities was empty. Example: --cities=Charlotte,Winston-Salem')
      process.exit(1)
    }

    const selected: Array<City & { corridors: string[] }> = []
    const unmatched: string[] = []

    for (const name of names) {
      // "City:ST" pins a state and may name a city that is not on a corridor.
      const [rawCity, rawState] = name.split(':').map(s => s?.trim())
      if (rawState) {
        const key   = `${rawCity}|${rawState}`.toLowerCase()
        const known = byKey.get(key)
        selected.push(known ?? { city: rawCity, state: rawState.toUpperCase(), corridors: ['ad-hoc'] })
        continue
      }
      const hits = allCities.filter(c => c.city.toLowerCase() === rawCity.toLowerCase())
      if (hits.length === 0) unmatched.push(rawCity)
      else selected.push(...hits)
    }

    if (unmatched.length > 0) {
      console.error(`Not on any corridor: ${unmatched.join(', ')}`)
      console.error('Append a state to sweep it anyway, e.g. --cities=Dallas:TX')
      process.exit(1)
    }

    // A name matching two states (Charleston) yields both; drop repeats.
    const dedup = new Map(selected.map(c => [`${c.city}|${c.state}`.toLowerCase(), c]))
    cities = [...dedup.values()]
    console.log(`Selected ${cities.length} city/cities: ${cities.map(c => `${c.city}, ${c.state}`).join(' · ')}`)
  }

  const placesKey      = process.env.GOOGLE_PLACES_API_KEY
  const bdKey          = process.env.BD_HD_DIRECTORY_AGENT_KEY
  const subscriptionId = process.env.BD_HD_SUBSCRIPTION_ID
  const supabaseUrl    = process.env.NEXT_PUBLIC_SUPABASE_URL
  const serviceKey     = process.env.SUPABASE_SERVICE_ROLE_KEY

  const missing = [
    !placesKey   && 'GOOGLE_PLACES_API_KEY',
    !supabaseUrl && 'NEXT_PUBLIC_SUPABASE_URL',
    !serviceKey  && 'SUPABASE_SERVICE_ROLE_KEY',
    !dryRun && !bdKey          && 'BD_HD_DIRECTORY_AGENT_KEY',
    !dryRun && !subscriptionId && 'BD_HD_SUBSCRIPTION_ID',
  ].filter(Boolean)

  if (missing.length > 0) {
    console.error(`Missing required env var(s): ${missing.join(', ')}`)
    console.error('Set them in .env.local (see .env.local.example) and re-run.')
    process.exit(1)
  }

  console.log('─'.repeat(72))
  console.log(`NWI HD truck-stop import${dryRun ? '  [DRY RUN — nothing will be written]' : ''}`)
  console.log(
    citiesArg
      ? `${cities.length} selected city/cities (${cities.map(c => `${c.city}, ${c.state}`).join(' · ')}) · ${CHAIN_QUERIES.length} queries each`
      : `${cities.length} unique cities across ${Object.keys(CORRIDORS).length} corridors · ${CHAIN_QUERIES.length} queries each`,
  )
  console.log(
    `~${cities.length * (CHAIN_QUERIES.length + 1)} Google Places queries · ` +
    `${Math.round(radiusMeters / 1609.344)}mi radius`,
  )
  if (Number.isFinite(limit)) console.log(`Limit: ${limit} listing(s)`)
  console.log('─'.repeat(72))

  const supabase = createClient(supabaseUrl!, serviceKey!, {
    auth: { autoRefreshToken: false, persistSession: false },
  })

  // ── Phase 1: discovery ──
  const byPlaceId = new Map<string, TruckStop>()
  const tally: RejectTally = { outOfRange: 0, notATruckStop: 0, noPhoneOrAddress: 0, tollFree: 0 }
  let citiesWithNoResults = 0

  for (const target of cities) {
    const label = `${target.city}, ${target.state} [${target.corridors.join('/')}]`
    try {
      const stops = await searchCity(placesKey!, target, radiusMeters, tally)
      if (stops.length === 0) {
        console.log(`· ${label} — no results`)
        citiesWithNoResults++
        continue
      }
      let added = 0
      for (const s of stops) {
        if (byPlaceId.has(s.placeId)) continue   // already found in a nearby city
        byPlaceId.set(s.placeId, s)
        added++
      }
      console.log(`· ${label} — ${stops.length} found, ${added} new`)
    } catch (err) {
      console.error(`! ${label} — search failed: ${err instanceof Error ? err.message : String(err)}`)
      citiesWithNoResults++
    }
  }

  // Distinct place ids can share a phone: chains list a single corporate number
  // across sites ("Circle K | Truck Stop"), and co-located facilities share one
  // ("Love's Travel Stop" and "Love's Truck Care" at the same exit).
  // hd_directory_prospects.phone is UNIQUE, so without collapsing these here the
  // second of each pair creates a BD listing and then fails to record it —
  // leaving an orphan listing on the directory with no way to detect it.
  const byPhone = new Map<string, TruckStop>()
  for (const stop of byPlaceId.values()) {
    if (!byPhone.has(stop.phone)) byPhone.set(stop.phone, stop)
  }
  const duplicatePhones = byPlaceId.size - byPhone.size

  const allFound = [...byPhone.values()]
  console.log('─'.repeat(72))
  console.log(`Discovery complete: ${allFound.length} unique locations`)
  if (duplicatePhones > 0) {
    console.log(`Collapsed ${duplicatePhones} location(s) sharing a phone with another`)
  }
  console.log(
    `Rejected: ${tally.outOfRange} outside ${Math.round(radiusMeters / 1609.344)}mi · ` +
    `${tally.notATruckStop} not a truck stop by name · ` +
    `${tally.tollFree} toll-free/corporate number · ` +
    `${tally.noPhoneOrAddress} missing phone/address`,
  )

  if (allFound.length === 0) {
    console.log('Nothing to import.')
    return
  }

  // ── Phase 2: exclusions ──
  const { fresh, skipped } = await filterKnown(supabase, allFound)
  console.log(`Skipped ${skipped} already banked or opted out · ${fresh.length} to import`)
  console.log('─'.repeat(72))

  const queue = Number.isFinite(limit) ? fresh.slice(0, limit) : fresh

  if (dryRun) {
    queue.forEach((s, i) => {
      console.log(`${String(i + 1).padStart(4)}. ${s.businessName} — ${s.city}, ${s.state} — ${s.phone}`)
    })
    console.log('─'.repeat(72))
    console.log('SUMMARY (dry run)')
    console.log(`  Total found:   ${allFound.length}`)
    console.log(`  Would create:  ${queue.length}`)
    console.log(`  Skipped:       ${skipped}`)
    console.log('Re-run without --dry-run to create these listings.')
    return
  }

  // ── Phase 3: create listings ──
  let created = 0
  let failed  = 0
  const failures: Array<{ name: string; reason: string }> = []

  for (const [i, stop] of queue.entries()) {
    const position = `[${i + 1}/${queue.length}]`
    console.log(`${position} ${stop.businessName} — ${stop.city}, ${stop.state}`)

    try {
      const listingUrl = await createBdListing(stop, bdKey!, subscriptionId!)

      // Recorded only after BD confirms, so a failed listing never shows as
      // created. status 'yes' because these are direct imports, not invitees —
      // no permission SMS is sent for them.
      const { error } = await supabase.from('hd_directory_prospects').insert({
        phone:              stop.phone,
        business_name:      stop.businessName,
        google_place_id:    stop.placeId,
        city:               stop.city,
        state:              stop.state,
        address:            stop.address,
        service_category:   SERVICE_CATEGORY,
        status:             'yes',
        bd_listing_created: true,
        bd_listing_url:     listingUrl,
        responded_at:       new Date().toISOString(),
      })

      if (error) {
        // The BD listing exists but we could not record it — call it out loudly,
        // it needs a manual row so the location is not re-imported.
        failed++
        failures.push({ name: stop.businessName, reason: `LISTING CREATED but DB insert failed: ${error.message}` })
        console.error(`         ! DB insert failed (listing was created): ${error.message}`)
      } else {
        created++
        console.log('         ✓ listed')
      }
    } catch (err) {
      failed++
      const reason = err instanceof Error ? err.message : String(err)
      failures.push({ name: stop.businessName, reason })
      console.error(`         ✗ ${reason}`)
    }

    if (i < queue.length - 1) await sleep(BD_DELAY_MS)
  }

  // ── Summary ──
  console.log('─'.repeat(72))
  console.log('SUMMARY')
  console.log(`  Total found:    ${allFound.length}`)
  console.log(`  Total created:  ${created}`)
  console.log(`  Total failed:   ${failed}`)
  console.log(`  Total skipped:  ${skipped}`)
  if (citiesWithNoResults > 0) console.log(`  Cities with no results: ${citiesWithNoResults}`)

  if (failures.length > 0) {
    console.log('')
    console.log('FAILURES')
    for (const f of failures) console.log(`  ✗ ${f.name} — ${f.reason}`)
  }
  console.log('─'.repeat(72))
}

main().catch(err => {
  console.error('Import aborted:', err instanceof Error ? err.message : String(err))
  process.exit(1)
})
