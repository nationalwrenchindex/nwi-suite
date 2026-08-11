/**
 * One-time bulk import: major truck-stop chain locations along key US
 * interstate corridors → Brilliant Directories listings on NWI HD.
 *
 * Run:
 *   npm run import-truck-stops                 # live — creates real listings
 *   npm run import-truck-stops -- --dry-run    # find + report, write nothing
 *   npm run import-truck-stops -- --limit=10   # cap listings created
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
  'Iron Skillet',
  'SpeedCo',
  'truck stop',
] as const

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
].join(',')

async function searchText(key: string, textQuery: string): Promise<PlaceNew[]> {
  const res = await fetch(PLACES_URL, {
    method: 'POST',
    headers: {
      'Content-Type':     'application/json',
      'X-Goog-Api-Key':   key,
      'X-Goog-FieldMask': FIELD_MASK,
    },
    body:   JSON.stringify({ textQuery, maxResultCount: 20 }),
    signal: AbortSignal.timeout(20_000),
  })

  if (!res.ok) {
    const body = await res.text().catch(() => '')
    throw new Error(`Places ${res.status}${body ? ` — ${body.slice(0, 200)}` : ''}`)
  }

  const data = await res.json() as { places?: PlaceNew[] }
  return data.places ?? []
}

/** Sweeps every chain query for one city. Deduped by place id within the city. */
async function searchCity(key: string, target: City): Promise<TruckStop[]> {
  const queries = CHAIN_QUERIES.map(q => `${q} ${target.city}, ${target.state}`)
  const batches = await mapWithConcurrency(queries, PLACES_CONCURRENCY, q => searchText(key, q))

  const found = new Map<string, TruckStop>()

  for (const places of batches) {
    if (!places) continue
    for (const p of places) {
      if (!p.id || found.has(p.id)) continue

      // Both filters are hard requirements: no phone means the listing has no
      // way to be contacted, no address means it cannot be placed on a corridor.
      const phone   = normalizeUsPhone(p.nationalPhoneNumber ?? p.internationalPhoneNumber)
      const address = p.formattedAddress?.trim()
      if (!phone || !address) continue

      found.set(p.id, {
        placeId:      p.id,
        businessName: p.displayName?.text ?? 'Truck Stop',
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

async function createBdListing(stop: TruckStop, apiKey: string, subscriptionId: string): Promise<void> {
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

  // Dedupe cities across corridors — Charlotte, Atlanta, Knoxville and others
  // appear on two corridors each.
  const byKey = new Map<string, City & { corridors: string[] }>()
  for (const [corridor, list] of Object.entries(CORRIDORS)) {
    for (const c of list) {
      const key = `${c.city}|${c.state}`
      const hit = byKey.get(key)
      if (hit) hit.corridors.push(corridor)
      else byKey.set(key, { ...c, corridors: [corridor] })
    }
  }
  const cities = [...byKey.values()]

  console.log('─'.repeat(72))
  console.log(`NWI HD truck-stop import${dryRun ? '  [DRY RUN — nothing will be written]' : ''}`)
  console.log(`${cities.length} unique cities across ${Object.keys(CORRIDORS).length} corridors · ${CHAIN_QUERIES.length} queries each`)
  if (Number.isFinite(limit)) console.log(`Limit: ${limit} listing(s)`)
  console.log('─'.repeat(72))

  const supabase = createClient(supabaseUrl!, serviceKey!, {
    auth: { autoRefreshToken: false, persistSession: false },
  })

  // ── Phase 1: discovery ──
  const byPlaceId = new Map<string, TruckStop>()
  let citiesWithNoResults = 0

  for (const target of cities) {
    const label = `${target.city}, ${target.state} [${target.corridors.join('/')}]`
    try {
      const stops = await searchCity(placesKey!, target)
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

  const allFound = [...byPlaceId.values()]
  console.log('─'.repeat(72))
  console.log(`Discovery complete: ${allFound.length} unique locations`)

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
      await createBdListing(stop, bdKey!, subscriptionId!)

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
