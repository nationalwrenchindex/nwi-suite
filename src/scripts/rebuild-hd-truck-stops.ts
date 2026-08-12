/**
 * Rebuilds HD truck-stop listings on Brilliant Directories from data already in
 * Supabase, after the BD HD directory was emptied.
 *
 *   npm run rebuild-trucks -- --dry-run           # show what would be built
 *   npm run rebuild-trucks -- --limit=1 --verbose # prove the payload lands
 *   npm run rebuild-trucks                        # full rebuild
 *
 * Per prospect: Places Details -> service mapping -> description -> BD create
 * -> BD update (geo + website + description) -> Supabase.
 *
 * Create and update are separate calls because BD's create endpoint does not
 * accept lat/lon or the description fields — that split is what left the last
 * batch of listings without coordinates.
 *
 * Re-runnable: rows already flagged bd_listing_created are skipped, so a failed
 * run can be resumed without duplicating listings.
 */

import { loadEnvConfig } from '@next/env'
import { randomBytes } from 'crypto'
import { createClient, type SupabaseClient } from '@supabase/supabase-js'

loadEnvConfig(process.cwd())

const BD_BASE     = 'https://national-wrench-index-hd.directoryup.com/api/v2'
const PLACES_BASE = 'https://places.googleapis.com/v1/places'

const BD_DELAY_MS        = 500
const PLACES_CONCURRENCY = 5
const PROGRESS_EVERY     = 50

// Places Details (Pro SKU) list price at time of writing. Only an estimate —
// actual billing depends on your Google Cloud tier and free credit.
const PLACES_DETAILS_COST_USD = 0.017

const FIELD_MASK = [
  'id', 'displayName', 'formattedAddress', 'nationalPhoneNumber', 'websiteUri',
  'location', 'addressComponents', 'regularOpeningHours', 'types',
].join(',')

/** Google place types -> the service wording shown to drivers. */
const SERVICE_BY_TYPE: Record<string, string> = {
  gas_station:       'Diesel fuel',
  restaurant:        'Restaurant',
  lodging:           'Driver showers',
  car_repair:        'Truck repair',
  parking:           'Truck parking',
  convenience_store: 'Convenience store',
  car_wash:          'Truck wash',
}

interface AddressComponent { longText?: string; shortText?: string; types?: string[] }

interface PlaceDetails {
  id?:                  string
  displayName?:         { text?: string }
  formattedAddress?:    string
  nationalPhoneNumber?: string
  websiteUri?:          string
  location?:            { latitude?: number; longitude?: number }
  addressComponents?:   AddressComponent[]
  regularOpeningHours?: { weekdayDescriptions?: string[]; openNow?: boolean }
  types?:               string[]
}

interface Row {
  id:              string
  business_name:   string | null
  phone:           string
  city:            string | null
  state:           string | null
  website:         string | null
  google_place_id: string | null
  lat:             number | null
  lon:             number | null
}

const sleep = (ms: number) => new Promise(r => setTimeout(r, ms))

function componentOf(components: AddressComponent[] | undefined, type: string, short = false) {
  const m = components?.find(c => c.types?.includes(type))
  if (!m) return null
  return (short ? m.shortText : m.longText) ?? null
}

/** BD renders phone as a display string, so send national format, not E.164. */
function toBdPhone(e164: string): string {
  const ten = e164.replace(/\D/g, '').slice(-10)
  return ten.length === 10 ? `${ten.slice(0, 3)}-${ten.slice(3, 6)}-${ten.slice(6)}` : e164
}

/** Deterministic from the place id, matching the original import. */
function listingEmail(placeId: string): string {
  const local = placeId.replace(/[^A-Za-z0-9._-]/g, '').slice(0, 60) || randomBytes(8).toString('hex')
  return `${local}@nwi-hd-listing.com`.toLowerCase()
}

function generatePassword(): string {
  return randomBytes(18).toString('base64url')
}

function mapServices(types: string[] | undefined): string[] {
  const seen = new Set<string>()
  for (const t of types ?? []) {
    const label = SERVICE_BY_TYPE[t]
    if (label) seen.add(label)
  }
  return [...seen]
}

/**
 * Compacts Google's seven weekday strings. A stop that is open around the clock
 * is the single most useful fact for a driver, so it gets said plainly rather
 * than as seven repetitions of "Open 24 hours".
 */
function summariseHours(hours: PlaceDetails['regularOpeningHours']): string | null {
  const days = hours?.weekdayDescriptions
  if (!days || days.length === 0) return null
  const allDay = days.every(d => /open 24 hours/i.test(d))
  if (allDay) return 'Open 24 hours.'
  const uniform = new Set(days.map(d => d.replace(/^[A-Za-z]+:\s*/, '').trim()))
  if (uniform.size === 1) return `Open daily ${[...uniform][0]}.`
  return `Hours vary by day: ${days.join('; ')}.`
}

function buildDescription(row: Row, place: PlaceDetails | null): string {
  const name  = place?.displayName?.text ?? row.business_name ?? 'This truck stop'
  const city  = componentOf(place?.addressComponents, 'locality') ?? row.city ?? ''
  const state = componentOf(place?.addressComponents, 'administrative_area_level_1', true) ?? row.state ?? ''
  const where = [city, state].filter(Boolean).join(' ')

  const services = mapServices(place?.types)
  const hours    = summariseHours(place?.regularOpeningHours)

  const parts = [
    `${name}${where ? ` in ${where}` : ''} is a truck stop serving commercial drivers.`,
    services.length > 0 ? `Services include: ${services.join(', ')}.` : null,
    hours,
  ].filter(Boolean)

  return parts.join(' ')
}

async function fetchPlace(key: string, placeId: string): Promise<PlaceDetails | null> {
  const res = await fetch(`${PLACES_BASE}/${encodeURIComponent(placeId)}`, {
    headers: { 'X-Goog-Api-Key': key, 'X-Goog-FieldMask': FIELD_MASK },
    signal:  AbortSignal.timeout(15_000),
  })
  if (!res.ok) {
    const body = await res.text().catch(() => '')
    console.warn(`   ! Places ${res.status} for ${placeId}: ${body.slice(0, 140)}`)
    return null
  }
  return await res.json() as PlaceDetails
}

async function mapWithConcurrency<T, R>(
  items: readonly T[],
  limit: number,
  worker: (item: T) => Promise<R>,
): Promise<(R | null)[]> {
  const out = new Array<R | null>(items.length).fill(null)
  let cursor = 0
  async function runner() {
    while (cursor < items.length) {
      const i = cursor++
      try { out[i] = await worker(items[i]) } catch (e) {
        console.warn(`   ! ${e instanceof Error ? e.message : String(e)}`)
      }
    }
  }
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, runner))
  return out
}

async function bdCall(path: string, method: string, body: URLSearchParams, key: string) {
  const res = await fetch(`${BD_BASE}/${path}`, {
    method,
    headers: {
      'X-Api-Key':    key,
      'Content-Type': 'application/x-www-form-urlencoded',
      accept:         'application/json',
    },
    body:     body.toString(),
    // Never follow a redirect: it would downgrade the request to a bodyless GET.
    redirect: 'manual',
    signal:   AbortSignal.timeout(20_000),
  })
  const raw = await res.text().catch(() => '')
  const ok  = res.status >= 200 && res.status < 300 && !/"status"\s*:\s*"error"/.test(raw)
  return { ok, status: res.status, raw }
}

function extractCreated(raw: string): { userId: string | null; filename: string | null } {
  try {
    const json    = JSON.parse(raw) as Record<string, unknown>
    const message = json.message as Record<string, unknown> | undefined
    const id      = message?.user_id
    const file    = message?.filename
    return {
      userId:   typeof id === 'string' || typeof id === 'number' ? String(id) : null,
      filename: typeof file === 'string' && file ? file : null,
    }
  } catch { return { userId: null, filename: null } }
}

async function main() {
  const args    = process.argv.slice(2)
  const dryRun  = args.includes('--dry-run')
  const verbose = args.includes('--verbose')
  const limitArg = args.find(a => a.startsWith('--limit='))
  const limit   = limitArg ? Number.parseInt(limitArg.split('=')[1] ?? '', 10) : Number.POSITIVE_INFINITY
  if (Number.isNaN(limit) || limit <= 0) {
    console.error('--limit must be a positive integer')
    process.exit(1)
  }

  const placesKey  = process.env.GOOGLE_PLACES_API_KEY
  const bdKey      = process.env.BD_HD_DIRECTORY_AGENT_KEY
  const subId      = process.env.BD_HD_SUBSCRIPTION_ID
  const url        = process.env.NEXT_PUBLIC_SUPABASE_URL
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY

  const missing = [
    !placesKey  && 'GOOGLE_PLACES_API_KEY',
    !url        && 'NEXT_PUBLIC_SUPABASE_URL',
    !serviceKey && 'SUPABASE_SERVICE_ROLE_KEY',
    !dryRun && !bdKey && 'BD_HD_DIRECTORY_AGENT_KEY',
    !dryRun && !subId && 'BD_HD_SUBSCRIPTION_ID',
  ].filter(Boolean)
  if (missing.length > 0) {
    console.error(`Missing required env var(s): ${missing.join(', ')}`)
    process.exit(1)
  }

  const supabase: SupabaseClient = createClient(url!, serviceKey!, {
    auth: { autoRefreshToken: false, persistSession: false },
  })

  const { data, error } = await supabase
    .from('hd_directory_prospects')
    .select('id, business_name, phone, city, state, website, google_place_id, lat, lon')
    .eq('service_category', 'truck_stop')
    .eq('bd_listing_created', false)
    .order('created_at', { ascending: true })

  if (error) {
    console.error('load failed:', error.message)
    process.exit(1)
  }

  const all   = (data ?? []) as Row[]
  const queue = Number.isFinite(limit) ? all.slice(0, limit) : all

  console.log('─'.repeat(72))
  console.log(`HD truck-stop rebuild${dryRun ? '  [DRY RUN — nothing written]' : ''}`)
  console.log(`${all.length} awaiting rebuild · processing ${queue.length}`)
  console.log(`estimated Places cost: $${(queue.length * PLACES_DETAILS_COST_USD).toFixed(2)}`)
  console.log('─'.repeat(72))
  if (queue.length === 0) return

  // ── Places details ──
  console.log(`Fetching Places details, ${PLACES_CONCURRENCY} at a time…`)
  const places = await mapWithConcurrency(
    queue, PLACES_CONCURRENCY,
    r => r.google_place_id ? fetchPlace(placesKey!, r.google_place_id) : Promise.resolve(null),
  )
  const placesCalls = queue.filter(r => r.google_place_id).length

  let created = 0, enriched = 0, failed = 0, noPlace = 0

  for (const [i, row] of queue.entries()) {
    const place = places[i]
    const name  = place?.displayName?.text ?? row.business_name ?? '(no name)'
    if (!place) noPlace++

    const city    = componentOf(place?.addressComponents, 'locality') ?? row.city
    const state   = componentOf(place?.addressComponents, 'administrative_area_level_1', true) ?? row.state
    const street  = [
      componentOf(place?.addressComponents, 'street_number'),
      componentOf(place?.addressComponents, 'route'),
    ].filter(Boolean).join(' ')
    const zip     = componentOf(place?.addressComponents, 'postal_code')
    const phone   = place?.nationalPhoneNumber ?? row.phone
    const website = place?.websiteUri ?? row.website
    const lat     = place?.location?.latitude  ?? row.lat
    const lon     = place?.location?.longitude ?? row.lon
    const description = buildDescription(row, place)

    if (dryRun) {
      console.log(`  ${name} — ${[city, state].filter(Boolean).join(' ')}`)
      console.log(`      ${description}`)
      continue
    }

    // ── BD create ──
    const createBody = new URLSearchParams({
      email:           listingEmail(row.google_place_id ?? row.id),
      password:        generatePassword(),
      subscription_id: subId!,
      company:         name,
      profession_name: 'Truck Stop',
      listing_type:    'Company',
      first_name:      'Business',
      last_name:       'Owner',
      phone_number:    toBdPhone(phone),
      listing_live:    '1',
      bdapi_model:     'user',
    })
    if (city)   createBody.set('city', city)
    if (state)  createBody.set('state_code', state)
    if (street) createBody.set('address1', street)
    if (zip)    createBody.set('zip_code', zip)

    let userId: string | null = null
    let filename: string | null = null
    try {
      const res = await bdCall('user/create', 'POST', createBody, bdKey!)
      if (verbose) console.log(`      ← create ${res.status}: ${res.raw.slice(0, 300)}`)
      if (!res.ok) {
        failed++
        console.error(`  ✗ ${name} — create ${res.status}: ${res.raw.slice(0, 160)}`)
        await sleep(BD_DELAY_MS)
        continue
      }
      const parsed = extractCreated(res.raw)
      userId   = parsed.userId
      filename = parsed.filename
      created++
    } catch (err) {
      failed++
      console.error(`  ✗ ${name} — create threw: ${err instanceof Error ? err.message : String(err)}`)
      await sleep(BD_DELAY_MS)
      continue
    }

    await sleep(BD_DELAY_MS)

    // ── BD update: the fields create will not accept ──
    if (userId) {
      const updateBody = new URLSearchParams({ bdapi_model: 'user', user_id: userId })
      if (typeof lat === 'number') updateBody.set('lat', String(lat))
      if (typeof lon === 'number') updateBody.set('lon', String(lon))
      if (website) updateBody.set('website', website)
      // BD's created-user echo exposes `search_description` and `about_me` but
      // not `short_description`; unknown fields are ignored silently, so a
      // --verbose run is what confirms which of these actually sticks.
      updateBody.set('short_description', description)

      try {
        const res = await bdCall('user/update', 'PUT', updateBody, bdKey!)
        if (verbose) console.log(`      ← update ${res.status}: ${res.raw.slice(0, 300)}`)
        if (res.ok) enriched++
        else {
          failed++
          console.error(`  ! ${name} — created ${userId} but update ${res.status}: ${res.raw.slice(0, 140)}`)
        }
      } catch (err) {
        failed++
        console.error(`  ! ${name} — created ${userId} but update threw: ${err instanceof Error ? err.message : String(err)}`)
      }
      await sleep(BD_DELAY_MS)
    } else {
      console.warn(`  ! ${name} — created but BD returned no user_id; listing will not be editable`)
    }

    // ── Supabase ──
    const { error: updErr } = await supabase
      .from('hd_directory_prospects')
      .update({
        bd_listing_created: true,
        bd_user_id:         userId,
        bd_listing_url:     filename ? `https://www.nwihd.com/${filename.replace(/^\//, '')}` : null,
        enriched_at:        new Date().toISOString(),
        status:             'yes',
        ...(typeof lat === 'number' ? { lat } : {}),
        ...(typeof lon === 'number' ? { lon } : {}),
        ...(website ? { website } : {}),
      })
      .eq('id', row.id)
    if (updErr) console.error(`  ! ${name} — DB update failed: ${updErr.message}`)

    if ((i + 1) % PROGRESS_EVERY === 0) {
      console.log(`  … ${i + 1}/${queue.length} · created ${created} · enriched ${enriched} · failed ${failed}`)
    }
  }

  console.log('')
  console.log('─'.repeat(72))
  console.log('SUMMARY')
  console.log(`  Listings created:   ${created}`)
  console.log(`  Enriched (geo/desc):${enriched}`)
  console.log(`  Failed:             ${failed}`)
  console.log(`  No Places result:   ${noPlace}`)
  console.log(`  Estimated cost:     $${(placesCalls * PLACES_DETAILS_COST_USD).toFixed(2)} (${placesCalls} Places Details calls)`)
  console.log('─'.repeat(72))
}

main().catch(err => {
  console.error('Rebuild aborted:', err instanceof Error ? err.message : String(err))
  process.exit(1)
})
